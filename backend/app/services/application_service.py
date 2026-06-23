import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.application import Application
from app.domain.audit import AuditLog
from app.domain.eligibility import EligibilityCheck
from app.domain.enums import AppStatus, DocType
from app.repositories.application_repository import ApplicationRepository
from app.repositories.document_repository import DocumentRepository
from app.repositories.eligibility_repository import EligibilityRepository
from app.repositories.period_repository import PeriodRepository
from app.repositories.program_repository import ProgramRepository
from app.services.academic_from_documents import academic_record_from_documents
from app.services.document_service import DocumentService
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

# Legal status transitions: maps current status → allowed next statuses
_TRANSITIONS: dict[AppStatus, set[AppStatus]] = {
    AppStatus.DRAFT: {AppStatus.SUBMITTED},
    # SA can move to UNDER_REVIEW (open for review), request a correction, or reject outright
    AppStatus.SUBMITTED: {
        AppStatus.UNDER_REVIEW,
        AppStatus.CORRECTION_REQUESTED,
        AppStatus.REJECTED,
    },
    # From UNDER_REVIEW SA routes to YDYO, requests correction, or rejects
    # RANKING direct jump removed — UNDER_REVIEW must go through ENGLISH_REVIEW first
    AppStatus.UNDER_REVIEW: {
        AppStatus.ENGLISH_REVIEW,
        AppStatus.CORRECTION_REQUESTED,
        AppStatus.REJECTED,
    },
    AppStatus.CORRECTION_REQUESTED: {AppStatus.UNDER_REVIEW},
    # YDYO: approve → DEAN_APPROVED; outright reject (fraudulent cert) → REJECTED
    # Insufficient score path uses route-to-exam (stays ENGLISH_REVIEW) not this transition
    AppStatus.ENGLISH_REVIEW: {AppStatus.DEAN_APPROVED, AppStatus.REJECTED},
    AppStatus.DEPT_EVAL: {AppStatus.RANKING, AppStatus.REJECTED},
    AppStatus.DEAN_APPROVED: {AppStatus.RANKING, AppStatus.ANNOUNCED, AppStatus.REJECTED},
    AppStatus.RANKING: {AppStatus.ANNOUNCED, AppStatus.REJECTED},
}

_REQUIRED_DOC_TYPES = {
    DocType.TRANSCRIPT,
    DocType.YKS_RESULT,
    DocType.ID_COPY,
}


class ApplicationService:
    def __init__(
        self,
        db: AsyncSession,
    ) -> None:
        self.db = db
        self._app_repo = ApplicationRepository(db)
        self._period_repo = PeriodRepository(db)
        self._program_repo = ProgramRepository(db)
        self._elig_repo = EligibilityRepository(db)
        self._doc_repo = DocumentRepository(db)

    async def create_application(
        self,
        applicant_id: uuid.UUID,
        program_id: uuid.UUID,
        period_id: uuid.UUID,
    ) -> Application:
        period = await self._period_repo.get_by_id(period_id)
        if period is None or not period.is_open:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Application period is not open",
            )

        existing = await self._app_repo.get_by_program_and_period(
            applicant_id, program_id, period_id
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You have already applied to this program for this period",
            )

        program = await self._program_repo.get_by_id(program_id)
        if program is None or not program.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Program not found",
            )

        application = Application(
            applicant_id=applicant_id,
            program_id=program_id,
            period_id=period_id,
            status=AppStatus.DRAFT,
        )
        await self._app_repo.save(application)
        return application

    async def fetch_academic_data(self, application_id: uuid.UUID) -> dict:
        """Refresh academic record from uploaded PDF extraction only (no mock UBYS/ÖSYM)."""
        application = await self._app_repo.get_by_id(application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found")

        doc_service = DocumentService(self.db)
        docs = await self._doc_repo.get_by_application(application_id)
        refreshed = [await doc_service.backfill_extraction(d) for d in docs]

        parsed = academic_record_from_documents(refreshed)
        now = datetime.now(timezone.utc)

        from app.domain.academic_record import AcademicRecord

        if application.academic_record is None:
            record = AcademicRecord(application_id=application.id)
            self.db.add(record)
        else:
            record = application.academic_record

        if parsed is None:
            record.institution = None
            record.gpa_4 = None
            record.gpa_100 = None
            record.yks_score = None
            record.credits_completed = None
            record.source = None
            record.fetched_at = now
            await self.db.flush()
            return {
                "institution": None,
                "gpa_4": None,
                "gpa_100": None,
                "yks_score": None,
                "credits_completed": None,
                "fetched_at": record.fetched_at.isoformat(),
                "source": None,
                "errors": ["No parsed data from uploaded documents. Upload transcript and YKS PDFs first."],
            }

        record.institution = parsed.get("institution")
        record.gpa_4 = parsed.get("gpa_4")
        record.gpa_100 = parsed.get("gpa_100")
        record.yks_score = parsed.get("yks_score")
        record.credits_completed = parsed.get("credits_completed")
        record.source = parsed.get("source")
        record.fetched_at = now
        await self.db.flush()

        return {
            "institution": record.institution,
            "gpa_4": float(record.gpa_4) if record.gpa_4 is not None else None,
            "gpa_100": float(record.gpa_100) if record.gpa_100 is not None else None,
            "yks_score": float(record.yks_score) if record.yks_score is not None else None,
            "credits_completed": record.credits_completed,
            "fetched_at": record.fetched_at.isoformat(),
            "source": record.source,
            "errors": None,
        }

    async def run_eligibility_checks(
        self, application_id: uuid.UUID
    ) -> List[EligibilityCheck]:
        application = await self._app_repo.get_by_id(application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found")

        program = await self._program_repo.get_by_id(application.program_id)
        record = application.academic_record
        checks: List[EligibilityCheck] = []

        # GPA check
        if program is not None and program.min_gpa is not None:
            if record is None or record.gpa_4 is None:
                gpa_passed = False
                gpa_detail = "GPA data not available"
            else:
                gpa_passed = float(record.gpa_4) >= float(program.min_gpa)
                if gpa_passed:
                    gpa_detail = f"GPA {record.gpa_4:.2f} >= minimum {program.min_gpa:.2f}"
                else:
                    gpa_detail = (
                        f"GPA {record.gpa_4:.2f} < minimum {program.min_gpa:.2f}"
                    )

            check = EligibilityCheck(
                application_id=application.id,
                rule_key="MIN_GPA",
                passed=gpa_passed,
                detail=gpa_detail,
            )
            await self._elig_repo.save(check)
            checks.append(check)

        return checks

    async def submit_application(self, application_id: uuid.UUID) -> Application:
        application = await self._app_repo.get_by_id(application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found")

        period = await self._period_repo.get_by_id(application.period_id)
        if period is None or not period.is_open:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Application period has closed",
            )

        if application.status != AppStatus.DRAFT:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Only DRAFT applications can be submitted",
            )

        # Validate required documents
        uploaded_types = {doc.doc_type for doc in application.documents}
        missing = _REQUIRED_DOC_TYPES - uploaded_types
        if missing:
            missing_names = [t.value for t in sorted(missing, key=lambda x: x.value)]
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Missing required documents: {', '.join(missing_names)}",
            )

        # Validate eligibility checks
        failed = [c for c in application.eligibility_checks if not c.passed]
        if failed:
            reasons = [c.detail or c.rule_key for c in failed]
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="; ".join(reasons),
            )

        # Generate tracking number
        year = datetime.now(timezone.utc).year
        seq = await self._app_repo.count_submitted_this_year(year)
        tracking_number = f"APP-{year}-{(seq + 1):05d}"

        application.tracking_number = tracking_number
        application.submitted_at = datetime.now(timezone.utc)
        await self._change_status_internal(
            application,
            AppStatus.SUBMITTED,
            actor_id=application.applicant_id,
            note="Applicant submitted",
        )

        program_name = (
            application.program.name
            if application.program is not None
            else "Transfer Program"
        )
        try:
            notif_svc = NotificationService(self.db)
            await notif_svc.enqueue(
                user_id=application.applicant_id,
                subject="UTMS — Başvurunuz Alındı",
                application_id=application.id,
                template="application_submitted",
                template_vars={
                    "tracking_number": tracking_number,
                    "program_name": program_name,
                    "title": "Başvuru Alındı",
                },
            )
        except Exception:
            logger.warning(
                "Failed to enqueue submission notification for %s", application_id, exc_info=True
            )

        return application

    async def change_status(
        self,
        application_id: uuid.UUID,
        new_status: AppStatus,
        actor_id: uuid.UUID,
        note: Optional[str] = None,
    ) -> Application:
        application = await self._app_repo.get_by_id(application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found")

        await self._change_status_internal(application, new_status, actor_id, note)
        return application

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _change_status_internal(
        self,
        application: Application,
        new_status: AppStatus,
        actor_id: uuid.UUID,
        note: Optional[str] = None,
    ) -> None:
        current = application.status
        allowed = _TRANSITIONS.get(current, set())
        if new_status not in allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Invalid status transition: {current.value} → {new_status.value}",
            )

        old_value = {"status": current.value}
        new_value: dict = {"status": new_status.value}
        if note:
            new_value["note"] = note

        application.status = new_status
        application.updated_at = datetime.now(timezone.utc)
        await self.db.flush()

        log = AuditLog(
            actor_id=actor_id,
            action="STATUS_CHANGED",
            entity_type="Application",
            entity_id=application.id,
            old_value=old_value,
            new_value=new_value,
        )
        self.db.add(log)
        await self.db.flush()

        try:
            from app.core.redis import publish_status_change
            await publish_status_change(str(application.id), new_status.value)
        except Exception:
            logger.warning("Failed to publish status change for %s", application.id)
