"""
SPEC-008: Verify Entrance Scores & Convert GPA
SPEC-009: Evaluate Department Specific Conditions
"""
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.domain.enums import AppStatus, UserRole
from app.services.evaluation_service import EvaluationService

router = APIRouter()

_require_ygk = require_role(UserRole.TRANSFER_COMMISSION)


class ScoreCorrectionRequest(BaseModel):
    field: Literal["yks_score", "gpa_4"]
    corrected_value: float
    correction_note: str


class EvaluateConditionsRequest(BaseModel):
    notes: Optional[str] = None
    rejection_override: bool = False
    portfolio_result: Optional[str] = None        # "Passed" | "Failed" | None
    rejection_justification: Optional[str] = None # explicit rejection reason text


class ManualCourseMappingRequest(BaseModel):
    external_course: str
    rule_key: str


# ---------------------------------------------------------------------------
# SPEC-008 endpoints
# ---------------------------------------------------------------------------

@router.get("/applications")
async def list_applications_for_ygk(
    status: Optional[AppStatus] = None,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    from app.domain.application import Application
    from app.domain.user import Applicant
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    q = (
        select(Application)
        .options(
            selectinload(Application.applicant).selectinload(Applicant.user),
            selectinload(Application.program),
            selectinload(Application.period),
            selectinload(Application.academic_record),
        )
    )
    if status:
        q = q.where(Application.status == status)
    else:
        q = q.where(Application.status.in_([AppStatus.RANKING]))

    result = await db.execute(q)
    apps = list(result.scalars().all())
    return [
        {
            "id": str(a.id),
            "tracking_number": a.tracking_number,
            "status": a.status.value,
            "program": a.program.name if a.program else None,
            "applicant": f"{a.applicant.user.first_name} {a.applicant.user.last_name}" if a.applicant and a.applicant.user else None,
        }
        for a in apps
    ]


@router.get("/applications/{application_id}/evaluation")
async def get_evaluation_detail(
    application_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = EvaluationService(db)
    detail = await svc.get_evaluation_detail(application_id)
    app = detail["application"]
    record = detail["academic_record"]

    return {
        "application_id": str(app.id),
        "status": app.status.value,
        "academic_record": {
            "gpa_4": float(record.gpa_4) if record and record.gpa_4 else None,
            "gpa_100": float(record.gpa_100) if record and record.gpa_100 else None,
            "yks_score": float(record.yks_score) if record and record.yks_score else None,
            "is_locked": record.is_locked if record else False,
            "source": record.source if record else None,
        } if record else None,
        "gpa_100_converted": detail["gpa_100_converted"],
        "documents": [{"id": str(d.id), "doc_type": d.doc_type.value, "status": d.status.value} for d in detail["documents"]],
    }


@router.post("/applications/{application_id}/verify-scores")
async def verify_scores(
    application_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = EvaluationService(db)
    record = await svc.verify_scores(application_id, current_user.id)
    return {
        "id": str(record.id),
        "gpa_4": float(record.gpa_4) if record.gpa_4 else None,
        "gpa_100": float(record.gpa_100) if record.gpa_100 else None,
        "yks_score": float(record.yks_score) if record.yks_score else None,
        "is_locked": record.is_locked,
        "application_status": "RANKING",
    }


@router.post("/applications/{application_id}/reject")
async def reject_application(
    application_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = EvaluationService(db)
    await svc.reject_application(application_id, current_user.id)
    return {"application_status": "REJECTED"}


@router.post("/applications/{application_id}/correct-score")
async def correct_score(
    application_id: uuid.UUID,
    body: ScoreCorrectionRequest,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    svc = EvaluationService(db)
    record = await svc.manually_correct_score(
        application_id,
        current_user.id,
        body.field,
        body.corrected_value,
        body.correction_note,
    )
    return {
        "id": str(record.id),
        "gpa_4": float(record.gpa_4) if record.gpa_4 else None,
        "gpa_100": float(record.gpa_100) if record.gpa_100 else None,
        "yks_score": float(record.yks_score) if record.yks_score else None,
        "is_locked": record.is_locked,
    }


# ---------------------------------------------------------------------------
# SPEC-009 endpoints
# ---------------------------------------------------------------------------

@router.get("/applications/{application_id}/dept-conditions")
async def get_dept_conditions(
    application_id: uuid.UUID,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    from app.services.eligibility_engine import EligibilityEngine
    engine = EligibilityEngine(db)
    return await engine.get_conditions_with_status(application_id)


@router.post("/applications/{application_id}/evaluate-conditions")
async def evaluate_conditions(
    application_id: uuid.UUID,
    body: EvaluateConditionsRequest,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    from app.services.eligibility_engine import EligibilityEngine
    engine = EligibilityEngine(db)
    result = await engine.evaluate_department_conditions(
        application_id,
        current_user.id,
        notes=body.notes,
        rejection_override=body.rejection_override,
        portfolio_result=body.portfolio_result,
        rejection_justification=body.rejection_justification,
    )
    return result


@router.post("/applications/{application_id}/manual-course-mapping")
async def manual_course_mapping(
    application_id: uuid.UUID,
    body: ManualCourseMappingRequest,
    current_user=Depends(_require_ygk),
    db: AsyncSession = Depends(get_db),
):
    from app.services.eligibility_engine import EligibilityEngine
    engine = EligibilityEngine(db)
    check = await engine.manual_course_mapping(
        application_id, body.external_course, body.rule_key, current_user.id
    )
    return {
        "id": str(check.id),
        "rule_key": check.rule_key,
        "passed": check.passed,
        "detail": check.detail,
    }
