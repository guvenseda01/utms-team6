# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — dependency builder
#   Installs all wheels (with build tools available for packages that
#   compile C/Rust extensions).  Only /install is copied to the runtime stage.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.13-slim AS builder

WORKDIR /build

# Build-time system libraries required for C/Rust extension packages:
#   libffi-dev   → cffi, argon2-cffi-bindings
#   libssl-dev   → cryptography (fallback if no manylinux wheel)
#   build-essential → gcc/make for any source builds
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install from the complete lock file so every transitive dependency is
# pinned — fully reproducible on any machine.
COPY requirements-lock.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements-lock.txt


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime image
#   Minimal image: no build tools, no cache, non-root user.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.13-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

# Copy pre-built packages from the builder stage
COPY --from=builder /install /usr/local

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup --system appgroup \
    && adduser --system --ingroup appgroup --no-create-home appuser \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

# Apply pending DB migrations, then start the server. This runs on platforms
# that launch the image's CMD directly (e.g. Railway). `alembic upgrade head`
# is idempotent — a no-op when the DB is already up to date. docker-compose
# overrides `command` per service, so this does not run for the Celery worker
# there. Only DATABASE_URL is required (see app/migrations/env.py).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
