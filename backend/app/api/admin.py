import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.domain.eligibility import DepartmentRequirement
from app.domain.enums import UserRole
from app.domain.period import ApplicationPeriod
from app.domain.user import Staff, User
from app.schemas.admin import (
    ConditionCreateRequest,
    ConditionResponse,
    ConditionUpdateRequest,
    PeriodCreateRequest,
    PeriodExtendRequest,
    PeriodUpdateRequest,
    PeriodResponse,
    RoleUpdateRequest,
    StaffCreateRequest,
    StaffCreateResponse,
    StaffResponse,
)
from app.services.admin_service import AdminService, DepartmentConditionService
from app.services.period_service import PeriodService

router = APIRouter()

_require_admin = require_role(UserRole.SYSTEM_ADMIN)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _staff_to_response(staff: Staff) -> StaffResponse:
    u: User = staff.user
    return StaffResponse(
        id=u.id,
        email=u.email,
        first_name=u.first_name,
        last_name=u.last_name,
        role=u.role,
        department=staff.department,
        title=staff.title,
        is_active=u.is_active,
        created_at=u.created_at,
    )


def _period_to_response(period: ApplicationPeriod) -> PeriodResponse:
    return PeriodResponse(
        id=period.id,
        label=period.label,
        opens_at=period.opens_at,
        closes_at=period.closes_at,
        is_active=period.is_active,
        created_by=period.created_by,
        created_at=period.created_at,
    )


def _condition_to_response(condition: DepartmentRequirement) -> ConditionResponse:
    return ConditionResponse(
        id=condition.id,
        program_id=condition.program_id,
        rule_key=condition.rule_key,
        rule_value=condition.rule_value,
        description=condition.description,
        is_active=condition.is_active,
    )


# ---------------------------------------------------------------------------
# SPEC-017: Staff management
# ---------------------------------------------------------------------------

@router.get("/staff", response_model=list[StaffResponse])
async def list_staff(
    _: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[StaffResponse]:
    svc = AdminService(db)
    staff_list = await svc.list_staff()
    return [_staff_to_response(s) for s in staff_list]


@router.post("/staff", response_model=StaffCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_staff(
    payload: StaffCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> StaffCreateResponse:
    svc = AdminService(db)
    staff, temp_password = await svc.create_staff(payload, current_user.id, background_tasks)
    response = _staff_to_response(staff)
    return StaffCreateResponse(**response.model_dump(), temp_password=temp_password)


@router.patch("/staff/{staff_id}/role", response_model=StaffResponse)
async def update_staff_role(
    staff_id: uuid.UUID,
    payload: RoleUpdateRequest,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> StaffResponse:
    svc = AdminService(db)
    staff = await svc.update_role(staff_id, payload.role, current_user.id)
    return _staff_to_response(staff)


@router.post("/staff/{staff_id}/activate", response_model=StaffResponse)
async def reactivate_staff(
    staff_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> StaffResponse:
    svc = AdminService(db)
    staff = await svc.reactivate_staff(staff_id, current_user.id)
    return _staff_to_response(staff)


@router.post("/staff/{staff_id}/reset-password")
async def reset_staff_password(
    staff_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    svc = AdminService(db)
    staff, temp_password = await svc.reset_staff_password(staff_id, current_user.id)
    response = _staff_to_response(staff)
    return StaffCreateResponse(**response.model_dump(), temp_password=temp_password)


@router.delete("/staff/{staff_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_staff(
    staff_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = AdminService(db)
    await svc.deactivate_staff(staff_id, current_user.id)


# ---------------------------------------------------------------------------
# SPEC-018: Application period management
# ---------------------------------------------------------------------------

@router.get("/periods", response_model=list[PeriodResponse])
async def list_periods(
    _: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[PeriodResponse]:
    svc = PeriodService(db)
    periods = await svc.list_periods()
    return [_period_to_response(p) for p in periods]


@router.post("/periods", response_model=PeriodResponse, status_code=status.HTTP_201_CREATED)
async def create_period(
    payload: PeriodCreateRequest,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> PeriodResponse:
    svc = PeriodService(db)
    period = await svc.create_period(
        label=payload.label,
        opens_at=payload.opens_at,
        closes_at=payload.closes_at,
        created_by=current_user.id,
    )
    return _period_to_response(period)


@router.patch("/periods/{period_id}", response_model=PeriodResponse)
async def update_period(
    period_id: uuid.UUID,
    payload: PeriodUpdateRequest,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> PeriodResponse:
    svc = PeriodService(db)
    period = await svc.update_period(
        period_id,
        label=payload.label,
        opens_at=payload.opens_at,
        closes_at=payload.closes_at,
        by=current_user.id,
    )
    return _period_to_response(period)


@router.patch("/periods/{period_id}/extend", response_model=PeriodResponse)
async def extend_period(
    period_id: uuid.UUID,
    payload: PeriodExtendRequest,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> PeriodResponse:
    svc = PeriodService(db)
    period = await svc.extend_deadline(period_id, payload.new_closes_at, current_user.id)
    return _period_to_response(period)


@router.patch("/periods/{period_id}/emergency-close", response_model=PeriodResponse)
async def emergency_close_period(
    period_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> PeriodResponse:
    svc = PeriodService(db)
    period = await svc.emergency_close(period_id, current_user.id)
    return _period_to_response(period)


@router.patch("/periods/{period_id}/activate", response_model=PeriodResponse)
async def activate_period(
    period_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> PeriodResponse:
    svc = PeriodService(db)
    period = await svc.activate_period(period_id, current_user.id)
    return _period_to_response(period)


@router.patch("/periods/{period_id}/deactivate", response_model=PeriodResponse)
async def deactivate_period(
    period_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> PeriodResponse:
    svc = PeriodService(db)
    period = await svc.deactivate_period(period_id, current_user.id)
    return _period_to_response(period)


# ---------------------------------------------------------------------------
# SPEC-019: Department condition management
# ---------------------------------------------------------------------------

@router.get("/programs/{program_id}/conditions", response_model=list[ConditionResponse])
async def list_conditions(
    program_id: uuid.UUID,
    _: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[ConditionResponse]:
    svc = DepartmentConditionService(db)
    conditions = await svc.list_conditions(program_id)
    return [_condition_to_response(c) for c in conditions]


@router.post(
    "/programs/{program_id}/conditions",
    response_model=ConditionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_condition(
    program_id: uuid.UUID,
    payload: ConditionCreateRequest,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> ConditionResponse:
    svc = DepartmentConditionService(db)
    condition = await svc.add_condition(program_id, payload, current_user.id)
    return _condition_to_response(condition)


@router.patch(
    "/programs/{program_id}/conditions/{condition_id}",
    response_model=ConditionResponse,
)
async def update_condition(
    program_id: uuid.UUID,
    condition_id: uuid.UUID,
    payload: ConditionUpdateRequest,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> ConditionResponse:
    svc = DepartmentConditionService(db)
    condition = await svc.update_condition(program_id, condition_id, payload, current_user.id)
    return _condition_to_response(condition)


@router.delete(
    "/programs/{program_id}/conditions/{condition_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_condition(
    program_id: uuid.UUID,
    condition_id: uuid.UUID,
    current_user: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = DepartmentConditionService(db)
    await svc.delete_condition(program_id, condition_id, current_user.id)
