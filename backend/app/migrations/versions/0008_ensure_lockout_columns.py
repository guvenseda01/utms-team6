"""Ensure account-lockout columns exist on users.

The lockout feature relies on users.failed_attempts and users.locked_until.
These are declared in the 0001 initial schema, but databases that were created
from an earlier revision of 0001 (before the columns were added) are missing
them.  On such a database every login query (which SELECTs these columns)
raises UndefinedColumnError -> HTTP 500 "unexpected error", and the account
lockout can never engage.

This migration adds the columns IF NOT EXISTS, so it is a harmless no-op on a
correctly-migrated database and a repair on a drifted one.

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-24 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ"
    )


def downgrade() -> None:
    # These columns belong to the 0001 initial schema; this migration only
    # repairs drift, so the downgrade is intentionally a no-op.
    pass
