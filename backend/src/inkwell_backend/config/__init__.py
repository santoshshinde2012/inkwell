"""Configuration data files packaged with the backend.

Anything in this directory is treated as **data**, not Python code: the
backend reads it at startup. Today it holds ``models.catalog.json`` —
the single source of truth for the product's model catalog. The JSON
file is also copied into the frontend's bundled fallback at build
time (see ``frontend/packages/shared/scripts/sync-config.mjs``).
"""
