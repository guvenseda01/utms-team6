import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import ForeignKey, String, text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .enums import AppStatus, app_status_type

if TYPE_CHECKING:
    from .academic_record import AcademicRecord
    from .document import Document
    from .eligibility import DepartmentEvaluation, EligibilityCheck
    from .english import EnglishProficiencyReview
    from .intibak import IntibakTable
    from .notification import Notification
    from .period import ApplicationPeriod
    from .program import Program
    from .qa import Question
    from .ranking import RankingEntry
    from .user import Applicant

# Ordered list of main lifecycle statuses (used by get_progress)
_STATUS_ORDER = [
    AppStatus.DRAFT,
    AppStatus.SUBMITTED,
    AppStatus.UNDER_REVIEW,
    AppStatus.ENGLISH_REVIEW,
    AppStatus.DEAN_APPROVED,
    AppStatus.DEPT_EVAL,
    AppStatus.RANKING,
    AppStatus.ANNOUNCED,
]


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    applicant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applicants.id"), nullable=False
    )
    program_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("programs.id"), nullable=False
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("application_periods.id"), nullable=False
    )
    status: Mapped[AppStatus] = mapped_column(
        app_status_type,
        nullable=False,
        default=AppStatus.DRAFT,
        server_default=text("'DRAFT'"),
    )
    tracking_number: Mapped[Optional[str]] = mapped_column(
        String(30), unique=True, nullable=True
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("NOW()")
    )

    # Relationships
    applicant: Mapped["Applicant"] = relationship(
        "Applicant", back_populates="applications"
    )
    program: Mapped["Program"] = relationship("Program", back_populates="applications")
    period: Mapped["ApplicationPeriod"] = relationship(
        "ApplicationPeriod", back_populates="applications"
    )
    academic_record: Mapped[Optional["AcademicRecord"]] = relationship(
        "AcademicRecord", back_populates="application", uselist=False
    )
    documents: Mapped[List["Document"]] = relationship(
        "Document", back_populates="application"
    )
    eligibility_checks: Mapped[List["EligibilityCheck"]] = relationship(
        "EligibilityCheck", back_populates="application"
    )
    department_evaluations: Mapped[List["DepartmentEvaluation"]] = relationship(
        "DepartmentEvaluation", back_populates="application"
    )
    english_proficiency_review: Mapped[Optional["EnglishProficiencyReview"]] = relationship(
        "EnglishProficiencyReview", back_populates="application", uselist=False
    )
    ranking_entry: Mapped[Optional["RankingEntry"]] = relationship(
        "RankingEntry", back_populates="application", uselist=False
    )
    intibak_table: Mapped[Optional["IntibakTable"]] = relationship(
        "IntibakTable", back_populates="application", uselist=False
    )
    notifications: Mapped[List["Notification"]] = relationship(
        "Notification",
        back_populates="application",
        foreign_keys="Notification.application_id",
    )
    questions: Mapped[List["Question"]] = relationship(
        "Question", back_populates="application"
    )

    def get_progress(self) -> dict:
        """Return a structured progress summary for this application."""
        if self.status == AppStatus.CORRECTION_REQUESTED:
            current_index = _STATUS_ORDER.index(AppStatus.UNDER_REVIEW)
        elif self.status in _STATUS_ORDER:
            current_index = _STATUS_ORDER.index(self.status)
        else:
            current_index = 0  # DRAFT fallback

        total_steps = len(_STATUS_ORDER) - 1  # exclude DRAFT from percentage

        steps = [
            {
                "step": s.value,
                "completed": i < current_index,
                "active": i == current_index,
                "pending": i > current_index,
            }
            for i, s in enumerate(_STATUS_ORDER)
        ]

        percentage = int((current_index / total_steps) * 100) if current_index > 0 else 0

        return {
            "tracking_number": self.tracking_number,
            "current_status": self.status.value,
            "steps": steps,
            "percentage": percentage,
            "is_terminal": self.status in (AppStatus.ANNOUNCED, AppStatus.REJECTED),
        }
