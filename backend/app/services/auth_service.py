import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import is_jti_valid, revoke_jti, store_jti
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.core.config import settings
from app.domain.audit import AuditLog
from app.domain.user import User
from app.repositories.user_repository import UserRepository

_GENERIC_AUTH_ERROR = "Invalid credentials"
_LOCKOUT_MINUTES = 15
_MAX_FAILED_ATTEMPTS = 5


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    access_jti: str
    refresh_jti: str
    role: str
    must_change_password: bool = False


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._user_repo = UserRepository(db)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def login(self, email: str, password: str, ip: Optional[str]) -> TokenPair:
        """
        Authenticate a user.  Never reveals whether the email or the password
        was wrong — always returns the same generic 401 message.
        """
        user = await self._user_repo.get_by_email(email)

        # Unknown email — do a dummy hash to prevent timing attacks, then 401
        if user is None:
            verify_password("dummy", "$2b$12$SHG7.6D7iPX1.1fUgnyktOOpgT7w7R/4AQjsRqRRpm4OfmWIIAPyy")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=_GENERIC_AUTH_ERROR,
            )

        # Check lockout BEFORE verifying password
        await self._check_lockout(user)

        if not verify_password(password, user.password_hash):
            await self._record_failed_attempt(user)
            await self._write_audit(user.id, "LOGIN_FAILURE", ip, user.role.value)
            # Commit the failed-attempt counter / lockout (and audit row) BEFORE
            # raising: get_db() rolls back the session on any exception, so
            # without this commit the increment is discarded and the account
            # can never reach the lockout threshold.
            await self.db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=_GENERIC_AUTH_ERROR,
            )

        if not user.is_active:
            await self._write_audit(user.id, "LOGIN_BLOCKED_INACTIVE", ip, user.role.value)
            await self.db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=_GENERIC_AUTH_ERROR,
            )

        # Block unverified accounts: registration sets is_verified=False;
        # only the email-link flow flips it to True.
        if not user.is_verified:
            await self._write_audit(user.id, "LOGIN_BLOCKED_UNVERIFIED", ip, user.role.value)
            await self.db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email address before logging in.",
            )

        # Successful login
        await self._clear_failed_attempts(user)

        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())

        access_token = create_access_token(user.id, user.role, access_jti)
        refresh_token = create_refresh_token(user.id, refresh_jti)

        uid_str = str(user.id)
        await store_jti(access_jti, settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60, uid_str)
        await store_jti(refresh_jti, settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400, uid_str)

        await self._write_audit(user.id, "LOGIN_SUCCESS", ip, user.role.value)

        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            access_jti=access_jti,
            refresh_jti=refresh_jti,
            role=user.role.value,
            must_change_password=user.must_change_password,
        )

    async def change_password(self, user: User, new_password: str) -> None:
        """Update password and clear the must_change_password flag."""
        from app.core.security import hash_password
        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        await self.db.flush()

    async def logout(self, user_id: uuid.UUID, access_jti: str, ip: Optional[str]) -> None:
        """Revoke the access-token JTI and write an audit entry."""
        await revoke_jti(access_jti)
        await self._write_audit(user_id, "LOGOUT", ip, None)

    async def refresh_token(self, raw_refresh_token: str) -> TokenPair:
        """
        Rotate the refresh token: revoke the old one, issue a fresh pair.
        """
        payload = decode_token(raw_refresh_token)

        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        old_jti = payload.get("jti")
        if not old_jti or not await is_jti_valid(old_jti):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token has been revoked",
            )

        user_id = uuid.UUID(payload["sub"])
        user = await self._user_repo.get_by_id(user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )

        # Rotate: revoke old refresh JTI, issue new pair
        await revoke_jti(old_jti)

        new_access_jti = str(uuid.uuid4())
        new_refresh_jti = str(uuid.uuid4())

        access_token = create_access_token(user.id, user.role, new_access_jti)
        new_refresh = create_refresh_token(user.id, new_refresh_jti)

        uid_str = str(user.id)
        await store_jti(new_access_jti, settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60, uid_str)
        await store_jti(new_refresh_jti, settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400, uid_str)

        return TokenPair(
            access_token=access_token,
            refresh_token=new_refresh,
            access_jti=new_access_jti,
            refresh_jti=new_refresh_jti,
            role=user.role.value,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _check_lockout(self, user: User) -> None:
        if user.locked_until is None:
            return
        now = datetime.now(timezone.utc)
        if now < user.locked_until:
            seconds_remaining = int((user.locked_until - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="Account locked due to too many failed login attempts",
                headers={"Retry-After": str(seconds_remaining)},
            )
        # Lockout window has passed — will be cleared on next successful login

    async def _record_failed_attempt(self, user: User) -> None:
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= _MAX_FAILED_ATTEMPTS:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=_LOCKOUT_MINUTES)
        await self.db.flush()

    async def _clear_failed_attempts(self, user: User) -> None:
        user.failed_attempts = 0
        user.locked_until = None
        await self.db.flush()

    async def _write_audit(
        self,
        actor_id: uuid.UUID,
        action: str,
        ip: Optional[str],
        role: Optional[str],
    ) -> None:
        new_value: dict = {}
        if ip:
            new_value["ip"] = ip
        if role:
            new_value["role"] = role

        log = AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type="User",
            entity_id=actor_id,
            new_value=new_value or None,
            ip_address=ip,
        )
        self.db.add(log)
        await self.db.flush()
