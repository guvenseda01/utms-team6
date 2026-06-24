import secrets
import string
import uuid

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import revoke_all_user_jtis
from app.core.security import hash_password
from app.domain.audit import AuditLog
from app.domain.eligibility import DepartmentRequirement
from app.domain.enums import UserRole
from app.domain.user import Staff, User
from app.repositories.eligibility_repository import DepartmentRequirementRepository
from app.repositories.program_repository import ProgramRepository
from app.repositories.user_repository import UserRepository
from app.core.config import settings
from app.schemas.admin import ConditionCreateRequest, ConditionUpdateRequest, StaffCreateRequest
from app.services.notification_service import NotificationService

_VALID_RULE_KEYS = {
    "MIN_GPA",
    "MIN_YKS",
    "MIN_CREDITS",
    "CORE_COURSE_GRADE",
    "PORTFOLIO_REQUIRED",
    "REQUIRED_DOC",
}

_VALID_GRADES = {"AA", "BA", "BB", "CB", "CC", "DC", "DD", "FF"}


def _validate_rule_value(rule_key: str, rule_value: str) -> None:
    if rule_key == "MIN_GPA":
        try:
            v = float(rule_value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Format: MIN_GPA must be a number",
            )
        if not (0.0 <= v <= 4.0):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid value: GPA cannot exceed 4.00",
            )
    elif rule_key == "MIN_YKS":
        try:
            float(rule_value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Format: MIN_YKS must be a number",
            )
    elif rule_key == "MIN_CREDITS":
        try:
            v = int(rule_value)
            if v < 0:
                raise ValueError
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Format: MIN_CREDITS must be a non-negative integer",
            )
    elif rule_key == "CORE_COURSE_GRADE":
        if rule_value.upper() not in _VALID_GRADES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid Format: CORE_COURSE_GRADE must be one of {sorted(_VALID_GRADES)}",
            )
    elif rule_key == "PORTFOLIO_REQUIRED":
        if rule_value.lower() not in ("true", "false"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid Format: PORTFOLIO_REQUIRED must be 'true' or 'false'",
            )

_ALLOWED_DOMAINS = ("@iyte.edu.tr", "@std.iyte.edu.tr")


def _generate_temp_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(12))
        if (
            any(c.isupper() for c in pwd)
            and any(c.isdigit() for c in pwd)
            and any(c in "!@#$" for c in pwd)
        ):
            return pwd


class AdminService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._user_repo = UserRepository(db)

    async def list_staff(self) -> list[Staff]:
        return await self._user_repo.get_all_staff()

    async def create_staff(
        self, payload: StaffCreateRequest, created_by: uuid.UUID,
        background_tasks: BackgroundTasks | None = None,
    ) -> tuple[Staff, str]:
        if not any(payload.email.lower().endswith(d) for d in _ALLOWED_DOMAINS):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Email must be an @iyte.edu.tr or @std.iyte.edu.tr address",
            )

        if await self._user_repo.get_by_email(payload.email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User already exists",
            )

        temp_password = _generate_temp_password()

        user = User(
            email=payload.email,
            password_hash=hash_password(temp_password),
            role=payload.role,
            first_name=payload.first_name,
            last_name=payload.last_name,
            is_active=True,
            is_verified=True,
            must_change_password=True,
        )
        self.db.add(user)
        await self.db.flush()

        staff = Staff(
            id=user.id,
            department=payload.department,
            title=payload.title,
        )
        staff.user = user  # pre-populate so no lazy load needed after return
        self.db.add(staff)
        await self.db.flush()

        notif_svc = NotificationService(self.db)
        await notif_svc.enqueue(
            user_id=user.id,
            subject="UTMS — Personel Hesabınız Oluşturuldu",
            template="welcome_staff",
            template_vars={
                "first_name": payload.first_name,
                "email": payload.email,
                "temp_password": temp_password,
                "login_url": f"{settings.FRONTEND_URL}/login",
                "title": "Hoş Geldiniz",
            },
        )

        log = AuditLog(
            actor_id=created_by,
            action="STAFF_CREATED",
            entity_type="User",
            entity_id=user.id,
            new_value={"role": payload.role.value, "email": payload.email},
        )
        self.db.add(log)
        await self.db.flush()

        return staff, temp_password

    async def reset_staff_password(
        self, staff_id: uuid.UUID, reset_by: uuid.UUID
    ) -> tuple[Staff, str]:
        staff = await self._user_repo.get_staff_by_id(staff_id)
        if staff is None or not staff.user.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Staff member not found",
            )

        temp_password = _generate_temp_password()
        staff.user.password_hash = hash_password(temp_password)
        staff.user.must_change_password = True
        await self.db.flush()

        await revoke_all_user_jtis(str(staff_id))

        log = AuditLog(
            actor_id=reset_by,
            action="PASSWORD_RESET",
            entity_type="User",
            entity_id=staff_id,
            new_value={"reset_by": str(reset_by)},
        )
        self.db.add(log)
        await self.db.flush()

        return staff, temp_password

    async def update_role(
        self, staff_id: uuid.UUID, new_role: UserRole, updated_by: uuid.UUID
    ) -> Staff:
        staff = await self._user_repo.get_staff_by_id(staff_id)
        if staff is None or not staff.user.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Staff member not found",
            )

        old_role = staff.user.role
        staff.user.role = new_role
        await self.db.flush()

        await revoke_all_user_jtis(str(staff_id))

        log = AuditLog(
            actor_id=updated_by,
            action="ROLE_UPDATED",
            entity_type="User",
            entity_id=staff_id,
            old_value={"role": old_role.value},
            new_value={"role": new_role.value},
        )
        self.db.add(log)
        await self.db.flush()

        return staff

    async def reactivate_staff(
        self, staff_id: uuid.UUID, reactivated_by: uuid.UUID
    ) -> Staff:
        staff = await self._user_repo.get_staff_by_id(staff_id)
        if staff is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Staff member not found",
            )
        if staff.user.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Staff member is already active",
            )

        staff.user.is_active = True
        await self.db.flush()

        log = AuditLog(
            actor_id=reactivated_by,
            action="STAFF_REACTIVATED",
            entity_type="User",
            entity_id=staff_id,
            new_value={"is_active": True},
        )
        self.db.add(log)
        await self.db.flush()

        return staff

    async def deactivate_staff(
        self, staff_id: uuid.UUID, deactivated_by: uuid.UUID
    ) -> Staff:
        staff = await self._user_repo.get_staff_by_id(staff_id)
        if staff is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Staff member not found",
            )
        if not staff.user.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Staff member is already deactivated",
            )

        staff.user.is_active = False
        await self.db.flush()

        await revoke_all_user_jtis(str(staff_id))

        log = AuditLog(
            actor_id=deactivated_by,
            action="STAFF_DEACTIVATED",
            entity_type="User",
            entity_id=staff_id,
            new_value={"is_active": False},
        )
        self.db.add(log)
        await self.db.flush()

        return staff


class DepartmentConditionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._req_repo = DepartmentRequirementRepository(db)
        self._prog_repo = ProgramRepository(db)

    async def list_conditions(self, program_id: uuid.UUID) -> list[DepartmentRequirement]:
        await self._get_program_or_404(program_id)
        return await self._req_repo.get_by_program(program_id)

    async def add_condition(
        self,
        program_id: uuid.UUID,
        payload: ConditionCreateRequest,
        created_by: uuid.UUID,
    ) -> DepartmentRequirement:
        await self._get_program_or_404(program_id)

        if payload.rule_key not in _VALID_RULE_KEYS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid rule_key. Must be one of: {sorted(_VALID_RULE_KEYS)}",
            )

        _validate_rule_value(payload.rule_key, payload.rule_value)

        existing = await self._req_repo.get_by_program_and_rule_key(program_id, payload.rule_key)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Condition already exists",
            )

        condition = DepartmentRequirement(
            program_id=program_id,
            rule_key=payload.rule_key,
            rule_value=payload.rule_value,
            description=payload.description,
            is_active=True,
        )
        self.db.add(condition)
        await self.db.flush()

        log = AuditLog(
            actor_id=created_by,
            action="CONDITION_ADDED",
            entity_type="DepartmentRequirement",
            entity_id=condition.id,
            new_value={
                "program_id": str(program_id),
                "rule_key": payload.rule_key,
                "rule_value": payload.rule_value,
            },
        )
        self.db.add(log)
        await self.db.flush()

        return condition

    async def update_condition(
        self,
        program_id: uuid.UUID,
        condition_id: uuid.UUID,
        payload: ConditionUpdateRequest,
        updated_by: uuid.UUID,
    ) -> DepartmentRequirement:
        condition = await self._get_condition_or_404(program_id, condition_id)

        if payload.rule_value is not None:
            _validate_rule_value(condition.rule_key, payload.rule_value)
            condition.rule_value = payload.rule_value

        if payload.is_active is not None:
            condition.is_active = payload.is_active

        await self.db.flush()

        log = AuditLog(
            actor_id=updated_by,
            action="CONDITION_UPDATED",
            entity_type="DepartmentRequirement",
            entity_id=condition_id,
            new_value=payload.model_dump(exclude_none=True),
        )
        self.db.add(log)
        await self.db.flush()

        return condition

    async def delete_condition(
        self, program_id: uuid.UUID, condition_id: uuid.UUID, by: uuid.UUID
    ) -> None:
        condition = await self._get_condition_or_404(program_id, condition_id)

        log = AuditLog(
            actor_id=by,
            action="CONDITION_DELETED",
            entity_type="DepartmentRequirement",
            entity_id=condition_id,
            old_value={
                "program_id": str(program_id),
                "rule_key": condition.rule_key,
                "rule_value": condition.rule_value,
            },
        )
        self.db.add(log)
        await self.db.flush()

        await self._req_repo.delete(condition)

    async def _get_program_or_404(self, program_id: uuid.UUID):
        program = await self._prog_repo.get_by_id(program_id)
        if program is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Program not found",
            )
        return program

    async def _get_condition_or_404(
        self, program_id: uuid.UUID, condition_id: uuid.UUID
    ) -> DepartmentRequirement:
        condition = await self._req_repo.get_by_id(condition_id)
        if condition is None or condition.program_id != program_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Condition not found",
            )
        return condition
