"""Programmatic helper for invoking the assessment through the unified CLI."""

from __future__ import annotations

from .app import cli_app


def main(argv: list[str] | None = None) -> int:
    """Run the assessment command through the sole supported CLI entry point."""

    from honua_migrate.cli import main as migration_main

    return migration_main(["assess", *(argv or [])])


__all__ = ["cli_app", "main"]
