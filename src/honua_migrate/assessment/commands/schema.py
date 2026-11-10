"""`schema` command group."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from honua_migrate.assessment.diagnostics import (
    SchemaValidationError,
    print_diagnostic_error,
)
from honua_migrate.assessment.schema import schema_text, validate_footprint_file

schema_app = typer.Typer(
    help="Inspect and validate the bundled assessment footprint schema.",
    no_args_is_help=True,
)


@schema_app.command("show", help="Print the bundled assessment footprint schema.")
def show_schema() -> None:
    typer.echo(schema_text())


@schema_app.command("validate", help="Validate an assessment footprint artifact.")
def validate_schema(
    path: Annotated[
        Path,
        typer.Argument(help="Path to an assessment footprint."),
    ],
) -> None:
    try:
        validate_footprint_file(path)
    except SchemaValidationError as exc:
        print_diagnostic_error(exc)
        raise typer.Exit(exc.exit_code) from None
    typer.echo(f"valid: {path}")
