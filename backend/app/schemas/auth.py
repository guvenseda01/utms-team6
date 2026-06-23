import re
from datetime import date

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

_PASSWORD_RE = re.compile(r'^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:\'",.<>?/\\|`~]).{8,}$')

_PASSWORD_RULES = (
    "Password must be at least 8 characters and contain an uppercase letter, "
    "a digit, and a special character."
)


def _validate_password_strength(value: str) -> str:
    if not _PASSWORD_RE.match(value):
        raise ValueError(_PASSWORD_RULES)
    return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    """Returned in the response body alongside the HttpOnly cookies."""

    token_type: str = "bearer"
    role: str
    must_change_password: bool = False


class MeResponse(BaseModel):
    """Current session identity — role comes from the DB, not sessionStorage."""

    id: str
    email: str
    role: str
    first_name: str
    last_name: str
    must_change_password: bool


class ChangePasswordRequest(BaseModel):
    new_password: str
    new_password_confirm: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)

    @model_validator(mode="after")
    def passwords_match(self) -> "ChangePasswordRequest":
        if self.new_password != self.new_password_confirm:
            raise ValueError("Passwords do not match.")
        return self


class RegistrationRequest(BaseModel):
    national_id: str = Field(min_length=11, max_length=11)
    date_of_birth: date
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    university_email: EmailStr
    password: str
    password_confirm: str

    @field_validator("national_id")
    @classmethod
    def validate_national_id(cls, v: str) -> str:
        if not v or len(v) != 11:
            raise ValueError("TC Kimlik No must be exactly 11 digits.")
        if not v.isdigit():
            raise ValueError("TC Kimlik No must contain only digits.")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)

    @model_validator(mode="after")
    def passwords_match(self) -> "RegistrationRequest":
        if self.password != self.password_confirm:
            raise ValueError("Passwords do not match.")
        return self


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    new_password: str
    new_password_confirm: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)

    @model_validator(mode="after")
    def passwords_match(self) -> "ResetPasswordRequest":
        if self.new_password != self.new_password_confirm:
            raise ValueError("Passwords do not match.")
        return self
