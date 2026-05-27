# Multi-stage build: a slim runtime image that doesn't carry build tools.
# The wheel built in the first stage is the only artefact that crosses
# into the second stage.

# ---------- builder ----------
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# Install just the metadata first so subsequent code changes don't bust
# the dependency-install cache layer.
COPY pyproject.toml README.md ./
COPY src ./src

# Build a wheel of the app, then resolve a flat requirements list from
# pyproject so the runtime stage gets exactly what's needed.
RUN pip install --upgrade pip build hatchling \
 && python -m build --wheel --outdir /build/dist

# ---------- runtime ----------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Non-root user for the application. Containers running as root are a
# well-known footgun even with no host bind mounts.
RUN groupadd --system app && useradd --system --gid app --home /app app

WORKDIR /app

COPY --from=builder /build/dist/*.whl /tmp/

RUN pip install /tmp/*.whl \
 && rm -f /tmp/*.whl

USER app

EXPOSE 8000

# `inkwell-backend` is the console_scripts entry from pyproject.toml.
# Falls back to `python -m inkwell_backend` if you build with `pip
# install --no-deps`.
CMD ["uvicorn", "inkwell_backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

# Container-native health probe — same endpoint a Kubernetes liveness
# probe would call. Keep the timeout tight; if /health takes more than a
# couple of seconds something is wrong.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=2).status==200 else 1)"
