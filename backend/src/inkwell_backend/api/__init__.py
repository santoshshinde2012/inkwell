"""HTTP layer.

Everything in this package is FastAPI-aware: routes, middleware,
dependency wiring, response helpers. The service modules in
:mod:`inkwell_backend.services` have no HTTP coupling and are imported
here without inheriting any.
"""
