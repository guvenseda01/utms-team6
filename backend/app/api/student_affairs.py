"""
SPEC-006: Student Affairs — Oversee Application Documents
SPEC-007: Student Affairs — Notify Transfer Results
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.dependencies import require_role
from app.domain.enums import AppStatus, UserRole
from app.schemas.application import ApplicationDetailResponse, EligibilityCheckResponse
from app.schemas.document import DocumentSummary
from app.schemas.staff import (
    AutoValidationResult,
    StaffApplicationDetail,
    StaffApplicationSummary,
)
from app.services.document_validation import build_auto_validation_results
from app.services.officer_service import OfficerApplicationService

router = APIRouter()

# SYSTEM_ADMIN included so admin/test accounts can exercise Student Affairs flows
_require_sa = require_role(UserRole.STUDENT_AFFAIRS, UserRole.SYSTEM_ADMIN)


class CorrectionRequest(BaseModel):
    note: str


class RejectionRequest(BaseModel):
    reason_code: str
    note: str = ""


class PublishResultsResponse(BaseModel):
    announced_count: int


def _applicant_name(app) -> Optional[str]:
    user = getattr(getattr(app, "applicant", None), "user", None)
    if user is None:
        return None
    return f"{user.first_name} {user.last_name}".strip()


def _applicant_email(app) -> Optional[str]:
    user = getattr(getattr(app, "applicant", None), "user", None)
    return user.email if user else None


# ---------------------------------------------------------------------------
# SPEC-006 endpoints
# ---------------------------------------------------------------------------

@router.get("/applications", response_model=list[StaffApplicationSummary])
async def list_applications(
    status: Optional[AppStatus] = None,
    program_id: Optional[uuid.UUID] = None,
    period_id: Optional[uuid.UUID] = None,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    apps = await svc.list_applications(status, program_id, period_id)
    return [
        StaffApplicationSummary(
            id=app.id,
            program_id=app.program_id,
            period_id=app.period_id,
            status=app.status.value,
            tracking_number=app.tracking_number,
            submitted_at=app.submitted_at,
            created_at=app.created_at,
            applicant_name=_applicant_name(app),
            applicant_email=_applicant_email(app),
            auto_validation_results=[
                AutoValidationResult(**r)
                for r in build_auto_validation_results(app)
            ],
        )
        for app in apps
    ]


@router.get("/applications/{application_id}", response_model=StaffApplicationDetail)
async def get_application(
    application_id: uuid.UUID,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    app = await svc.get_application(application_id)
    return StaffApplicationDetail(
        id=app.id,
        applicant_id=app.applicant_id,
        program_id=app.program_id,
        period_id=app.period_id,
        status=app.status.value,
        tracking_number=app.tracking_number,
        submitted_at=app.submitted_at,
        created_at=app.created_at,
        updated_at=app.updated_at,
        progress=app.get_progress(),
        eligibility_checks=[
            EligibilityCheckResponse(
                rule_key=c.rule_key,
                passed=c.passed,
                detail=c.detail,
            )
            for c in app.eligibility_checks
        ],
        applicant_name=_applicant_name(app),
        applicant_email=_applicant_email(app),
        documents=[DocumentSummary.model_validate(d) for d in app.documents],
    )


@router.post("/applications/{application_id}/approve-verification")
async def approve_verification(
    application_id: uuid.UUID,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    app = await svc.approve_verification(application_id, current_user.id)
    return {"id": str(app.id), "status": app.status.value}


@router.post("/applications/{application_id}/request-correction")
async def request_correction(
    application_id: uuid.UUID,
    body: CorrectionRequest,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    app = await svc.request_correction(application_id, current_user.id, body.note)
    return {"id": str(app.id), "status": app.status.value}


@router.post("/applications/{application_id}/announce")
async def announce_application(
    application_id: uuid.UUID,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    """Publish the final transfer result for a dean-approved application."""
    svc = OfficerApplicationService(db)
    app = await svc.announce_application(application_id, current_user.id)
    return {"id": str(app.id), "status": app.status.value, "message": "Result announced"}


@router.post("/applications/{application_id}/reject")
async def reject_application(
    application_id: uuid.UUID,
    body: RejectionRequest,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    app = await svc.reject_application(
        application_id, current_user.id, body.reason_code, body.note
    )
    return {"id": str(app.id), "status": app.status.value}


# ---------------------------------------------------------------------------
# SPEC-007 endpoints
# ---------------------------------------------------------------------------

@router.get("/results/{period_id}/{program_id}")
async def get_results(
    period_id: uuid.UUID,
    program_id: uuid.UUID,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    data = await svc.get_results(period_id, program_id)
    ranking = data["ranking"]
    return {
        "ranking_id": str(ranking.id),
        "status": ranking.status.value,
        "published_at": ranking.published_at,
        "primary": [
            {
                "application_id": str(e.application_id),
                "position": e.position,
                "composite_score": float(e.composite_score),
                "first_name": e.application.applicant.user.first_name,
                "last_name": e.application.applicant.user.last_name,
                "email": e.application.applicant.user.email,
            }
            for e in data["primary"]
        ],
        "waitlisted": [
            {
                "application_id": str(e.application_id),
                "position": e.position,
                "composite_score": float(e.composite_score),
                "first_name": e.application.applicant.user.first_name,
                "last_name": e.application.applicant.user.last_name,
                "email": e.application.applicant.user.email,
            }
            for e in data["waitlisted"]
        ],
    }


@router.post(
    "/results/{period_id}/{program_id}/publish",
    response_model=PublishResultsResponse,
)
async def publish_results(
    period_id: uuid.UUID,
    program_id: uuid.UUID,
    current_user=Depends(_require_sa),
    db: AsyncSession = Depends(get_db),
):
    svc = OfficerApplicationService(db)
    result = await svc.publish_results(period_id, program_id, current_user.id)
    return PublishResultsResponse(**result)
