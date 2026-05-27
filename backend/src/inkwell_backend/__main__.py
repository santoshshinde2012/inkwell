"""``python -m inkwell_backend`` entry point.

Runs Uvicorn against the module-level ``app``. Equivalent to
``inkwell-backend`` (the console_scripts entry from pyproject.toml).
Production deployments typically spawn uvicorn directly via the
Dockerfile's CMD; this module is for local dev and ad-hoc runs.
"""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    # Default to loopback; container deployments override via env to
    # bind on 0.0.0.0. Starting on loopback locally avoids accidentally
    # exposing a dev server to other machines on the same Wi-Fi.
    uvicorn.run(
        "inkwell_backend.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        # `--reload` is a dev convenience; never on by default in
        # production. Set INKWELL_RELOAD=1 to enable.
        reload=os.environ.get("INKWELL_RELOAD") == "1",
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
