"""
SPEC-016: Approve Transfer Application (Dean's Final Decision)
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.domain.enums import UserRole
from app.services.dean_service import DEAN_REJECTION_LABELS, DeanOfficeService

router = APIRouter()

_require_dean = require_role(UserRole.DEAN_OFFICE)


class ApproveRequest(BaseModel):
    pass


class RejectRequest(BaseModel):
    rejection_code: str
    note: str = ""


class RejectionCodeOption(BaseModel):
    code: str
    label: str


class DeanRejectAuditLog(BaseModel):
    dean_id: str
    dean_email: str | None
    dean_name: str | None
    action: str
    timestamp: str
    rejection_code: str
    rejection_reason: str
    note: str
    ip_address: str


class DeanRejectResponse(BaseModel):
    status: str
    message: str
    rejection_code: str
    rejection_reason: str
    notification_message: str
    audit_log: DeanRejectAuditLog


@router.get("/rejection-codes", response_model=list[RejectionCodeOption])
async def list_rejection_codes(
    current_user=Depends(_require_dean),
):
    return [
        RejectionCodeOption(code=code, label=label)
        for code, label in DEAN_REJECTION_LABELS.items()
    ]


@router.get("/applications")
async def list_applications_for_dean(
    program_id: Optional[uuid.UUID] = None,
    period_id: Optional[uuid.UUID] = None,
    current_user=Depends(_require_dean),
    db: AsyncSession = Depends(get_db),
):
    from app.domain.enums import AppStatus

    svc = DeanOfficeService(db)
    apps = await svc.list_applications(program_id, period_id)

    def dean_status(a) -> str:
        # Frontend-friendly badge: maps internal status to dean-cycle wording
        if a.status == AppStatus.DEAN_APPROVED:
            return "Pending"
        if a.status in (AppStatus.RANKING, AppStatus.ANNOUNCED):
            return "Approved"
        if a.status == AppStatus.REJECTED:
            return "Rejected"
        return a.status.value

    return [
        {
            "id": str(a.id),
            "tracking_number": a.tracking_number,
            "status": a.status.value,
            "dean_status": dean_status(a),
            "program": a.program.name if a.program else None,
            "applicant": (
                f"{a.applicant.user.first_name} {a.applicant.user.last_name}"
                if a.applicant and a.applicant.user
                else None
            ),
            "current_university": (
                a.academic_record.institution if a.academic_record else None
            ),
            "gpa": (
                float(a.academic_record.gpa_4)
                if a.academic_record and a.academic_record.gpa_4 is not None
                else None
            ),
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            "ranking_position": a.ranking_entry.position if a.ranking_entry else None,
            "composite_score": (
                float(a.ranking_entry.composite_score) if a.ranking_entry else None
            ),
            "intibak_status": (
                a.intibak_table.status.value if a.intibak_table else None
            ),
        }
        for a in apps
    ]


@router.get("/applications/{application_id}")
async def get_application_detail(
    application_id: uuid.UUID,
    current_user=Depends(_require_dean),
    db: AsyncSession = Depends(get_db),
):
    from app.domain.enums import AppStatus

    svc = DeanOfficeService(db)
    app = await svc.get_application_detail(application_id)
    record = app.academic_record
    review = app.english_proficiency_review

    def dean_status(s: AppStatus) -> str:
        if s == AppStatus.DEAN_APPROVED: return "Pending"
        if s in (AppStatus.DEAN_APPROVED, AppStatus.ANNOUNCED):  return "Approved"
        if s == AppStatus.REJECTED:   return "Rejected"
        return s.value

    return {
        "id": str(app.id),
        "tracking_number": app.tracking_number,
        "status": app.status.value,
        "dean_status": dean_status(app.status),
        "program": app.program.name if app.program else None,
        "submitted_at": app.submitted_at.isoformat() if app.submitted_at else None,
        "applicant": {
            "name": (
                f"{app.applicant.user.first_name} {app.applicant.user.last_name}"
                if app.applicant and app.applicant.user else None
            ),
            "email": app.applicant.user.email if app.applicant and app.applicant.user else None,
            "national_id": app.applicant.national_id if app.applicant else None,
        } if app.applicant else None,
        "academic_record": {
            "institution": record.institution,
            "gpa_4": float(record.gpa_4) if record and record.gpa_4 is not None else None,
            "gpa_100": float(record.gpa_100) if record and record.gpa_100 is not None else None,
            "yks_score": float(record.yks_score) if record and record.yks_score is not None else None,
            "credits_completed": record.credits_completed,
        } if record else None,
        "english_review": {
            "approved": review.approved,
            "exam_type": review.exam_type,
            "exam_score": float(review.exam_score) if review.exam_score is not None else None,
            "notes": review.notes,
            "reviewed_at": review.reviewed_at.isoformat() if review.reviewed_at else None,
            "must_take_exam": bool(review.must_take_exam),
            "exam_date": review.exam_date.isoformat() if review.exam_date else None,
            "published_at": review.published_at.isoformat() if review.published_at else None,
        } if review else None,
        "department_evaluations": [
            {
                "id": str(ev.id),
                "score": float(ev.score) if getattr(ev, "score", None) is not None else None,
                "decision": getattr(ev, "decision", None),
                "notes": getattr(ev, "notes", None),
                "evaluated_at": ev.evaluated_at.isoformat() if getattr(ev, "evaluated_at", None) else None,
            }
            for ev in (app.department_evaluations or [])
        ],
        "ranking_entry": {
            "position": app.ranking_entry.position,
            "composite_score": float(app.ranking_entry.composite_score),
            "is_primary": app.ranking_entry.is_primary,
        } if app.ranking_entry else None,
        "intibak_table": {
            "id": str(app.intibak_table.id),
            "status": app.intibak_table.status.value,
        } if app.intibak_table else None,
        "documents": [
            {
                "id": str(d.id),
                "doc_type": d.doc_type.value,
                "status": d.status.value,
                "file_name": d.file_name,
                "file_size_bytes": d.file_size_bytes,
                "extracted_data": d.extracted_data,
            }
            for d in (app.documents or [])
        ],
    }


@router.post("/applications/{application_id}/approve")
async def approve_final(
    application_id: uuid.UUID,
    request: Request,
    current_user=Depends(_require_dean),
    db: AsyncSession = Depends(get_db),
):
    ip_address = request.client.host if request.client else "unknown"
    svc = DeanOfficeService(db)
    app = await svc.approve_final(application_id, current_user.id, ip_address)
    return {
        "status": app.status.value,
        "message": "Dean's approval recorded — application routed to Transfer Commission",
    }


@router.post("/applications/{application_id}/reject", response_model=DeanRejectResponse)
async def reject_final(
    application_id: uuid.UUID,
    body: RejectRequest,
    request: Request,
    current_user=Depends(_require_dean),
    db: AsyncSession = Depends(get_db),
):
    ip_address = request.client.host if request.client else "unknown"
    svc = DeanOfficeService(db)
    app, log, rejection_reason = await svc.reject_final(
        application_id, current_user.id, body.rejection_code, body.note, ip_address
    )
    dean_name = f"{current_user.first_name} {current_user.last_name}".strip()
    return DeanRejectResponse(
        status=app.status.value,
        message="Transfer Rejected",
        rejection_code=body.rejection_code,
        rejection_reason=rejection_reason,
        notification_message="Applicant has been notified.",
        audit_log=DeanRejectAuditLog(
            dean_id=str(current_user.id),
            dean_email=current_user.email,
            dean_name=dean_name or None,
            action=log.action,
            timestamp=log.created_at.isoformat(),
            rejection_code=body.rejection_code,
            rejection_reason=rejection_reason,
            note=body.note,
            ip_address=ip_address,
        ),
    )
