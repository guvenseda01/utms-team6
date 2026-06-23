import uuid

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import (
    delete_email_verify_token,
    get_email_verify_token,
    store_email_verify_token,
)
from app.core.security import hash_password
from app.domain.audit import AuditLog
from app.domain.enums import UserRole
from app.domain.user import Applicant, User
from app.repositories.user_repository import UserRepository
from app.core.config import settings
from app.schemas.auth import RegistrationRequest
from app.services.notification_service import NotificationService


class RegistrationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._user_repo = UserRepository(db)

    async def register(self, payload: RegistrationRequest, background_tasks: BackgroundTasks) -> User:
        # 1. Check email uniqueness
        if await self._user_repo.get_by_email(payload.university_email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account already exists",
            )

        # 2. Check national_id uniqueness
        if await self._user_repo.get_by_national_id(payload.national_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account already exists",
            )

        # 3. Hash password
        password_hash = hash_password(payload.password)

        # 4. Create User row
        user = User(
            email=payload.university_email,
            password_hash=password_hash,
            role=UserRole.APPLICANT,
            first_name=payload.first_name,
            last_name=payload.last_name,
            is_verified=False,
        )
        self.db.add(user)
        await self.db.flush()  # get user.id

        # 5. Create Applicant profile row
        applicant = Applicant(
            id=user.id,
            national_id=payload.national_id,
            date_of_birth=payload.date_of_birth,
        )
        self.db.add(applicant)
        await self.db.flush()

        # 6. Generate email verification token (UUID, 24h TTL)
        token = str(uuid.uuid4())
        await store_email_verify_token(token, str(user.id))

        # 7. Enqueue verification email via notification worker (SPEC-020)
        verify_link = f"{settings.FRONTEND_URL}/verify-email/{token}"
        notif_svc = NotificationService(self.db)
        await notif_svc.enqueue(
            user_id=user.id,
            subject="UTMS — E-posta Adresinizi Doğrulayın",
            template="email_verification",
            template_vars={
                "verify_link": verify_link,
                "title": "E-posta Doğrulama",
            },
        )

        # 8. Write audit log
        log = AuditLog(
            actor_id=user.id,
            action="REGISTER",
            entity_type="User",
            entity_id=user.id,
        )
        self.db.add(log)
        await self.db.flush()

        return user

    async def verify_email(self, token: str) -> None:
        # Lookup token in Redis
        user_id_str = await get_email_verify_token(token)
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

        # Mark verified
        user.is_verified = True
        await self.db.flush()

        # Delete token
        await delete_email_verify_token(token)

        # Audit
        log = AuditLog(
            actor_id=user.id,
            action="EMAIL_VERIFIED",
            entity_type="User",
            entity_id=user.id,
        )
        self.db.add(log)
        await self.db.flush()

    async def resend_verification(self, email: str) -> None:
        """Re-send verification email. Silent when account missing or already verified."""
        user = await self._user_repo.get_by_email(email)
        if user is None or user.is_verified:
            return

        token = str(uuid.uuid4())
        await store_email_verify_token(token, str(user.id))

        verify_link = f"{settings.FRONTEND_URL}/verify-email/{token}"
        notif_svc = NotificationService(self.db)
        await notif_svc.enqueue(
            user_id=user.id,
            subject="UTMS — E-posta Adresinizi Doğrulayın",
            template="email_verification",
            template_vars={
                "verify_link": verify_link,
                "title": "E-posta Doğrulama",
            },
        )
