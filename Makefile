# Repo-root orchestration.
#
# The two halves of the project — Python (backend/) and TypeScript
# (frontend/) — own their own tooling. This top-level Makefile is a
# thin convenience layer so common commands work from the project
# root without remembering where to `cd`.
#
# Each target either delegates to the relevant subtree's Makefile /
# pnpm script, or runs both halves in sequence when the command is
# inherently cross-cutting.

.PHONY: help install dev backend frontend extension build lint typecheck test check clean

help:
	@echo "Inkwell — common commands:"
	@echo ""
	@echo "  make install     install BOTH halves (pip + pnpm)"
	@echo "  make dev         run backend + extension watcher in parallel"
	@echo "  make backend     run only the backend (uvicorn --reload on :8000)"
	@echo "  make frontend    run only the extension watcher"
	@echo ""
	@echo "  make build       build the extension (production)"
	@echo "  make lint        ruff + eslint"
	@echo "  make typecheck   mypy + tsc"
	@echo "  make test        pytest"
	@echo "  make check       lint + typecheck + test (everything CI runs)"
	@echo "  make clean       remove caches + .venv + node_modules"
	@echo ""
	@echo "  cd backend && make help        for backend-only targets"
	@echo "  cd frontend && pnpm run         for frontend-only scripts"

install:
	$(MAKE) -C backend install
	cd frontend && pnpm install

# Parallel dev — backend in the background, frontend in the foreground.
# The trap kills the background backend when the foreground exits.
dev:
	@echo "Starting backend (8000) + extension watcher…"
	@trap 'kill 0' EXIT INT TERM; \
	  $(MAKE) -s -C backend dev & \
	  cd frontend && pnpm dev:extension

backend:
	$(MAKE) -C backend dev

frontend:
	cd frontend && pnpm dev:extension

# Alias — the frontend currently only builds one thing (the extension).
extension:
	cd frontend && pnpm dev:extension

build:
	cd frontend && pnpm build

lint:
	$(MAKE) -C backend lint
	cd frontend && pnpm lint

typecheck:
	$(MAKE) -C backend typecheck
	cd frontend && pnpm typecheck

test:
	$(MAKE) -C backend test

check: lint typecheck test
	cd frontend && pnpm --filter @inkwell/extension build

clean:
	$(MAKE) -C backend clean
	cd frontend && pnpm clean
	rm -rf frontend/node_modules backend/.venv
