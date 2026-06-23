"""
Unit tests for ApplicationService (SPEC-004).
All DB and external adapter calls are mocked — no PostgreSQL or real services needed.

Covers test scenarios T1–T5, T8–T10, T12 from SPEC-004.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.domain.application import Application
from app.domain.eligibility import EligibilityCheck
from app.domain.enums import AppStatus, DocType
from app.domain.period import ApplicationPeriod
from app.domain.program import Program
from app.services.application_service import ApplicationService
from app.services.document_service import DocumentService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db():
    session = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()
    return session


def _make_period(is_open: bool = True) -> ApplicationPeriod:
    p = ApplicationPeriod()
    p.id = uuid.uuid4()
    p.label = "2024 Spring"
    p.is_active = is_open
    now = datetime.now(timezone.utc)
    p.opens_at = now - timedelta(days=1)
    p.closes_at = now + timedelta(days=30)
    return p


def _make_program(min_gpa: Decimal | None = Decimal("3.00")) -> Program:
    prog = Program()
    prog.id = uuid.uuid4()
    prog.name = "Computer Engineering"
    prog.code = "CE"
    prog.faculty = "Engineering"
    prog.quota = 10
    prog.min_gpa = min_gpa
    prog.is_active = True
    return prog


def _make_application(
    status: AppStatus = AppStatus.DRAFT,
    docs: list | None = None,
    checks: list | None = None,
) -> MagicMock:
    """Return a plain MagicMock so SQLAlchemy relationship instrumentation is bypassed."""
    app = MagicMock()
    app.id = uuid.uuid4()
    app.applicant_id = uuid.uuid4()
    app.program_id = uuid.uuid4()
    app.period_id = uuid.uuid4()
    app.status = status
    app.tracking_number = None
    app.submitted_at = None
    app.created_at = datetime.now(timezone.utc)
    app.updated_at = datetime.now(timezone.utc)
    app.documents = docs or []
    app.eligibility_checks = checks or []
    app.academic_record = None

    applicant = MagicMock()
    applicant.id = app.applicant_id
    applicant.national_id = "12345678901"
    app.applicant = applicant

    program = MagicMock()
    program.name = "Computer Engineering"
    app.program = program

    return app


def _make_service(db, period=None, program=None, application=None):
    """Build an ApplicationService with all repositories mocked."""
    service = ApplicationService(db)

    service._period_repo = AsyncMock()
    service._period_repo.get_by_id = AsyncMock(return_value=period)

    service._program_repo = AsyncMock()
    service._program_repo.get_by_id = AsyncMock(return_value=program)

    service._app_repo = AsyncMock()
    service._app_repo.get_by_id = AsyncMock(return_value=application)
    service._app_repo.get_by_program_and_period = AsyncMock(return_value=None)
    service._app_repo.save = AsyncMock()
    service._app_repo.count_submitted_this_year = AsyncMock(return_value=0)

    service._elig_repo = AsyncMock()
    service._elig_repo.save = AsyncMock()
    service._elig_repo.get_by_application = AsyncMock(return_value=[])

    return service


# ---------------------------------------------------------------------------
# T1 — Create application during open period → 201, status=DRAFT
# ---------------------------------------------------------------------------

async def test_create_application_open_period_returns_draft():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    period = _make_period(is_open=True)
    program = _make_program()
    service = _make_service(db, period=period, program=program)

    result = await service.create_application(
        applicant_id=uuid.uuid4(),
        program_id=program.id,
        period_id=period.id,
    )

    assert result.status == AppStatus.DRAFT
    service._app_repo.save.assert_called_once()


# ---------------------------------------------------------------------------
# T2 — Duplicate application → 409
# ---------------------------------------------------------------------------

async def test_create_application_duplicate_returns_409():
    db = AsyncMock()
    period = _make_period(is_open=True)
    program = _make_program()
    existing = _make_application()
    service = _make_service(db, period=period, program=program)
    service._app_repo.get_by_program_and_period = AsyncMock(return_value=existing)

    with pytest.raises(HTTPException) as exc_info:
        await service.create_application(
            applicant_id=uuid.uuid4(),
            program_id=program.id,
            period_id=period.id,
        )

    assert exc_info.value.status_code == 409


# ---------------------------------------------------------------------------
# T3 — Create when period closed → 403
# ---------------------------------------------------------------------------

async def test_create_application_closed_period_returns_403():
    db = AsyncMock()
    period = _make_period(is_open=False)
    service = _make_service(db, period=period)

    with pytest.raises(HTTPException) as exc_info:
        await service.create_application(
            applicant_id=uuid.uuid4(),
            program_id=uuid.uuid4(),
            period_id=period.id,
        )

    assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# T4 — Fetch academic data from parsed documents only
# ---------------------------------------------------------------------------

async def test_fetch_academic_data_from_parsed_documents():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    application = _make_application()
    service = _make_service(db, application=application)

    now = datetime.now(timezone.utc)
    transcript = MagicMock()
    transcript.doc_type = DocType.TRANSCRIPT
    transcript.uploaded_at = now
    transcript.extracted_data = {
        "gpa": 3.55,
        "institution": "EXAMPLE UNIVERSITY",
        "completed_credits": 34,
    }
    yks = MagicMock()
    yks.doc_type = DocType.YKS_RESULT
    yks.uploaded_at = now
    yks.extracted_data = {"placement_score": 392.144, "score": 392.144}

    service._doc_repo = AsyncMock()
    service._doc_repo.get_by_application = AsyncMock(return_value=[transcript, yks])

    async def _passthrough(doc):
        return doc

    with patch.object(DocumentService, "backfill_extraction", side_effect=_passthrough):
        result = await service.fetch_academic_data(application.id)

    assert result["gpa_4"] == 3.55
    assert result["yks_score"] == 392.144
    assert "TRANSCRIPT" in (result["source"] or "")
    assert "YKS" in (result["source"] or "")
    assert result["errors"] is None


# ---------------------------------------------------------------------------
# T5 — Fetch with no uploaded/parsed documents → empty + message
# ---------------------------------------------------------------------------

async def test_fetch_academic_data_no_documents_returns_message():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    application = _make_application()
    service = _make_service(db, application=application)

    service._doc_repo = AsyncMock()
    service._doc_repo.get_by_application = AsyncMock(return_value=[])

    async def _passthrough(doc):
        return doc

    with patch.object(DocumentService, "backfill_extraction", side_effect=_passthrough):
        result = await service.fetch_academic_data(application.id)

    assert result["gpa_4"] is None
    assert result["yks_score"] is None
    assert result["errors"] is not None
    assert any("uploaded documents" in e.lower() for e in result["errors"])


# ---------------------------------------------------------------------------
# T8 — Submit with all docs + GPA passes → 200, tracking number issued
# ---------------------------------------------------------------------------

async def test_submit_application_success():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()

    doc_transcript = MagicMock()
    doc_transcript.doc_type = DocType.TRANSCRIPT
    doc_yks = MagicMock()
    doc_yks.doc_type = DocType.YKS_RESULT
    doc_id = MagicMock()
    doc_id.doc_type = DocType.ID_COPY

    check = MagicMock()
    check.passed = True

    application = _make_application(
        status=AppStatus.DRAFT,
        docs=[doc_transcript, doc_yks, doc_id],
        checks=[check],
    )
    service = _make_service(db, application=application)
    service._app_repo.count_submitted_this_year = AsyncMock(return_value=0)

    with (
        patch.object(service, "_change_status_internal", new=AsyncMock()),
        patch(
            "app.services.application_service.NotificationService.enqueue",
            new=AsyncMock(),
        ),
    ):
        result = await service.submit_application(application.id)

    assert result.tracking_number is not None
    assert "APP-" in result.tracking_number


# ---------------------------------------------------------------------------
# T9 — Submit with GPA below threshold → 422 with specific reason
# ---------------------------------------------------------------------------

async def test_submit_application_gpa_fails_422():
    db = AsyncMock()

    doc_transcript = MagicMock()
    doc_transcript.doc_type = DocType.TRANSCRIPT
    doc_yks = MagicMock()
    doc_yks.doc_type = DocType.YKS_RESULT
    doc_id = MagicMock()
    doc_id.doc_type = DocType.ID_COPY

    failed_check = MagicMock()
    failed_check.passed = False
    failed_check.detail = "GPA 2.30 < minimum 3.00"
    failed_check.rule_key = "MIN_GPA"

    application = _make_application(
        status=AppStatus.DRAFT,
        docs=[doc_transcript, doc_yks, doc_id],
        checks=[failed_check],
    )
    service = _make_service(db, application=application)

    with pytest.raises(HTTPException) as exc_info:
        await service.submit_application(application.id)

    assert exc_info.value.status_code == 422
    assert "2.30" in exc_info.value.detail


# ---------------------------------------------------------------------------
# T10 — Submit with missing required doc → 422, lists missing doc types
# ---------------------------------------------------------------------------

async def test_submit_application_missing_doc_422():
    db = AsyncMock()

    doc_transcript = MagicMock()
    doc_transcript.doc_type = DocType.TRANSCRIPT

    application = _make_application(
        status=AppStatus.DRAFT,
        docs=[doc_transcript],
        checks=[],
    )
    service = _make_service(db, application=application)

    with pytest.raises(HTTPException) as exc_info:
        await service.submit_application(application.id)

    assert exc_info.value.status_code == 422
    assert "Missing required documents" in exc_info.value.detail


# ---------------------------------------------------------------------------
# T12 — Invalid status transition → 422
# ---------------------------------------------------------------------------

async def test_invalid_status_transition_raises_422():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()

    application = _make_application(status=AppStatus.DRAFT)
    service = _make_service(db, application=application)

    with pytest.raises(HTTPException) as exc_info:
        await service.change_status(
            application_id=application.id,
            new_status=AppStatus.RANKING,
            actor_id=uuid.uuid4(),
        )

    assert exc_info.value.status_code == 422
    assert "Invalid status transition" in exc_info.value.detail


# ---------------------------------------------------------------------------
# T12b — Valid transition DRAFT → SUBMITTED
# ---------------------------------------------------------------------------

async def test_valid_transition_draft_to_submitted():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()

    application = _make_application(status=AppStatus.DRAFT)
    service = _make_service(db, application=application)

    result = await service.change_status(
        application_id=application.id,
        new_status=AppStatus.SUBMITTED,
        actor_id=uuid.uuid4(),
    )

    assert result.status == AppStatus.SUBMITTED
