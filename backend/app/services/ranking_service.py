"""
SPEC-010: Generate Ranking Automatically
SPEC-011: Approve System-Generated Ranking
SPEC-013: Process Waitlisted Applicants
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.application import Application
from app.domain.audit import AuditLog
from app.domain.enums import AppStatus, RankStatus
from app.domain.ranking import Ranking, RankingEntry
from app.repositories.application_repository import ApplicationRepository
from app.repositories.program_repository import ProgramRepository
from app.services.application_service import ApplicationService
from app.services.evaluation_service import calculate_transfer_score


class RankingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._app_repo = ApplicationRepository(db)
        self._program_repo = ProgramRepository(db)
        self._app_svc = ApplicationService(db)

    # ------------------------------------------------------------------
    # SPEC-010
    # ------------------------------------------------------------------

    async def generate_ranking(
        self,
        program_id: uuid.UUID,
        period_id: uuid.UUID,
        generated_by: uuid.UUID,
    ) -> Ranking:
        program = await self._program_repo.get_by_id(program_id)
        if program is None:
            raise HTTPException(status_code=404, detail="Program not found")

        existing_result = await self.db.execute(
            select(Ranking).where(
                Ranking.program_id == program_id,
                Ranking.period_id == period_id,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Ranking already exists for this program/period",
                    "existing_id": str(existing.id),
                },
            )

        apps_result = await self.db.execute(
            select(Application)
            .options(
                selectinload(Application.academic_record),
                selectinload(Application.applicant),
            )
            .where(
                Application.program_id == program_id,
                Application.period_id == period_id,
                Application.status == AppStatus.RANKING,
            )
        )
        apps = list(apps_result.scalars().all())

        eligible = []
        excluded = []

        for app in apps:
            record = app.academic_record
            if (
                record is None
                or record.yks_score is None
                or record.gpa_100 is None
            ):
                excluded.append({"application_id": str(app.id), "reason": "Missing score data"})
                continue

            base_score = float(program.min_gpa) * 25 if program.min_gpa else 400.0
            score = calculate_transfer_score(
                float(record.yks_score),
                base_score,
                float(record.gpa_100),
            )
            eligible.append((app, score))

        eligible.sort(key=lambda x: (-x[1], x[0].submitted_at or datetime.min))

        ranking = Ranking(
            program_id=program_id,
            period_id=period_id,
            status=RankStatus.DRAFT,
        )
        self.db.add(ranking)
        await self.db.flush()

        quota = program.quota or len(eligible)
        for position, (app, score) in enumerate(eligible, start=1):
            entry = RankingEntry(
                ranking_id=ranking.id,
                application_id=app.id,
                composite_score=score,
                position=position,
                is_primary=position <= quota,
            )
            self.db.add(entry)

        await self.db.flush()

        log = AuditLog(
            actor_id=generated_by,
            action="RANKING_GENERATED",
            entity_type="Ranking",
            entity_id=ranking.id,
            old_value={},
            new_value={
                "eligible_count": len(eligible),
                "excluded_count": len(excluded),
                "quota": quota,
            },
        )
        self.db.add(log)
        await self.db.flush()

        ranking._excluded = excluded
        return ranking

    async def get_ranking(self, ranking_id: uuid.UUID) -> Ranking:
        result = await self.db.execute(
            select(Ranking)
            .options(
                selectinload(Ranking.entries),
                selectinload(Ranking.program),
                selectinload(Ranking.period),
            )
            .where(Ranking.id == ranking_id)
        )
        ranking = result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")
        return ranking

    # ------------------------------------------------------------------
    # SPEC-011
    # ------------------------------------------------------------------

    async def approve_ranking(
        self,
        ranking_id: uuid.UUID,
        approver_id: uuid.UUID,
    ) -> Ranking:
        result = await self.db.execute(
            select(Ranking)
            .options(selectinload(Ranking.entries))
            .where(Ranking.id == ranking_id)
            .with_for_update()
        )
        ranking = result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")
        if ranking.status != RankStatus.DRAFT:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Ranking status is {ranking.status.value}, expected DRAFT",
            )

        ranking.status = RankStatus.APPROVED
        ranking.approved_by = approver_id
        ranking.approved_at = datetime.now(timezone.utc)
        await self.db.flush()

        # Applications stay in DEAN_APPROVED — Student Affairs will announce them

        log = AuditLog(
            actor_id=approver_id,
            action="RANKING_APPROVED",
            entity_type="Ranking",
            entity_id=ranking_id,
            old_value={"status": RankStatus.DRAFT.value},
            new_value={"status": RankStatus.APPROVED.value, "approved_at": ranking.approved_at.isoformat()},
        )
        self.db.add(log)
        await self.db.flush()

        return ranking

    async def return_for_correction(
        self,
        ranking_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        note: str,
    ) -> Ranking:
        result = await self.db.execute(
            select(Ranking).where(Ranking.id == ranking_id)
        )
        ranking = result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")

        log = AuditLog(
            actor_id=reviewer_id,
            action="RANKING_RETURNED_FOR_CORRECTION",
            entity_type="Ranking",
            entity_id=ranking_id,
            old_value={"status": ranking.status.value},
            new_value={"note": note},
        )
        self.db.add(log)
        await self.db.flush()

        return ranking

    # ------------------------------------------------------------------
    # SPEC-013
    # ------------------------------------------------------------------

    async def promote_next_waitlisted(
        self,
        ranking_id: uuid.UUID,
        withdrawn_application_id: uuid.UUID,
        actor_id: uuid.UUID,
    ) -> Optional[RankingEntry]:
        result = await self.db.execute(
            select(Ranking)
            .options(selectinload(Ranking.entries))
            .where(Ranking.id == ranking_id)
        )
        ranking = result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")

        withdrawn_app = await self._app_repo.get_by_id(withdrawn_application_id)
        if withdrawn_app:
            await self._app_svc.change_status(
                withdrawn_application_id, AppStatus.REJECTED, actor_id,
                "Applicant withdrew"
            )

        withdrawn_entry = next(
            (e for e in ranking.entries if e.application_id == withdrawn_application_id),
            None,
        )
        if withdrawn_entry:
            withdrawn_entry.is_primary = False
            await self.db.flush()

        waitlisted = sorted(
            [e for e in ranking.entries if not e.is_primary],
            key=lambda e: e.position,
        )

        if not waitlisted:
            return None

        next_entry = waitlisted[0]
        next_entry.is_primary = True
        await self.db.flush()

        next_app = await self._app_repo.get_by_id(next_entry.application_id)
        if next_app:
            await self._notify_promotion(next_app)

        log = AuditLog(
            actor_id=actor_id,
            action="WAITLIST_PROMOTION",
            entity_type="RankingEntry",
            entity_id=next_entry.id,
            old_value={"is_primary": False, "withdrawn": str(withdrawn_application_id)},
            new_value={"is_primary": True, "promoted_application": str(next_entry.application_id)},
        )
        self.db.add(log)
        await self.db.flush()

        return next_entry

    async def delete_ranking(self, ranking_id: uuid.UUID) -> None:
        result = await self.db.execute(
            select(Ranking).where(Ranking.id == ranking_id)
        )
        ranking = result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")
        entries_result = await self.db.execute(
            select(RankingEntry).where(RankingEntry.ranking_id == ranking_id)
        )
        for entry in entries_result.scalars().all():
            await self.db.delete(entry)
        await self.db.delete(ranking)
        await self.db.flush()

    async def get_waitlist(self, ranking_id: uuid.UUID) -> dict:
        result = await self.db.execute(
            select(Ranking)
            .options(selectinload(Ranking.entries))
            .where(Ranking.id == ranking_id)
        )
        ranking = result.scalar_one_or_none()
        if ranking is None:
            raise HTTPException(status_code=404, detail="Ranking not found")

        primary = [e for e in ranking.entries if e.is_primary]
        waitlisted = [e for e in ranking.entries if not e.is_primary]
        program = await self._program_repo.get_by_id(ranking.program_id)
        quota = program.quota if program else len(primary)

        return {
            "vacant_slots": max(0, quota - len(primary)),
            "waitlisted": waitlisted,
        }

    async def _notify_promotion(self, app: Application) -> None:
        from app.services.notification_service import NotificationService
        notif_svc = NotificationService(self.db)
        await notif_svc.enqueue(
            user_id=app.applicant_id,
            subject="UTMS — Bekleme Listesinden Asil Listeye Geçtiniz",
            application_id=app.id,
            template="results_announced",
            template_vars={
                "result": "Accepted",
                "period_label": "Waitlist promotion",
                "title": "Asil Listeye Geçiş",
            },
        )
