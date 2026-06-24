"""
UTMS End-to-End Full Workflow Test
===================================
Tests the complete transfer application lifecycle from registration through
final announcement -- completely isolated from the production database.

Run:
    cd backend
    pytest tests/e2e/test_full_workflow.py -v -s

Prerequisites:
    - PostgreSQL running on localhost:5432 (user: utms / pass: utms)
    - No other services required (Redis, MinIO, Celery are all in-memory mocked)

The test:
    1. Creates a fresh isolated database ``utms_e2e_test``
    2. Builds the schema with SQLAlchemy create_all
    3. Seeds an admin user, a program, and an open application period
    4. Runs through every workflow step with assertions at each transition
    5. Drops the test database on completion (even on failure)

Workflow covered:
    Admin setup -> Staff creation -> Applicant registration ->
    Email verification -> Application (DRAFT) -> Document upload ->
    Fetch academic data -> Submit (SUBMITTED) -> SA approve
    (ENGLISH_REVIEW) -> YDYO approve (DEAN_APPROVED) ->
    Dean approve (RANKING) -> YGK score correction -> YGK verify ->
    YGK generate ranking -> YGK approve ranking ->
    SA announce (ANNOUNCED) -> Applicant checks status
"""

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

# ---------------------------------------------------------------------------
# PDF file paths
# ---------------------------------------------------------------------------
# Five parent dirs up from this file reaches C:\Users\Mertguden\Desktop\UTM
_UTM_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent

_PDF_MAP = {
    "TRANSCRIPT":        "transcript.pdf",
    "YKS_RESULT":        "yks_score_report.pdf",
    "ID_COPY":           "id_copy.pdf",
    "LANGUAGE_CERT":     "language_certificate.pdf",
    "DISCIPLINE_RECORD": "discipline_record.pdf",
    "MILITARY_STATUS":   "military_status.pdf",
}

# Minimal valid single-page PDF (fallback if a file is missing)
_MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\n"
    b"xref\n0 4\n"
    b"0000000000 65535 f\r\n"
    b"0000000009 00000 n\r\n"
    b"0000000058 00000 n\r\n"
    b"0000000115 00000 n\r\n"
    b"trailer<</Size 4/Root 1 0 R>>\n"
    b"startxref\n190\n%%EOF"
)


def _load_pdf(doc_type: str) -> bytes:
    """Return real PDF bytes or fall back to the minimal placeholder."""
    filename = _PDF_MAP.get(doc_type, "")
    path = _UTM_ROOT / filename
    if path.exists():
        return path.read_bytes()
    return _MINIMAL_PDF


# ---------------------------------------------------------------------------
# Test database
# ---------------------------------------------------------------------------
_E2E_DB   = "utms_e2e_test"
# Port 5433 matches the docker-compose.yml host mapping (5433:5432)
_PG_HOST  = "localhost"
_PG_PORT  = 5433
_PG_USER  = "utms"
_PG_PASS  = "utms"
_E2E_URL  = f"postgresql+asyncpg://{_PG_USER}:{_PG_PASS}@{_PG_HOST}:{_PG_PORT}/{_E2E_DB}"
_PG_DSN   = f"postgresql://{_PG_USER}:{_PG_PASS}@{_PG_HOST}:{_PG_PORT}/utms"


async def _pg_connect_or_skip() -> asyncpg.Connection:
    """
    Return an asyncpg connection to the main database.
    Skips the test with a helpful message if PostgreSQL is not reachable.
    """
    try:
        return await asyncpg.connect(_PG_DSN, timeout=5)
    except (OSError, asyncpg.exceptions.PostgresConnectionError, Exception) as exc:
        pytest.skip(
            f"PostgreSQL not reachable at {_PG_HOST}:{_PG_PORT} -- "
            f"start Docker: `docker-compose up -d db`  ({exc})"
        )


async def _create_e2e_db() -> None:
    """Create the isolated test database (uses asyncpg, autocommit)."""
    conn = await _pg_connect_or_skip()
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", _E2E_DB
        )
        if not exists:
            await conn.execute(f'CREATE DATABASE "{_E2E_DB}"')
    finally:
        await conn.close()


async def _drop_e2e_db() -> None:
    """Drop the test database, terminating any stray connections first."""
    try:
        conn = await asyncpg.connect(_PG_DSN, timeout=5)
    except Exception:
        return  # if PG is gone just skip cleanup
    try:
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            _E2E_DB,
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{_E2E_DB}"')
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# In-memory mock stores
# ---------------------------------------------------------------------------
_redis: dict = {}   # Redis JTI + email-verify + pwd-reset tokens
_minio: dict = {}   # MinIO object store  {object_key: (bytes, content_type)}


class _MockMinio:
    """In-memory MinIO replacement used throughout the test."""

    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        _minio[key] = (bytes(data), content_type)

    def get_object(self, key: str):
        data, _ = _minio.get(key, (_MINIMAL_PDF, "application/pdf"))

        class _FakeResponse:
            def read(self_) -> bytes:
                return data

            def close(self_) -> None:
                pass

            def release_conn(self_) -> None:
                pass

        return _FakeResponse()

    def get_object_metadata(self, key: str) -> dict:
        if key not in _minio:
            raise OSError(f"Object not found: {key}")
        data, ct = _minio[key]
        return {"content_type": ct, "size": len(data), "etag": "test-etag"}

    def generate_presigned_put(self, key: str, ttl: int = 300) -> str:
        return f"http://mock-minio/put/{key}"

    def generate_presigned_get(self, key: str, ttl: int = 300) -> str:
        return f"http://mock-minio/get/{key}"


# ---------------------------------------------------------------------------
# Redis mock coroutines
# ---------------------------------------------------------------------------
async def _r_store_jti(jti: str, ttl: int, user_id: str = None) -> None:
    _redis[f"jti:{jti}"] = user_id or "1"


async def _r_revoke_jti(jti: str) -> None:
    _redis.pop(f"jti:{jti}", None)


async def _r_is_jti_valid(jti: str) -> bool:
    return f"jti:{jti}" in _redis


async def _r_store_ev(token: str, user_id: str) -> None:
    _redis[f"ev:{token}"] = user_id


async def _r_get_ev(token: str):
    return _redis.get(f"ev:{token}")


async def _r_del_ev(token: str) -> None:
    _redis.pop(f"ev:{token}", None)


async def _r_store_pr(token: str, user_id: str) -> None:
    _redis[f"pr:{token}"] = user_id


async def _r_get_pr(token: str):
    return _redis.get(f"pr:{token}")


async def _r_del_pr(token: str) -> None:
    _redis.pop(f"pr:{token}", None)


async def _r_publish(*_a, **_kw) -> None:
    pass  # SSE pub/sub -- no-op in tests


async def _r_revoke_all(user_id: str) -> None:
    for k in list(_redis):
        if k.startswith("jti:"):
            del _redis[k]


# ---------------------------------------------------------------------------
# Pytest fixture wiring
# ---------------------------------------------------------------------------
pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------------------
# Main test
# ---------------------------------------------------------------------------
@pytest.mark.anyio
async def test_full_workflow() -> None:
    """
    Complete transfer-application lifecycle.

    Each numbered step mirrors the real student-facing and staff-facing
    workflows.  The test uses the production FastAPI app wired to an
    isolated PostgreSQL database and in-memory mocks for Redis / MinIO.
    """

    # ======================================================================
    # SETUP -- database, schema, dependency overrides, patches
    # ======================================================================
    print("\n" + "=" * 65)
    print("  UTMS END-TO-END TEST -- Full Workflow")
    print("=" * 65)

    print("\n[SETUP] Creating isolated test database...")
    await _create_e2e_db()

    # Import every domain model so SQLAlchemy's registry is fully populated
    import app.domain.academic_record  # noqa: F401
    import app.domain.application       # noqa: F401
    import app.domain.audit             # noqa: F401
    import app.domain.document          # noqa: F401
    import app.domain.eligibility       # noqa: F401
    import app.domain.english           # noqa: F401
    import app.domain.intibak           # noqa: F401
    import app.domain.notification      # noqa: F401
    import app.domain.period            # noqa: F401
    import app.domain.program           # noqa: F401
    import app.domain.qa                # noqa: F401
    import app.domain.ranking           # noqa: F401
    import app.domain.user              # noqa: F401
    from app.domain.base import Base

    # NullPool: no connection reuse — every request gets a fresh connection and
    # closes it immediately after use.  This sidesteps all pooling/stale-connection
    # issues that can occur when DDL and DML share the same pool in tests.
    engine = create_async_engine(_E2E_URL, echo=False, future=True, poolclass=NullPool)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    print("[SETUP] Schema created")

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Dependency overrides
    from app.core.database import get_db
    from app.core.storage import get_minio_client
    from app.main import app as fastapi_app

    mock_minio = _MockMinio()

    async def _override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    def _override_get_minio():
        return mock_minio

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    fastapi_app.dependency_overrides[get_minio_client] = _override_get_minio

    # Patches list -- started below, stopped in finally
    # passlib 1.7.4 + bcrypt 4+ compat: bcrypt now strictly rejects passwords > 72 bytes,
    # but passlib's internal detect_wrap_bug() hashes a 255-byte probe that trips this.
    # We patch bcrypt.hashpw to silently truncate at 72 bytes (the pre-4.x behaviour).
    import bcrypt as _bcrypt_lib
    _orig_hashpw = _bcrypt_lib.hashpw

    def _permissive_hashpw(password: bytes, salt: bytes) -> bytes:
        if isinstance(password, (bytes, bytearray)) and len(password) > 72:
            password = password[:72]
        return _orig_hashpw(password, salt)

    patches = [
        patch("bcrypt.hashpw", side_effect=_permissive_hashpw),
        # Auth service JTI (imports at module level)
        patch("app.services.auth_service.store_jti",    side_effect=_r_store_jti),
        patch("app.services.auth_service.revoke_jti",   side_effect=_r_revoke_jti),
        patch("app.services.auth_service.is_jti_valid", side_effect=_r_is_jti_valid),
        # Dependencies JTI check
        patch("app.core.dependencies.is_jti_valid",     side_effect=_r_is_jti_valid),
        # Registration service email-verify token (module-level imports)
        patch("app.services.registration_service.store_email_verify_token", side_effect=_r_store_ev),
        patch("app.services.registration_service.get_email_verify_token",   side_effect=_r_get_ev),
        patch("app.services.registration_service.delete_email_verify_token",side_effect=_r_del_ev),
        # Password reset service token helpers
        patch("app.services.password_reset_service.store_pwd_reset_token",  side_effect=_r_store_pr),
        patch("app.services.password_reset_service.get_pwd_reset_token",    side_effect=_r_get_pr),
        patch("app.services.password_reset_service.delete_pwd_reset_token", side_effect=_r_del_pr),
        # Core redis publish (called with local import inside functions)
        patch("app.core.redis.publish_status_change",   side_effect=_r_publish),
        patch("app.core.redis.revoke_all_user_jtis",    side_effect=_r_revoke_all),
        # Celery/Redis: mock _dispatch to a no-op so notifications don't
        # spend 20 seconds retrying a Redis broker that isn't running.
        patch(
            "app.services.notification_service.NotificationService._dispatch",
            staticmethod(lambda *_a, **_kw: None),
        ),
    ]
    for p in patches:
        p.start()

    try:
        # ==================================================================
        # SEED -- admin, program, open period
        # ==================================================================
        from app.core.security import hash_password
        from app.domain.enums import UserRole
        from app.domain.period import ApplicationPeriod
        from app.domain.program import Program
        from app.domain.user import Staff, User

        admin_id   = uuid.uuid4()
        program_id = uuid.uuid4()
        period_id  = uuid.uuid4()
        now_utc    = datetime.now(timezone.utc)

        async with session_factory() as db:
            admin_user = User(
                id=admin_id,
                email="admin@iyte.edu.tr",
                password_hash=hash_password("Admin1234!"),
                role=UserRole.SYSTEM_ADMIN,
                first_name="Admin",
                last_name="Test",
                is_active=True,
                is_verified=True,
                must_change_password=False,
            )
            db.add(admin_user)
            await db.flush()

            db.add(Staff(id=admin_id, department="IT", title="System Admin"))

            db.add(Program(
                id=program_id,
                name="Computer Engineering",
                code="CE101",
                faculty="Engineering",
                quota=5,
                min_gpa=None,
                is_active=True,
            ))

            db.add(ApplicationPeriod(
                id=period_id,
                label="2025-2026 Fall E2E",
                opens_at=now_utc - timedelta(days=1),
                closes_at=now_utc + timedelta(days=30),
                is_active=True,
                created_by=admin_id,
            ))
            await db.commit()

        print("[SEED]  Admin user, Program 'CE101', Period created")

        # ==================================================================
        # HTTP clients -- one per role/session (each has its own cookie jar)
        # ==================================================================
        transport = ASGITransport(app=fastapi_app)

        async with (
            AsyncClient(transport=transport, base_url="http://test") as admin_c,
            AsyncClient(transport=transport, base_url="http://test") as applicant_c,
            AsyncClient(transport=transport, base_url="http://test") as tc_c,    # Transfer Commission
            AsyncClient(transport=transport, base_url="http://test") as dean_c,
        ):

            # ==============================================================
            # STEP 1 -- Admin logs in
            # ==============================================================
            print("\n[01] Admin login")
            r = await admin_c.post("/api/auth/login", json={
                "email": "admin@iyte.edu.tr",
                "password": "Admin1234!",
            })
            assert r.status_code == 200, f"Admin login failed: {r.text}"
            assert r.json()["role"] == "SYSTEM_ADMIN"
            print(f"     OK role={r.json()['role']}")

            # ==============================================================
            # STEP 2 -- Admin creates Transfer Commission + Dean staff
            # ==============================================================
            print("\n[02] Admin creates staff accounts")

            r = await admin_c.post("/api/admin/staff", json={
                "email": "ygk@iyte.edu.tr",
                "first_name": "Transfer",
                "last_name": "Commission",
                "role": "TRANSFER_COMMISSION",
                "department": "Academic Affairs",
            })
            assert r.status_code == 201, f"YGK staff creation failed: {r.text}"
            ygk_pw = r.json()["temp_password"]
            print(f"     OK YGK staff created (temp_pw={ygk_pw})")

            r = await admin_c.post("/api/admin/staff", json={
                "email": "dean@iyte.edu.tr",
                "first_name": "Dean",
                "last_name": "Office",
                "role": "DEAN_OFFICE",
                "department": "Dean",
            })
            assert r.status_code == 201, f"Dean staff creation failed: {r.text}"
            dean_pw = r.json()["temp_password"]
            print(f"     OK Dean staff created (temp_pw={dean_pw})")

            # ==============================================================
            # STEP 3 -- Staff log in
            # ==============================================================
            print("\n[03] Staff logins")

            r = await tc_c.post("/api/auth/login", json={
                "email": "ygk@iyte.edu.tr", "password": ygk_pw,
            })
            assert r.status_code == 200, f"YGK login failed: {r.text}"
            print(f"     OK YGK logged in (role={r.json()['role']})")

            r = await dean_c.post("/api/auth/login", json={
                "email": "dean@iyte.edu.tr", "password": dean_pw,
            })
            assert r.status_code == 200, f"Dean login failed: {r.text}"
            print(f"     OK Dean logged in (role={r.json()['role']})")

            # ==============================================================
            # STEP 4 -- Applicant registers
            # ==============================================================
            print("\n[04] Applicant registration")
            r = await applicant_c.post("/api/auth/register", json={
                "national_id":        "12345678901",
                "date_of_birth":      "2000-03-15",
                "first_name":         "Ahmet",
                "last_name":          "Yilmaz",
                "university_email":   "ahmet@iyte.edu.tr",
                "password":           "Ahmet1234!",
                "password_confirm":   "Ahmet1234!",
            })
            assert r.status_code == 201, f"Registration failed: {r.text}"
            print("     OK Registered")

            # ==============================================================
            # STEP 5 -- Email verification (token captured from mock Redis)
            # ==============================================================
            print("\n[05] Email verification")
            ev_token = next(
                (k[3:] for k in _redis if k.startswith("ev:")), None
            )
            assert ev_token, "Email verification token not found in mock Redis!"
            r = await applicant_c.post(f"/api/auth/verify-email/{ev_token}")
            assert r.status_code == 200, f"Email verification failed: {r.text}"
            print(f"     OK Email verified (token={ev_token[:8]}...)")

            # ==============================================================
            # STEP 6 -- Applicant logs in
            # ==============================================================
            print("\n[06] Applicant login")
            r = await applicant_c.post("/api/auth/login", json={
                "email": "ahmet@iyte.edu.tr", "password": "Ahmet1234!",
            })
            assert r.status_code == 200, f"Applicant login failed: {r.text}"
            assert r.json()["role"] == "APPLICANT"
            print(f"     OK Logged in (role={r.json()['role']})")

            # ==============================================================
            # STEP 7 -- Create application (DRAFT)
            # ==============================================================
            print("\n[07] Create application")
            r = await applicant_c.post("/api/applications", json={
                "program_id": str(program_id),
                "period_id":  str(period_id),
            })
            assert r.status_code == 201, f"Create application failed: {r.text}"
            assert r.json()["status"] == "DRAFT"
            app_id = r.json()["application_id"]
            print(f"     OK Created (id={app_id[:8]}..., status=DRAFT)")

            # ==============================================================
            # STEP 8 -- Upload all documents
            # ==============================================================
            print("\n[08] Upload documents")
            doc_uploads = [
                "TRANSCRIPT",
                "YKS_RESULT",
                "ID_COPY",
                "LANGUAGE_CERT",
                "DISCIPLINE_RECORD",
                "MILITARY_STATUS",
            ]
            for doc_type in doc_uploads:
                pdf_bytes = _load_pdf(doc_type)
                filename  = _PDF_MAP.get(doc_type, f"{doc_type.lower()}.pdf")
                r = await applicant_c.post(
                    f"/api/applications/{app_id}/documents/upload",
                    data={"doc_type": doc_type},
                    files={"file": (filename, pdf_bytes, "application/pdf")},
                )
                assert r.status_code == 201, f"Upload {doc_type} failed ({r.status_code}): {r.text}"
                source = "real PDF" if (_UTM_ROOT / filename).exists() else "minimal PDF fallback"
                print(f"     OK {doc_type} uploaded ({len(pdf_bytes):,} bytes -- {source})")

            # ==============================================================
            # STEP 9 -- Fetch academic data (creates AcademicRecord in DB)
            # ==============================================================
            print("\n[09] Fetch academic data")
            r = await applicant_c.post(f"/api/applications/{app_id}/fetch-academic-data")
            assert r.status_code == 200, f"Fetch academic data failed: {r.text}"
            data = r.json()
            print(
                f"     OK gpa_4={data.get('gpa_4')}, "
                f"yks_score={data.get('yks_score')}, "
                f"source={data.get('source')}"
            )

            # ==============================================================
            # STEP 10 -- Submit application  DRAFT -> SUBMITTED
            # ==============================================================
            print("\n[10] Submit application")
            r = await applicant_c.post(f"/api/applications/{app_id}/submit")
            assert r.status_code == 200, f"Submit failed: {r.text}"
            assert r.json()["status"] == "SUBMITTED"
            tracking = r.json()["tracking_number"]
            print(f"     OK Submitted (tracking={tracking})")

            # ==============================================================
            # STEP 11 -- SA approves verification  SUBMITTED -> ENGLISH_REVIEW
            # ==============================================================
            print("\n[11] Student Affairs: approve verification")
            r = await admin_c.post(
                f"/api/staff/applications/{app_id}/approve-verification"
            )
            assert r.status_code == 200, f"SA approve-verification failed: {r.text}"
            assert r.json()["status"] == "ENGLISH_REVIEW"
            print(f"     OK Status -> ENGLISH_REVIEW")

            # ==============================================================
            # STEP 12 -- YDYO approves English  ENGLISH_REVIEW -> DEAN_APPROVED
            # ==============================================================
            print("\n[12] YDYO: approve English proficiency")
            r = await admin_c.post(
                f"/api/ydyo/applications/{app_id}/approve-english",
                json={"exam_type": "TOEFL", "exam_score": 85.0, "notes": "Certificate OK"},
            )
            assert r.status_code == 200, f"YDYO approve-english failed: {r.text}"
            print(f"     OK English approved (TOEFL 85)")

            # Confirm status
            r = await applicant_c.get(f"/api/applications/{app_id}/status")
            assert r.json()["status"] == "DEAN_APPROVED", (
                f"Expected DEAN_APPROVED after YDYO approval, got {r.json()['status']}"
            )
            print(f"     OK Status -> DEAN_APPROVED")

            # ==============================================================
            # STEP 13 -- Dean approves final  DEAN_APPROVED -> RANKING
            # ==============================================================
            print("\n[13] Dean: final approval")
            r = await dean_c.post(f"/api/dean/applications/{app_id}/approve")
            assert r.status_code == 200, f"Dean approve failed: {r.text}"
            assert r.json()["status"] == "RANKING"
            print(f"     OK Status -> RANKING")

            # ==============================================================
            # STEP 14 -- YGK corrects academic scores (GPA + YKS)
            #           (needed if PDF extraction returned nulls)
            # ==============================================================
            print("\n[14] YGK: set/correct academic scores")
            r = await tc_c.post(
                f"/api/ygk/applications/{app_id}/correct-score",
                json={
                    "field":            "gpa_4",
                    "corrected_value":  3.50,
                    "correction_note":  "Verified from transcript",
                },
            )
            assert r.status_code == 200, f"Correct gpa_4 failed: {r.text}"
            print(f"     OK gpa_4 = 3.50")

            r = await tc_c.post(
                f"/api/ygk/applications/{app_id}/correct-score",
                json={
                    "field":            "yks_score",
                    "corrected_value":  450.0,
                    "correction_note":  "Verified from YKS report",
                },
            )
            assert r.status_code == 200, f"Correct yks_score failed: {r.text}"
            print(f"     OK yks_score = 450.0")

            # ==============================================================
            # STEP 15 -- YGK verifies & locks scores
            # ==============================================================
            print("\n[15] YGK: verify and lock scores")
            r = await tc_c.post(f"/api/ygk/applications/{app_id}/verify-scores")
            assert r.status_code == 200, f"Verify scores failed: {r.text}"
            assert r.json()["is_locked"] is True
            print(
                f"     OK Scores locked -- "
                f"gpa_4={r.json()['gpa_4']}, "
                f"gpa_100={r.json()['gpa_100']}, "
                f"yks_score={r.json()['yks_score']}"
            )

            # ==============================================================
            # STEP 16 -- YGK generates ranking
            # ==============================================================
            print("\n[16] YGK: generate ranking")
            r = await tc_c.post(
                "/api/ygk/rankings/generate",
                json={"program_id": str(program_id), "period_id": str(period_id)},
            )
            assert r.status_code == 201, f"Generate ranking failed: {r.text}"
            ranking_id = r.json()["id"]
            excluded   = r.json().get("excluded_candidates", [])
            print(
                f"     OK Ranking created (id={ranking_id[:8]}..., "
                f"excluded={len(excluded)})"
            )

            # ==============================================================
            # STEP 17 -- YGK approves ranking
            # ==============================================================
            print("\n[17] YGK: approve ranking")
            r = await tc_c.post(f"/api/ygk/rankings/{ranking_id}/approve")
            assert r.status_code == 200, f"Approve ranking failed: {r.text}"
            assert r.json()["status"] == "APPROVED"
            print(f"     OK Ranking APPROVED")

            # ==============================================================
            # STEP 18 -- SA announces result  RANKING -> ANNOUNCED
            # ==============================================================
            print("\n[18] Student Affairs: announce result")
            r = await admin_c.post(f"/api/staff/applications/{app_id}/announce")
            assert r.status_code == 200, f"Announce failed: {r.text}"
            assert r.json()["status"] == "ANNOUNCED"
            print(f"     OK Status -> ANNOUNCED")

            # ==============================================================
            # STEP 19 -- Applicant checks final status
            # ==============================================================
            print("\n[19] Applicant: check final status")
            r = await applicant_c.get(f"/api/applications/{app_id}/status")
            assert r.status_code == 200, f"Get status failed: {r.text}"
            body = r.json()
            assert body["status"] == "ANNOUNCED"
            assert body["result"] is not None, "Expected a result object"
            assert body["result"]["outcome"] == "ACCEPTED"
            print(f"     OK status=ANNOUNCED, outcome=ACCEPTED")
            print(f"     OK tracking_number={body['tracking_number']}")

            # ==============================================================
            # STEP 20 -- Verify /api/auth/me and logout
            # ==============================================================
            print("\n[20] Applicant: /me and logout")
            r = await applicant_c.get("/api/auth/me")
            assert r.status_code == 200
            me = r.json()
            assert me["email"] == "ahmet@iyte.edu.tr"
            assert me["role"] == "APPLICANT"
            print(f"     OK /me -> {me['first_name']} {me['last_name']} ({me['email']})")

            r = await applicant_c.post("/api/auth/logout")
            assert r.status_code == 204
            print("     OK Logged out")

            # ==============================================================
            # STEP 21 -- Verify token is revoked after logout
            # ==============================================================
            print("\n[21] Confirm token revoked after logout")
            r = await applicant_c.get("/api/auth/me")
            assert r.status_code == 401, (
                f"Expected 401 after logout, got {r.status_code}"
            )
            print(f"     OK /me returns 401 after logout (token revoked)")

        # All assertions passed
        print("\n" + "=" * 65)
        print("  ALL 21 STEPS PASSED OK")
        print("=" * 65)

    finally:
        # Always clean up even on test failure
        fastapi_app.dependency_overrides.clear()
        _redis.clear()
        _minio.clear()
        for p in patches:
            try:
                p.stop()
            except RuntimeError:
                pass  # already stopped
        await engine.dispose()
        await _drop_e2e_db()
        print("\n[CLEANUP] Test database dropped")
