"""Read-only assessment components mounted under ``honua-migrate assess``."""

from __future__ import annotations

from honua_migrate import __version__

__all__ = ["SCHEMA_VERSION", "__version__", "bundled_schema_version"]

SCHEMA_VERSION = "v0.2"


def bundled_schema_version() -> str:
    """Return the in-band footprint schema version bundled with the tool."""

    return SCHEMA_VERSION
