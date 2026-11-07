"""Mount the read-only assessment application below ``honua-migrate assess``."""

from __future__ import annotations

from honua_migrate.assessment.app import cli_app as assess_app

__all__ = ["assess_app"]
