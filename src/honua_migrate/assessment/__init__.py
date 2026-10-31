"""Read-only assessment components mounted under ``honua-migrate assess``."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

__all__ = ["SCHEMA_VERSION", "__version__", "bundled_schema_version"]

# These schema constants remain until the v0.3 contract migration lands.
SCHEMA_VERSION = "v0.2"

try:
    __version__ = version("honua-migrate")
except PackageNotFoundError:
    __version__ = "0.9.1"


def bundled_schema_version() -> str:
    """Return the in-band footprint schema version bundled with the tool."""

    return SCHEMA_VERSION
