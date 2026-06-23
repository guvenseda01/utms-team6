"""
SPEC-006: Student Affairs — Oversee Application Documents
SPEC-007: Student Affairs — Notify Transfer Results
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.application import Application
from app.domain.audit import AuditLog
from app.domain.enums import AppStatus, RankStatus
from app.domain.ranking import Ranking, RankingEntry
from app.domain.user import Applicant
from app.repositories.application_repository import ApplicationRepository
from app.services.application_service import ApplicationService
from app.services.notification_service import NotificationService


_VALID_REJECTION_CODES = {
    "INVALID_DOCUMENT",
    "FRAUDULENT_DOCUMENT",
    "DUPLICATE_APPLICATION",
    "MISSED_DEADLINE",
    "OTHER",
}


class OfficerApplicationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._app_repo = ApplicationRepository(db)
        self._app_svc = ApplicationService(db)
        self._notif_svc = NotificationService(db)

    async def list_applications(
        self,
        status_filter: Optional[AppStatus] = None,
        program_id: Optional[uuid.UUID] = None,
        period_id: Optional[uuid.UUID] = None,
    ) -> list[Application]:
        from app.domain.application import Application as App
        q = (
            select(App)
            .options(
                selectinload(App.applicant).selectinload(Applicant.user),
                selectinload(App.program),
                selectinload(App.period),
                selectinload(App.documents),
                selectinload(App.eligibility_checks),
            )
        )
        if status_filter is not None:
            q = q.where(App.status == status_filter)
        if program_id is not None:
            q = q.where(App.program_id == program_id)
        if period_id is not None:
            q = q.where(App.period_id == period_id)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get_application(self, application_id: uuid.UUID) -> Application:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        return app

    async def approve_verification(
        self,
        application_id: uuid.UUID,
        officer_id: uuid.UUID,
    ) -> Application:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.status != AppStatus.SUBMITTED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Expected SUBMITTED, got {app.status.value}",
            )

        old_status = app.status.value
        await self._app_svc.change_status(
            application_id, AppStatus.UNDER_REVIEW, officer_id, "Documents verified"
        )
        await self._app_svc.change_status(
            application_id, AppStatus.ENGLISH_REVIEW, officer_id, "Routed to YDYO for English proficiency review"
        )

        log = AuditLog(
            actor_id=officer_id,
            action="DOCUMENT_VERIFIED",
            entity_type="Application",
            entity_id=application_id,
            old_value={"status": old_status},
            new_value={"status": AppStatus.ENGLISH_REVIEW.value},
        )
        self.db.add(log)
        await self.db.flush()

        await self._enqueue_status_notification(
            app,
            old_status=old_status,
            new_status=AppStatus.ENGLISH_REVIEW.value,
            note="Belgeleriniz doğrulandı. Başvurunuz İngilizce yeterlilik incelemesine yönlendirildi.",
        )
        return await self._app_repo.get_by_id(application_id)  # type: ignore[return-value]

    async def request_correction(
        self,
        application_id: uuid.UUID,
        officer_id: uuid.UUID,
        note: str,
    ) -> Application:
        if not note or not note.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Correction note is required",
            )
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.status not in (AppStatus.SUBMITTED, AppStatus.UNDER_REVIEW):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot request correction in status {app.status.value}",
            )

        old_status = app.status.value
        await self._app_svc.change_status(
            application_id, AppStatus.CORRECTION_REQUESTED, officer_id, note
        )

        log = AuditLog(
            actor_id=officer_id,
            action="CORRECTION_REQUESTED",
            entity_type="Application",
            entity_id=application_id,
            old_value={"status": old_status},
            new_value={"status": AppStatus.CORRECTION_REQUESTED.value, "note": note},
        )
        self.db.add(log)
        await self.db.flush()

        await self._notif_svc.enqueue(
            user_id=app.applicant_id,
            subject="UTMS — Düzeltme Talebi",
            application_id=app.id,
            template="correction_requested",
            template_vars={"correction_note": note, "title": "Düzeltme Talebi"},
        )
        return await self._app_repo.get_by_id(application_id)  # type: ignore[return-value]

    async def reject_application(
        self,
        application_id: uuid.UUID,
        officer_id: uuid.UUID,
        reason_code: str,
        note: str,
    ) -> Application:
        if reason_code not in _VALID_REJECTION_CODES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid reason_code. Valid: {sorted(_VALID_REJECTION_CODES)}",
            )
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.status not in (
            AppStatus.SUBMITTED,
            AppStatus.UNDER_REVIEW,
            AppStatus.CORRECTION_REQUESTED,
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot reject application in status {app.status.value}",
            )

        old_status = app.status.value
        rejection_note = f"{reason_code}: {note}" if note else reason_code
        await self._app_svc.change_status(
            application_id, AppStatus.REJECTED, officer_id, rejection_note
        )

        log = AuditLog(
            actor_id=officer_id,
            action="APPLICATION_REJECTED",
            entity_type="Application",
            entity_id=application_id,
            old_value={"status": old_status},
            new_value={
                "status": AppStatus.REJECTED.value,
                "reason_code": reason_code,
                "note": note,
            },
        )
        self.db.add(log)
        await self.db.flush()

        await self._enqueue_status_notification(
            app,
            old_status=old_status,
            new_status=AppStatus.REJECTED.value,
            note=rejection_note,
        )
        return await self._app_repo.get_by_id(application_id)  # type: ignore[return-value]

    async def announce_application(
        self,
        application_id: uuid.UUID,
        officer_id: uuid.UUID,
    ) -> Application:
        """Publish the final result for a single dean-approved application."""
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.status != AppStatus.RANKING:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Expected RANKING, got {app.status.value}",
            )

        old_status = app.status.value
        await self._app_svc.change_status(
            application_id,
            AppStatus.ANNOUNCED,
            officer_id,
            "Transfer result announced by Student Affairs",
        )

        log = AuditLog(
            actor_id=officer_id,
            action="RESULT_ANNOUNCED",
            entity_type="Application",
            entity_id=application_id,
            old_value={"status": old_status},
            new_value={"status": AppStatus.ANNOUNCED.value},
        )
        self.db.add(log)
        await self.db.flush()

        await self._notif_svc.enqueue(
            user_id=app.applicant_id,
            subject="UTMS — Transfer Sonucu İlan Edildi",
            application_id=app.id,
            template="result_announced",
            template_vars={
                "title": "Transfer Sonucu",
                "decision": "Kabul Edildi",
                "next_steps": "Tebrikler! Transfer başvurunuz resmi olarak ilan edildi.",
            },
        )
        return await self._app_repo.get_by_id(application_id)  # type: ignore[return-value]

    async def publish_results(
        self,
        period_id: uuid.UUID,
        program_id: uuid.UUID,
        officer_id: uuid.UUID,
    ) -> dict:
        ranking_result = await self.db.execute(
            select(Ranking)
            .options(selectinload(Ranking.entries))
            .where(
                Ranking.program_id == program_id,
                Ranking.period_id == period_id,
            )
        )
        ranking = ranking_result.scalar_one_or_none()

        if ranking is None or ranking.status != RankStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ranking must be APPROVED before publishing results",
            )
        if ranking.published_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Results already published",
            )

        primary_ids = {e.application_id for e in ranking.entries if e.is_primary}
        waitlisted_ids = {
            e.application_id for e in ranking.entries if not e.is_primary
        }

        apps_result = await self.db.execute(
            select(Application)
            .options(selectinload(Application.applicant))
            .where(
                Application.program_id == program_id,
                Application.period_id == period_id,
                Application.status == AppStatus.RANKING,
            )
        )
        apps = list(apps_result.scalars().all())

        await self.db.execute(
            update(Application)
            .where(
                Application.program_id == program_id,
                Application.period_id == period_id,
                Application.status == AppStatus.RANKING,
            )
            .values(
                status=AppStatus.ANNOUNCED,
                updated_at=datetime.now(timezone.utc),
            )
        )

        period_label = f"{period_id}"
        for app in apps:
            if app.id in primary_ids:
                result = "Accepted"
            elif app.id in waitlisted_ids:
                result = "Waitlisted"
            else:
                result = "Rejected"
            await self._notif_svc.enqueue(
                user_id=app.applicant_id,
                subject="UTMS — Transfer Sonuçları Açıklandı",
                application_id=app.id,
                template="results_announced",
                template_vars={
                    "result": result,
                    "period_label": period_label,
                    "title": "Transfer Sonuçları",
                },
            )

        ranking.published_at = datetime.now(timezone.utc)
        ranking.status = RankStatus.PUBLISHED

        log = AuditLog(
            actor_id=officer_id,
            action="RESULTS_PUBLISHED",
            entity_type="Ranking",
            entity_id=ranking.id,
            old_value={"published_at": None, "status": RankStatus.APPROVED.value},
            new_value={
                "announced_count": len(apps),
                "status": RankStatus.PUBLISHED.value,
            },
        )
        self.db.add(log)
        await self.db.flush()

        return {"announced_count": len(apps)}

    async def get_results(
        self,
        period_id: uuid.UUID,
        program_id: uuid.UUID,
    ) -> dict:
        ranking_result = await self.db.execute(
            select(Ranking)
            .options(
                selectinload(Ranking.entries)
                .selectinload(RankingEntry.application)
                .selectinload(Application.applicant)
                .selectinload(Applicant.user)
            )
            .where(
                Ranking.program_id == program_id,
                Ranking.period_id == period_id,
            )
        )
        ranking = ranking_result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")

        primary = [e for e in ranking.entries if e.is_primary]
        waitlisted = [e for e in ranking.entries if not e.is_primary]
        return {"primary": primary, "waitlisted": waitlisted, "ranking": ranking}

    async def _enqueue_status_notification(
        self,
        app: Application,
        old_status: str,
        new_status: str,
        note: str,
    ) -> None:
        await self._notif_svc.enqueue(
            user_id=app.applicant_id,
            subject="UTMS — Başvuru Durumu Güncellendi",
            application_id=app.id,
            template="status_changed",
            template_vars={
                "old_status": old_status,
                "new_status": new_status,
                "note": note,
                "title": "Başvuru Durumu Güncellendi",
            },
        )
