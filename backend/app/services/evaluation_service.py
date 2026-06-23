"""
SPEC-008: Verify Entrance Scores & Convert GPA
"""
import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.academic_record import AcademicRecord
from app.domain.audit import AuditLog
from app.domain.enums import AppStatus
from app.repositories.application_repository import ApplicationRepository


# Official YÖK GPA conversion table (4.0 scale → 100 scale)
_YOK_TABLE: list[tuple[float, float]] = [
    (4.00, 100.00),
    (3.75, 95.83),
    (3.50, 88.33),
    (3.25, 80.83),
    (3.00, 76.67),
    (2.75, 72.50),
    (2.50, 65.00),
    (2.25, 57.50),
    (2.00, 50.00),
    (1.75, 42.50),
    (1.50, 35.00),
    (1.25, 27.50),
    (1.00, 20.00),
]


def convert_gpa_yok(gpa_4: float) -> float:
    """
    Official YÖK table-based GPA conversion (4.0 → 100 scale).
    Interpolates linearly between table entries for values between rows.
    Deterministic: same input always produces same output.
    """
    if gpa_4 >= 4.00:
        return 100.00
    if gpa_4 <= 1.00:
        return 20.00

    for i in range(len(_YOK_TABLE) - 1):
        high_4, high_100 = _YOK_TABLE[i]
        low_4, low_100 = _YOK_TABLE[i + 1]
        if low_4 <= gpa_4 <= high_4:
            ratio = (gpa_4 - low_4) / (high_4 - low_4)
            return round(low_100 + ratio * (high_100 - low_100), 2)

    return 20.00


def calculate_transfer_score(
    yks_score: float,
    program_base_score: float,
    gpa_100: float,
) -> float:
    """
    Official SRS transfer score formula:
      Exam Component = (yks_score / program_base_score) × 100 × 0.90
      GPA Component  = gpa_100 × 0.10
      Transfer Score = Exam Component + GPA Component
    """
    exam_component = (yks_score / program_base_score) * 100 * 0.90
    gpa_component = gpa_100 * 0.10
    return round(exam_component + gpa_component, 3)


class EvaluationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._app_repo = ApplicationRepository(db)

    async def verify_scores(
        self,
        application_id: uuid.UUID,
        evaluator_id: uuid.UUID,
    ) -> AcademicRecord:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.status != AppStatus.RANKING:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Expected RANKING, got {app.status.value}",
            )

        record = app.academic_record
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No academic record — fetch academic data first",
            )
        if record.is_locked:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Scores already locked",
            )

        if record.gpa_4 is not None:
            record.gpa_100 = Decimal(str(convert_gpa_yok(float(record.gpa_4))))

        record.is_locked = True
        await self.db.flush()

        log = AuditLog(
            actor_id=evaluator_id,
            action="SCORES_VERIFIED",
            entity_type="AcademicRecord",
            entity_id=record.id,
            old_value={"is_locked": False},
            new_value={
                "is_locked": True,
                "gpa_100": str(record.gpa_100) if record.gpa_100 else None,
            },
        )
        self.db.add(log)
        await self.db.flush()

        await self.db.commit()

        try:
            from app.core.redis import publish_status_change
            await asyncio.wait_for(
                publish_status_change(str(app.id), app.status.value),
                timeout=1.0,
            )
        except Exception:
            pass

        return record

    async def reject_application(
        self,
        application_id: uuid.UUID,
        evaluator_id: uuid.UUID,
    ) -> None:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.status != AppStatus.UNDER_REVIEW:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Expected UNDER_REVIEW, got {app.status.value}",
            )

        app.status = AppStatus.REJECTED
        app.updated_at = datetime.now(timezone.utc)
        await self.db.flush()

        log = AuditLog(
            actor_id=evaluator_id,
            action="STATUS_CHANGED",
            entity_type="Application",
            entity_id=app.id,
            old_value={"status": AppStatus.UNDER_REVIEW.value},
            new_value={"status": AppStatus.REJECTED.value},
        )
        self.db.add(log)
        await self.db.flush()

        await self.db.commit()

        try:
            from app.core.redis import publish_status_change
            await asyncio.wait_for(
                publish_status_change(str(app.id), AppStatus.REJECTED.value),
                timeout=1.0,
            )
        except Exception:
            pass

    async def manually_correct_score(
        self,
        application_id: uuid.UUID,
        evaluator_id: uuid.UUID,
        field: Literal["yks_score", "gpa_4"],
        corrected_value: float,
        correction_note: str,
    ) -> AcademicRecord:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")

        record = app.academic_record
        if record is None:
            raise HTTPException(status_code=404, detail="No academic record found")
        if record.is_locked:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Scores are locked and cannot be corrected",
            )

        old_value = float(getattr(record, field)) if getattr(record, field) is not None else None
        setattr(record, field, Decimal(str(corrected_value)))

        if field == "gpa_4":
            record.gpa_100 = Decimal(str(convert_gpa_yok(corrected_value)))
        record.source = "MANUAL"
        await self.db.flush()

        log = AuditLog(
            actor_id=evaluator_id,
            action="SCORE_MANUALLY_CORRECTED",
            entity_type="AcademicRecord",
            entity_id=record.id,
            old_value={"field": field, "value": old_value},
            new_value={"field": field, "value": corrected_value, "note": correction_note},
        )
        self.db.add(log)
        await self.db.flush()

        return record

    async def get_evaluation_detail(self, application_id: uuid.UUID) -> dict:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")

        record = app.academic_record
        gpa_100_converted = None
        if record and record.gpa_4 and not record.is_locked:
            gpa_100_converted = convert_gpa_yok(float(record.gpa_4))

        return {
            "application": app,
            "academic_record": record,
            "gpa_100_converted": gpa_100_converted,
            "documents": app.documents,
        }
