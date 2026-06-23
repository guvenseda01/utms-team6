"""
Unit tests for AuthService.
All DB and Redis calls are mocked — no PostgreSQL or Redis instance required.

Covers test scenarios T1–T9 from SPEC-002.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.services.auth_service import AuthService, _MAX_FAILED_ATTEMPTS, _LOCKOUT_MINUTES
from tests.conftest import make_user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db():
    session = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()
    return session


@pytest.fixture
def service(db):
    return AuthService(db=db)


def _setup_db_user(db, user):
    """Make db.execute().scalar_one_or_none() return the given user."""
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = user
    db.execute = AsyncMock(return_value=mock_result)
    db.get = AsyncMock(return_value=user)


# ---------------------------------------------------------------------------
# T1 — Successful login (applicant)
# ---------------------------------------------------------------------------

async def test_login_success_returns_token_pair(service, db, patch_redis):
    plain = "SecurePass1!"
    user = make_user(role=UserRole.APPLICANT, password_hash=hash_password(plain))
    _setup_db_user(db, user)

    pair = await service.login(user.email, plain, "127.0.0.1")

    assert pair.access_token
    assert pair.refresh_token
    assert pair.role == UserRole.APPLICANT.value
    # JTIs must be stored in Redis
    assert pair.access_jti in patch_redis
    assert pair.refresh_jti in patch_redis


async def test_login_success_clears_failed_attempts(service, db, patch_redis):
    plain = "SecurePass1!"
    user = make_user(
        role=UserRole.APPLICANT,
        password_hash=hash_password(plain),
        failed_attempts=3,
    )
    _setup_db_user(db, user)

    await service.login(user.email, plain, "127.0.0.1")

    assert user.failed_attempts == 0
    assert user.locked_until is None


# ---------------------------------------------------------------------------
# T2 — Wrong password returns 401 with generic message
# ---------------------------------------------------------------------------

async def test_login_wrong_password_returns_401(service, db, patch_redis):
    user = make_user(password_hash=hash_password("correct"))
    _setup_db_user(db, user)

    with pytest.raises(HTTPException) as exc_info:
        await service.login(user.email, "wrong_password", "127.0.0.1")

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid credentials"


async def test_login_wrong_password_increments_failed_attempts(service, db, patch_redis):
    user = make_user(password_hash=hash_password("correct"), failed_attempts=0)
    _setup_db_user(db, user)

    with pytest.raises(HTTPException):
        await service.login(user.email, "wrong", "127.0.0.1")

    assert user.failed_attempts == 1


async def test_login_wrong_password_commits_failed_attempt(service, db, patch_redis):
    """
    Regression: the failed-attempt counter must be COMMITTED before the 401 is
    raised. get_db() rolls back the session on any exception, so a bare flush()
    would be discarded and the account could never reach the lockout threshold.
    """
    user = make_user(password_hash=hash_password("correct"), failed_attempts=0)
    _setup_db_user(db, user)

    with pytest.raises(HTTPException):
        await service.login(user.email, "wrong", "127.0.0.1")

    db.commit.assert_awaited()


# ---------------------------------------------------------------------------
# T3 — Unknown email returns same generic 401
# ---------------------------------------------------------------------------

async def test_login_unknown_email_returns_401(service, db, patch_redis):
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=mock_result)

    with pytest.raises(HTTPException) as exc_info:
        await service.login("nobody@example.com", "password", "127.0.0.1")

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid credentials"


# ---------------------------------------------------------------------------
# T4 — 5 consecutive failures → 6th attempt returns 423
# ---------------------------------------------------------------------------

async def test_fifth_failure_sets_lockout(service, db, patch_redis):
    user = make_user(
        password_hash=hash_password("correct"),
        failed_attempts=_MAX_FAILED_ATTEMPTS - 1,
    )
    _setup_db_user(db, user)

    with pytest.raises(HTTPException):
        await service.login(user.email, "wrong", "127.0.0.1")

    assert user.failed_attempts == _MAX_FAILED_ATTEMPTS
    assert user.locked_until is not None
    assert user.locked_until > datetime.now(timezone.utc)


async def test_locked_account_returns_423(service, db, patch_redis):
    locked_until = datetime.now(timezone.utc) + timedelta(minutes=_LOCKOUT_MINUTES)
    user = make_user(
        password_hash=hash_password("correct"),
        failed_attempts=_MAX_FAILED_ATTEMPTS,
        locked_until=locked_until,
    )
    _setup_db_user(db, user)

    with pytest.raises(HTTPException) as exc_info:
        await service.login(user.email, "correct", "127.0.0.1")

    assert exc_info.value.status_code == 423
    assert "Retry-After" in exc_info.value.headers


# ---------------------------------------------------------------------------
# T5 — Login after lockout window expires → 200
# ---------------------------------------------------------------------------

async def test_login_after_lockout_expires_succeeds(service, db, patch_redis):
    plain = "SecurePass1!"
    # locked_until is in the past
    expired_lock = datetime.now(timezone.utc) - timedelta(seconds=1)
    user = make_user(
        password_hash=hash_password(plain),
        failed_attempts=_MAX_FAILED_ATTEMPTS,
        locked_until=expired_lock,
    )
    _setup_db_user(db, user)

    pair = await service.login(user.email, plain, "127.0.0.1")

    assert pair.access_token
    assert user.failed_attempts == 0
    assert user.locked_until is None


# ---------------------------------------------------------------------------
# T6 — Logout revokes JTI
# ---------------------------------------------------------------------------

async def test_logout_revokes_jti(service, db, patch_redis):
    user = make_user()
    db.get = AsyncMock(return_value=user)
    jti = str(uuid.uuid4())
    patch_redis[jti] = True  # pre-populate

    await service.logout(user.id, jti, "127.0.0.1")

    assert jti not in patch_redis


# ---------------------------------------------------------------------------
# T8 — Refresh token returns new access token
# ---------------------------------------------------------------------------

async def test_refresh_token_rotates_pair(service, db, patch_redis):
    plain = "SecurePass1!"
    user = make_user(password_hash=hash_password(plain))
    _setup_db_user(db, user)
    db.get = AsyncMock(return_value=user)

    # First login to get a valid refresh token
    pair = await service.login(user.email, plain, "127.0.0.1")

    new_pair = await service.refresh_token(pair.refresh_token)

    assert new_pair.access_token != pair.access_token
    assert new_pair.refresh_token != pair.refresh_token
    # Old refresh JTI must be revoked
    assert pair.refresh_jti not in patch_redis
    # New JTIs must be in Redis
    assert new_pair.access_jti in patch_redis
    assert new_pair.refresh_jti in patch_redis


async def test_refresh_with_revoked_token_raises_401(service, db, patch_redis):
    plain = "SecurePass1!"
    user = make_user(password_hash=hash_password(plain))
    _setup_db_user(db, user)

    pair = await service.login(user.email, plain, "127.0.0.1")
    # Manually revoke the refresh JTI
    patch_redis.pop(pair.refresh_jti, None)

    with pytest.raises(HTTPException) as exc_info:
        await service.refresh_token(pair.refresh_token)

    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# T9 — Staff login embeds correct role in token
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("role", [
    UserRole.STUDENT_AFFAIRS,
    UserRole.TRANSFER_COMMISSION,
    UserRole.YDYO,
    UserRole.DEAN_OFFICE,
    UserRole.SYSTEM_ADMIN,
])
async def test_staff_login_embeds_role(role, service, db, patch_redis):
    plain = "StaffPass1!"
    user = make_user(role=role, password_hash=hash_password(plain))
    _setup_db_user(db, user)

    pair = await service.login(user.email, plain, "127.0.0.1")

    from app.core.security import decode_token
    payload = decode_token(pair.access_token)
    assert payload["role"] == role.value
