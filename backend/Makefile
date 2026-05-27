# Convenience targets for local development. `.PHONY` everywhere because
# none of these correspond to filesystem outputs.
.PHONY: install dev run lint format typecheck test check clean docker

# Default: install into a local venv and run the dev server.
help:
	@echo "Inkwell Python backend — common commands:"
	@echo ""
	@echo "  make install     create .venv and install with dev extras"
	@echo "  make dev         run uvicorn with --reload on :8000"
	@echo "  make run         run uvicorn (production-style, no reload)"
	@echo "  make lint        ruff check"
	@echo "  make format      ruff format"
	@echo "  make typecheck   mypy strict over src/"
	@echo "  make test        pytest"
	@echo "  make check       lint + typecheck + test"
	@echo "  make docker      build production image"
	@echo "  make clean       remove caches + .venv"

# Idempotent: re-running just upgrades dev deps in place.
install:
	python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip
	.venv/bin/pip install -e ".[dev]"

dev:
	.venv/bin/uvicorn inkwell_backend.main:app --reload --host 0.0.0.0 --port 8000

# `--proxy-headers` so X-Forwarded-For from a reverse proxy reaches the
# rate-limiter as the real client IP.
run:
	.venv/bin/uvicorn inkwell_backend.main:app --host 0.0.0.0 --port 8000 --proxy-headers

lint:
	.venv/bin/ruff check src tests

format:
	.venv/bin/ruff format src tests
	.venv/bin/ruff check --fix src tests

typecheck:
	.venv/bin/mypy src

test:
	.venv/bin/pytest

check: lint typecheck test

docker:
	docker build -t inkwell-backend:latest .

clean:
	rm -rf .venv .mypy_cache .ruff_cache .pytest_cache build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} +
