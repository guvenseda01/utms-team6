"""
SPEC-012: Prepare Course Equivalence Table (Intibak)
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.core.storage import MinIOClient, get_minio_client
from app.domain.enums import UserRole
from app.services.intibak_service import IntibakService

router = APIRouter()

_require_ygk = require_role(UserRole.TRANSFER_COMMISSION)
_require_dean = require_role(UserRole.DEAN_OFFICE)


class CourseMappingCreate(BaseModel):
    source_course: str
    source_credits: Optional[float] = None
    target_course: str
    target_credits: Optional[float] = None
    equivalence_type: str
    notes: Optional[str] = None


class CourseMappingUpdate(BaseModel):
    source_course: Optional[str] = None
    source_credits: Optional[float] = None
    target_course: Optional[str] = None
    target_credits: Optional[float] = None
    equivalence_type: Optional[str] = None
    notes: Optional[str] = None


def _table_response(table, transcript_document_id: str | None = None):
    return {
        "id": str(table.id),
        "application_id": str(table.application_id),
        "status": table.status.value,
        "submitted_at": table.submitted_at,
        "transcript_document_id": transcript_document_id,
        "course_mappings": [
            {
                "id": str(m.id),
                "source_course": m.source_course,
                "source_credits": float(m.source_credits) if m.source_credits else None,
                "target_course": m.target_course,
                "target_credits": float(m.target_credits) if m.target_credits else None,
                "equivalence_type": m.equivalence_type,
                "notes": m.notes,
            }
            for m in table.course_mappings
        ],
    }


@router.post("/applications/{application_id}/intibak", status_code=status.HTTP_201_CREATED)
async def create_intibak_table(
    application_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    table = await svc.create_table(application_id, current_user.id)
    return {"id": str(table.id), "application_id": str(table.application_id), "status": table.status.value}


@router.get("/applications/{application_id}/intibak")
async def get_intibak_table_by_application(
    application_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from app.domain.document import Document
    from app.domain.enums import DocStatus, DocType

    svc = IntibakService(db)
    table = await svc.get_table_by_application(application_id)

    transcript_doc = await db.scalar(
        select(Document).where(
            Document.application_id == application_id,
            Document.doc_type == DocType.TRANSCRIPT,
            Document.status.in_([DocStatus.ACCEPTED, DocStatus.PENDING]),
        )
    )
    transcript_document_id = str(transcript_doc.id) if transcript_doc else None
    return _table_response(table, transcript_document_id)


@router.get("/intibak/suggest-match")
async def suggest_course_match(
    course_name: str,
    program_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    suggestions = await svc.suggest_matches(course_name, program_id)
    return suggestions


@router.get("/intibak/{table_id}")
async def get_intibak_table(
    table_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    table = await svc.get_table(table_id)
    return _table_response(table)


@router.post("/intibak/{table_id}/mappings", status_code=status.HTTP_201_CREATED)
async def add_course_mapping(
    table_id: uuid.UUID,
    body: CourseMappingCreate,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    mapping = await svc.add_mapping(
        table_id,
        body.source_course,
        body.source_credits,
        body.target_course,
        body.target_credits,
        body.equivalence_type,
        body.notes,
    )
    return {
        "id": str(mapping.id),
        "source_course": mapping.source_course,
        "target_course": mapping.target_course,
        "equivalence_type": mapping.equivalence_type,
    }


@router.put("/intibak/{table_id}/mappings/{mapping_id}")
async def update_course_mapping(
    table_id: uuid.UUID,
    mapping_id: uuid.UUID,
    body: CourseMappingUpdate,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    mapping = await svc.update_mapping(table_id, mapping_id, updates)
    return {"id": str(mapping.id), "equivalence_type": mapping.equivalence_type}


@router.delete("/intibak/{table_id}/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course_mapping(
    table_id: uuid.UUID,
    mapping_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    await svc.delete_mapping(table_id, mapping_id)


@router.post("/intibak/{table_id}/submit")
async def submit_intibak_table(
    table_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    table = await svc.submit_table(table_id, current_user.id)
    return {"status": table.status.value, "submitted_at": table.submitted_at}


@router.post("/intibak/{table_id}/approve")
async def approve_intibak_table(
    table_id: uuid.UUID,
    current_user=Depends(_require_dean),
    db: AsyncSession = Depends(get_db),
):
    svc = IntibakService(db)
    table = await svc.approve_table(table_id, current_user.id)
    return {"status": table.status.value, "approved_at": table.approved_at}


@router.post("/intibak/{table_id}/parse-transcript")
async def parse_transcript(
    table_id: uuid.UUID,
    force: bool = False,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
    storage: MinIOClient = Depends(get_minio_client),
):
    """
    Parse the applicant's transcript PDF and return a structured course list.

    - On the first call the PDF is fetched from MinIO, parsed with pdfplumber,
      and the result is saved to Document.extracted_data (JSONB).
    - If the same transcript was previously parsed and confirmed by the commission
      (extraction_confirmed=True) the cached result is returned directly.
    - The commission then uses POST /intibak/{table_id}/mappings to map the
      parsed courses to the target program's curriculum.

    Example response::

        {
          "document_id": "3fa85f64-...",
          "parser_strategy": "table",
          "warnings": [],
          "courses": [
            {
              "course_code": "MAT101",
              "course_name": "Calculus I",
              "credits": 4.0,
              "grade": "AA",
              "semester": "2022-2023 Fall"
            }
          ]
        }
    """
    svc = IntibakService(db)
    return await svc.parse_transcript_for_table(
        table_id=table_id,
        requester_id=current_user.id,
        storage=storage,
        force=force,
    )
