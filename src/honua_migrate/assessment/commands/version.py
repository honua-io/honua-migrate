"""Version command."""

from __future__ import annotations

import typer

from honua_migrate.assessment import __version__, bundled_schema_version


def version_command() -> None:
    typer.echo(f"honua-migrate assess {__version__}")
    typer.echo(f"EsriFootprint schema {bundled_schema_version()}")
