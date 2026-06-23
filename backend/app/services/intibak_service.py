"""
SPEC-012: Prepare Course Equivalence Table (Intibak)
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

from decimal import Decimal

from app.core.storage import MinIOClient
from app.domain.audit import AuditLog
from app.domain.enums import AppStatus, DocStatus, DocType, IntibakStatus, RankStatus
from app.domain.intibak import CourseMapping, IntibakTable
from app.repositories.application_repository import ApplicationRepository


def _parsed_courses_usable(courses: list) -> bool:
    """Cached transcript courses must have real names — not placeholder rows."""
    if not courses:
        return False
    for item in courses:
        name = str(item.get("course_name") or "").strip()
        if not name or name.lower() == "unknown course":
            return False
    return True


class IntibakService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._app_repo = ApplicationRepository(db)

    async def create_table(
        self,
        application_id: uuid.UUID,
        preparer_id: uuid.UUID,
    ) -> IntibakTable:
        app = await self._app_repo.get_by_id(application_id)
        if app is None:
            raise HTTPException(status_code=404, detail="Application not found")

        transcript_doc = next(
            (
                d for d in app.documents
                if d.doc_type == DocType.TRANSCRIPT
                and d.status in (DocStatus.ACCEPTED, DocStatus.PENDING)
            ),
            None,
        )
        if transcript_doc is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Missing transcript data — cannot create intibak table",
            )

        if app.status not in (AppStatus.RANKING, AppStatus.DEPT_EVAL):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Application must be in RANKING or DEPT_EVAL status to prepare intibak",
            )

        from sqlalchemy import select as sa_select
        from app.domain.ranking import Ranking, RankingEntry

        entry_result = await self.db.execute(
            sa_select(RankingEntry)
            .join(Ranking)
            .where(
                RankingEntry.application_id == application_id,
                RankingEntry.is_primary == True,
                Ranking.status == RankStatus.APPROVED,
            )
        )
        entry = entry_result.scalar_one_or_none()
        if entry is None:
            logger.warning(
                "No approved primary ranking entry for application %s — proceeding without ranking check",
                application_id,
            )

        if app.intibak_table is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Intibak table already exists for this application",
            )

        table = IntibakTable(
            application_id=application_id,
            prepared_by=preparer_id,
            status=IntibakStatus.DRAFT,
        )
        self.db.add(table)
        await self.db.flush()
        return table

    async def get_table(self, table_id: uuid.UUID) -> IntibakTable:
        result = await self.db.execute(
            select(IntibakTable)
            .options(selectinload(IntibakTable.course_mappings))
            .where(IntibakTable.id == table_id)
        )
        table = result.scalar_one_or_none()
        if table is None:
            raise HTTPException(status_code=404, detail="Intibak table not found")
        return table

    async def get_table_by_application(self, application_id: uuid.UUID) -> IntibakTable:
        result = await self.db.execute(
            select(IntibakTable)
            .options(selectinload(IntibakTable.course_mappings))
            .where(IntibakTable.application_id == application_id)
        )
        table = result.scalar_one_or_none()
        if table is None:
            raise HTTPException(
                status_code=404,
                detail="No intibak table found for this application",
            )
        return table

    async def suggest_matches(
        self,
        course_name: str,
        program_id: uuid.UUID,
    ) -> list[dict]:
        keywords = course_name.lower().split()
        suggestions = []

        from app.domain.application import Application
        result = await self.db.execute(
            select(CourseMapping.target_course, CourseMapping.target_credits)
            .join(IntibakTable)
            .join(IntibakTable.application)
            .where(Application.program_id == program_id)
            .distinct()
        )
        past_mappings = result.all()

        for target_course, credits in past_mappings:
            target_lower = target_course.lower()
            match_score = sum(1 for kw in keywords if kw in target_lower)
            if match_score > 0:
                suggestions.append({
                    "target_course": target_course,
                    "target_credits": float(credits) if credits else None,
                    "match_score": match_score,
                })

        suggestions.sort(key=lambda x: -x["match_score"])
        return suggestions[:10]

    async def add_mapping(
        self,
        table_id: uuid.UUID,
        source_course: str,
        source_credits: Optional[float],
        target_course: str,
        target_credits: Optional[float],
        equivalence_type: str,
        notes: Optional[str],
    ) -> CourseMapping:
        table = await self.get_table(table_id)
        if not table.is_editable:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cannot edit submitted intibak table",
            )
        if equivalence_type not in ("FULL", "PARTIAL", "NONE"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="equivalence_type must be FULL, PARTIAL, or NONE",
            )

        mapping = CourseMapping(
            intibak_table_id=table_id,
            source_course=source_course,
            source_credits=Decimal(str(source_credits)) if source_credits else None,
            target_course=target_course,
            target_credits=Decimal(str(target_credits)) if target_credits else None,
            equivalence_type=equivalence_type,
            notes=notes,
        )
        self.db.add(mapping)
        await self.db.flush()
        return mapping

    async def update_mapping(
        self,
        table_id: uuid.UUID,
        mapping_id: uuid.UUID,
        updates: dict,
    ) -> CourseMapping:
        table = await self.get_table(table_id)
        if not table.is_editable:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cannot edit submitted intibak table",
            )

        mapping = await self.db.get(CourseMapping, mapping_id)
        if mapping is None or mapping.intibak_table_id != table_id:
            raise HTTPException(status_code=404, detail="Mapping not found")

        for field_name, value in updates.items():
            if hasattr(mapping, field_name):
                if field_name in ("source_credits", "target_credits") and value is not None:
                    value = Decimal(str(value))
                setattr(mapping, field_name, value)
        await self.db.flush()
        return mapping

    async def delete_mapping(
        self,
        table_id: uuid.UUID,
        mapping_id: uuid.UUID,
    ) -> None:
        table = await self.get_table(table_id)
        if not table.is_editable:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cannot edit submitted intibak table",
            )
        mapping = await self.db.get(CourseMapping, mapping_id)
        if mapping is None or mapping.intibak_table_id != table_id:
            raise HTTPException(status_code=404, detail="Mapping not found")
        await self.db.delete(mapping)
        await self.db.flush()

    async def submit_table(
        self,
        table_id: uuid.UUID,
        submitter_id: uuid.UUID,
    ) -> IntibakTable:
        table = await self.get_table(table_id)
        if not table.is_editable:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Intibak table already submitted",
            )

        table.status = IntibakStatus.SUBMITTED
        table.submitted_at = datetime.now(timezone.utc)
        await self.db.flush()

        log = AuditLog(
            actor_id=submitter_id,
            action="INTIBAK_SUBMITTED",
            entity_type="IntibakTable",
            entity_id=table_id,
            old_value={"status": IntibakStatus.DRAFT.value},
            new_value={"status": IntibakStatus.SUBMITTED.value},
        )
        self.db.add(log)
        await self.db.flush()

        return table

    async def approve_table(
        self,
        table_id: uuid.UUID,
        approver_id: uuid.UUID,
    ) -> IntibakTable:
        table = await self.get_table(table_id)
        if table.status != IntibakStatus.SUBMITTED:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only submitted intibak tables can be approved",
            )
        table.status = IntibakStatus.APPROVED
        table.approved_at = datetime.now(timezone.utc)
        await self.db.flush()

        log = AuditLog(
            actor_id=approver_id,
            action="INTIBAK_APPROVED",
            entity_type="IntibakTable",
            entity_id=table_id,
            old_value={"status": IntibakStatus.SUBMITTED.value},
            new_value={"status": IntibakStatus.APPROVED.value},
        )
        self.db.add(log)
        await self.db.flush()

        return table

    # ------------------------------------------------------------------
    # NEW: Transcript parsing
    # ------------------------------------------------------------------

    async def parse_transcript_for_table(
        self,
        table_id: uuid.UUID,
        requester_id: uuid.UUID,
        storage: Optional[MinIOClient] = None,
    ) -> dict:
        """
        Fetch the transcript PDF for the application linked to the given intibak
        table, parse it, and persist the result in Document.extracted_data.

        On subsequent calls the cached result is returned immediately if the
        transfer commission has already confirmed the extraction
        (extraction_confirmed=True).

        Returns::

            {
                "document_id": "...",
                "parser_strategy": "table" | "line_regex" | "heuristic",
                "warnings": [...],
                "courses": [
                    {
                        "course_code": "MAT101",
                        "course_name": "Calculus I",
                        "credits": 4.0,
                        "grade": "AA",
                        "semester": "2022-2023 Fall"
                    },
                    ...
                ]
            }
        """
        # 1. Resolve: intibak table -> application -> transcript document
        table = await self.get_table(table_id)

        from app.repositories.document_repository import DocumentRepository
        doc_repo = DocumentRepository(self.db)

        transcript_doc = await doc_repo.get_transcript_for_application(
            table.application_id
        )
        if transcript_doc is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No accepted transcript document found for this application.",
            )

        # 2. Use cached courses only when complete (skip stale "Unknown Course" entries)
        cached = transcript_doc.extracted_data or {}
        cached_courses = cached.get("courses") or []
        if cached_courses and _parsed_courses_usable(cached_courses):
            return {
                "document_id": str(transcript_doc.id),
                "parser_strategy": cached.get("parser_strategy", "cached"),
                "warnings": cached.get("warnings", []),
                "courses": cached_courses,
            }

        # 3. Download PDF binary from MinIO
        _storage = storage or MinIOClient()
        try:
            response = _storage.get_object(transcript_doc.file_path)
            pdf_bytes: bytes = response.read()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Could not retrieve transcript file: {exc}",
            )

        # 4. Run the parser
        from app.services.transcript_parser import parse_transcript

        parse_result = parse_transcript(pdf_bytes)

        if not parse_result.courses:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "No course data could be extracted from the transcript. "
                    "Please ensure the PDF contains selectable text (not a scanned image)."
                ),
            )

        # 5. Serialize to JSONB-compatible dict
        extracted: dict = {
            "parser_strategy": parse_result.parser_strategy,
            "warnings": parse_result.warnings,
            "courses": [
                {
                    "course_code": c.course_code,
                    "course_name": c.course_name,
                    "credits": c.credits,
                    "grade": c.grade,
                    "semester": c.semester,
                }
                for c in parse_result.courses
            ],
        }

        # 6. Persist in Document.extracted_data
        #    extraction_confirmed stays False until the commission reviews and confirms
        transcript_doc.extracted_data = extracted
        transcript_doc.extraction_confirmed = False
        await self.db.flush()

        # 7. Write audit log
        log = AuditLog(
            actor_id=requester_id,
            action="TRANSCRIPT_PARSED",
            entity_type="Document",
            entity_id=transcript_doc.id,
            old_value=None,
            new_value={
                "course_count": len(parse_result.courses),
                "strategy": parse_result.parser_strategy,
            },
        )
        self.db.add(log)
        await self.db.flush()

        return {
            "document_id": str(transcript_doc.id),
            "parser_strategy": parse_result.parser_strategy,
            "warnings": parse_result.warnings,
            "courses": extracted["courses"],
        }
