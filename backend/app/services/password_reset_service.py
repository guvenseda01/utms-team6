import uuid

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import (
    delete_pwd_reset_token,
    get_pwd_reset_token,
    revoke_all_user_jtis,
    store_pwd_reset_token,
)
from app.core.security import hash_password
from app.domain.audit import AuditLog
from app.core.config import settings
from app.repositories.user_repository import UserRepository
from app.services.notification_service import NotificationService


class PasswordResetService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._user_repo = UserRepository(db)

    async def request_reset(self, email: str, background_tasks: BackgroundTasks) -> None:
        """
        Always returns success to prevent user enumeration (UC-01-02).
        Token is only stored and email sent when the account actually exists.
        """
        user = await self._user_repo.get_by_email(email)
        if user is None:
            return  # intentionally silent

        token = str(uuid.uuid4())
        await store_pwd_reset_token(token, str(user.id))
        reset_link = f"{settings.FRONTEND_URL}/reset-password/{token}"
        notif_svc = NotificationService(self.db)
        await notif_svc.enqueue(
            user_id=user.id,
            subject="UTMS — Şifre Sıfırlama Talebi",
            template="password_reset",
            template_vars={
                "reset_link": reset_link,
                "title": "Şifre Sıfırlama",
            },
        )

    async def validate_token(self, token: str) -> str:
        """Return user_id string if the token is valid; raise 410 otherwise."""
        user_id_str = await get_pwd_reset_token(token)
        if not user_id_str:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This link has expired",
            )
        return user_id_str

    async def reset_password(self, token: str, new_password: str) -> None:
        user_id_str = await get_pwd_reset_token(token)
        if not user_id_str:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This link has expired",
            )

        user = await self._user_repo.get_by_id(uuid.UUID(user_id_str))
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This link has expired",
            )

        # Update password
        user.password_hash = hash_password(new_password)
        # Reset link proves mailbox access — treat as email verification too.
        if not user.is_verified:
            user.is_verified = True
        await self.db.flush()

        # Delete used token and invalidate all active sessions
        await delete_pwd_reset_token(token)
        await revoke_all_user_jtis(user_id_str)

        # Audit
        log = AuditLog(
            actor_id=user.id,
            action="PASSWORD_RESET",
            entity_type="User",
            entity_id=user.id,
        )
        self.db.add(log)
        await self.db.flush()
