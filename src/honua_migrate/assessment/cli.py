"""Programmatic helper for invoking the assessment through the unified CLI."""

from __future__ import annotations

import sys

from .app import cli_app


def main(argv: list[str] | None = None) -> int:
    """Run the assessment command through the sole supported CLI entry point."""

    from honua_migrate.cli import main as migration_main

    arguments = sys.argv[1:] if argv is None else argv
    return migration_main(["assess", *arguments])


__all__ = ["cli_app", "main"]
