"""
SPEC-014: Approve English Proficiency
SPEC-015: Announce English Proficiency Exam Results
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.domain.enums import AppStatus, UserRole
from app.services.english_service import EnglishProficiencyService

router = APIRouter()

# SYSTEM_ADMIN included so dev/test accounts can exercise YDYO flows.
_require_ydyo = require_role(UserRole.YDYO, UserRole.SYSTEM_ADMIN)


class ApproveEnglishRequest(BaseModel):
    exam_type: Optional[str] = None
    exam_score: Optional[float] = None
    notes: Optional[str] = None


class RejectEnglishRequest(BaseModel):
    rejection_reason: str
    notes: str = ""


class RouteToExamRequest(BaseModel):
    notes: str = ""


class ExamResult(BaseModel):
    application_id: uuid.UUID
    score: float
    passed: bool
    exam_type: Optional[str] = "IZTECH_EXAM"
    rejection_reason: Optional[str] = "INSUFFICIENT_SCORE"


class PublishExamResultsRequest(BaseModel):
    results: list[ExamResult]


# ---------------------------------------------------------------------------
# SPEC-014 endpoints
# ---------------------------------------------------------------------------

@router.get("/applications")
async def list_english_review_applications(
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
    scope: str = "all",
):
    """List applications in the YDYO's purview.

    scope=pending → only applications currently in ENGLISH_REVIEW status.
    scope=all     → also include applications that already have a
                    decision (DEPT_EVAL after approval, REJECTED after
                    rejection) so the dashboard can display them as
                    "Approved" / "Rejected" cards alongside pending ones.
    """
    from app.domain.application import Application
    from app.domain.english import EnglishProficiencyReview
    from app.domain.user import Applicant
    from sqlalchemy import or_, select
    from sqlalchemy.orm import selectinload

    query = (
        select(Application)
        .options(
            selectinload(Application.applicant).selectinload(Applicant.user),
            selectinload(Application.program),
            selectinload(Application.documents),
            selectinload(Application.english_proficiency_review),
        )
    )
    if scope == "pending":
        query = query.where(Application.status == AppStatus.ENGLISH_REVIEW)
    else:
        # YDYO purview: in ENGLISH_REVIEW now, OR already has a review row.
        query = query.outerjoin(
            EnglishProficiencyReview,
            EnglishProficiencyReview.application_id == Application.id,
        ).where(
            or_(
                Application.status == AppStatus.ENGLISH_REVIEW,
                EnglishProficiencyReview.id.isnot(None),
            )
        )

    apps = list((await db.execute(query)).scalars().unique().all())

    def cert_for(app):
        for d in app.documents:
            if d.doc_type.value == "LANGUAGE_CERT":
                return d
        return None

    def review_dict(app):
        r = app.english_proficiency_review
        if r is None:
            return None
        return {
            "approved": r.approved,
            "exam_type": r.exam_type,
            "exam_score": float(r.exam_score) if r.exam_score is not None else None,
            "notes": r.notes,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "must_take_exam": bool(r.must_take_exam),
            "exam_date": r.exam_date.isoformat() if r.exam_date else None,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "published_by": str(r.published_by) if r.published_by else None,
        }

    out = []
    for a in apps:
        cert = cert_for(a)
        out.append({
            "id": str(a.id),
            "tracking_number": a.tracking_number,
            "status": a.status.value,
            "program": a.program.name if a.program else None,
            "applicant": (
                f"{a.applicant.user.first_name} {a.applicant.user.last_name}"
                if a.applicant and a.applicant.user else None
            ),
            "certificate": (
                {
                    "id": str(cert.id),
                    "file_name": cert.file_name,
                    "status": cert.status.value,
                    "extracted_data": cert.extracted_data,
                }
                if cert is not None else None
            ),
            "english_review": review_dict(a),
        })
    return out


@router.get("/applications/{application_id}")
async def get_application_for_english_review(
    application_id: uuid.UUID,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    from app.repositories.application_repository import ApplicationRepository
    from fastapi import HTTPException
    repo = ApplicationRepository(db)
    app = await repo.get_by_id(application_id)
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return {
        "id": str(app.id),
        "tracking_number": app.tracking_number,
        "status": app.status.value,
        "program": app.program.name if app.program else None,
        "applicant_name": (
            f"{app.applicant.user.first_name} {app.applicant.user.last_name}"
            if app.applicant and app.applicant.user else None
        ),
        "applicant_email": app.applicant.user.email if app.applicant and app.applicant.user else None,
        "english_review": {
            "approved": app.english_proficiency_review.approved if app.english_proficiency_review else None,
            "exam_type": app.english_proficiency_review.exam_type if app.english_proficiency_review else None,
            "exam_score": (
                float(app.english_proficiency_review.exam_score)
                if app.english_proficiency_review and app.english_proficiency_review.exam_score else None
            ),
            "notes": app.english_proficiency_review.notes if app.english_proficiency_review else None,
            "reviewed_at": (
                app.english_proficiency_review.reviewed_at.isoformat()
                if app.english_proficiency_review and app.english_proficiency_review.reviewed_at else None
            ),
            "must_take_exam": bool(app.english_proficiency_review.must_take_exam),
        } if app.english_proficiency_review else None,
        "documents": [
            {
                "id": str(d.id),
                "doc_type": d.doc_type.value,
                "status": d.status.value,
                "file_name": d.file_name,
                "extracted_data": d.extracted_data,
            }
            for d in app.documents
        ],
    }


@router.post("/applications/{application_id}/approve-english")
async def approve_english(
    application_id: uuid.UUID,
    body: ApproveEnglishRequest,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    svc = EnglishProficiencyService(db)
    review = await svc.approve(
        application_id, current_user.id, body.exam_type, body.exam_score, notes=body.notes
    )
    return {
        "application_id": str(review.application_id),
        "approved": review.approved,
        "exam_type": review.exam_type,
        "exam_score": float(review.exam_score) if review.exam_score else None,
    }


@router.post("/applications/{application_id}/reject-english")
async def reject_english(
    application_id: uuid.UUID,
    body: RejectEnglishRequest,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    """Permanently reject the application due to a fundamentally invalid certificate
    (e.g. fraudulent, unverifiable, or wrong document type).
    For an insufficient score where the applicant may take the IZTECH exam instead,
    use POST /route-to-exam. This endpoint moves the application to REJECTED status
    and notifies the applicant — the decision is irreversible.
    """
    svc = EnglishProficiencyService(db)
    review = await svc.reject(
        application_id, current_user.id, body.rejection_reason, body.notes
    )
    return {
        "application_id": str(review.application_id),
        "approved": review.approved,
        "notes": review.notes,
    }


@router.post("/applications/{application_id}/route-to-exam")
async def route_to_exam(
    application_id: uuid.UUID,
    body: RouteToExamRequest,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    """Mark the application as 'must take the YDYO proficiency exam'.
    Status stays in ENGLISH_REVIEW; final decision is made later when the
    officer publishes exam results.
    """
    svc = EnglishProficiencyService(db)
    review = await svc.route_to_exam(application_id, current_user.id, body.notes)
    return {
        "application_id": str(review.application_id),
        "must_take_exam": review.must_take_exam,
        "notes": review.notes,
    }


class PublishSingleExamResultRequest(BaseModel):
    score: float
    passed: bool
    exam_type: Optional[str] = "IZTECH_EXAM"
    rejection_reason: Optional[str] = "INSUFFICIENT_SCORE"


class RecordExamResultRequest(BaseModel):
    score: float
    exam_type: Optional[str] = "IZTECH_EXAM"
    exam_date: Optional[str] = None  # ISO date — defaults to today if omitted


@router.post("/applications/{application_id}/exam-result")
async def publish_single_exam_result(
    application_id: uuid.UUID,
    body: PublishSingleExamResultRequest,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    """Publish a single applicant's IZTECH proficiency-exam result.
    Wraps publish_exam_results() so the UI can act on one row at a time.
    """
    svc = EnglishProficiencyService(db)
    result = await svc.publish_exam_results(
        [{
            "application_id": application_id,
            "score": body.score,
            "passed": body.passed,
            "exam_type": body.exam_type or "IZTECH_EXAM",
            "rejection_reason": body.rejection_reason or "INSUFFICIENT_SCORE",
        }],
        current_user.id,
    )
    return result


# ---------------------------------------------------------------------------
# UC-05-02 endpoints
# ---------------------------------------------------------------------------

@router.post("/applications/{application_id}/record-exam-result")
async def record_exam_result(
    application_id: uuid.UUID,
    body: RecordExamResultRequest,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    """Record an exam score (no publication). The row moves into the
    'Pending Publication' bucket; the officer must call /exam-results/publish-pending
    afterwards to make the decision irreversible."""
    from datetime import date as _date
    exam_date_value = None
    if body.exam_date:
        try:
            exam_date_value = _date.fromisoformat(body.exam_date)
        except ValueError:
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="exam_date must be ISO format YYYY-MM-DD",
            )

    svc = EnglishProficiencyService(db)
    review = await svc.record_exam_result(
        application_id, current_user.id, body.score, exam_date_value, body.exam_type or "IZTECH_EXAM",
    )
    return {
        "application_id": str(review.application_id),
        "exam_type": review.exam_type,
        "exam_score": float(review.exam_score) if review.exam_score is not None else None,
        "exam_date": review.exam_date.isoformat() if review.exam_date else None,
        "published_at": review.published_at.isoformat() if review.published_at else None,
    }


@router.post("/exam-results/publish-pending")
async def publish_pending_exam_results(
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    """SR1: irreversible bulk publication of every Pending Publication row."""
    svc = EnglishProficiencyService(db)
    return await svc.publish_pending_exam_results(current_user.id)


# ---------------------------------------------------------------------------
# SPEC-015 endpoints
# ---------------------------------------------------------------------------

@router.get("/exam-results")
async def list_exam_results(
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    """All applications that have been touched by an English-proficiency review,
    regardless of current application status (they may have moved on to
    DEPT_EVAL or REJECTED after the YDYO decision)."""
    from app.domain.application import Application
    from app.domain.english import EnglishProficiencyReview
    from app.domain.user import Applicant
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Application)
        .options(
            selectinload(Application.applicant).selectinload(Applicant.user),
            selectinload(Application.english_proficiency_review),
        )
        .join(
            EnglishProficiencyReview,
            EnglishProficiencyReview.application_id == Application.id,
        )
    )
    apps = list(result.scalars().all())
    return [
        {
            "application_id": str(a.id),
            "applicant_name": (
                f"{a.applicant.user.first_name} {a.applicant.user.last_name}"
                if a.applicant and a.applicant.user else None
            ),
            "score": (
                float(a.english_proficiency_review.exam_score)
                if a.english_proficiency_review and a.english_proficiency_review.exam_score else None
            ),
            "passed": a.english_proficiency_review.approved if a.english_proficiency_review else None,
        }
        for a in apps
    ]


@router.post("/exam-results/publish")
async def publish_exam_results(
    body: PublishExamResultsRequest,
    current_user=Depends(_require_ydyo),
    db: AsyncSession = Depends(get_db),
):
    svc = EnglishProficiencyService(db)
    result = await svc.publish_exam_results(
        [r.model_dump() for r in body.results],
        current_user.id,
    )
    return result
