"""Typer application construction."""

from __future__ import annotations

import typer

from honua_migrate.assessment.commands.caps import caps_command
from honua_migrate.assessment.commands.report import report_command
from honua_migrate.assessment.commands.scan import scan_app
from honua_migrate.assessment.commands.schema import schema_app
from honua_migrate.assessment.commands.verdict import verdict_command
from honua_migrate.assessment.commands.version import version_command

cli_app = typer.Typer(
    add_completion=False,
    context_settings={"help_option_names": ["-h", "--help"]},
    help="Read-only source footprint assessment tooling.",
    no_args_is_help=True,
)


def _version_callback(value: bool) -> None:
    if value:
        version_command()
        raise typer.Exit()


@cli_app.callback()
def root(
    version: bool = typer.Option(
        False,
        "--version",
        callback=_version_callback,
        help="Print package and bundled schema versions.",
        is_eager=True,
    ),
) -> None:
    del version


cli_app.add_typer(scan_app, name="scan")
cli_app.add_typer(schema_app, name="schema")
cli_app.command("report", help="Render the assessment footprint to Markdown.")(
    report_command
)
cli_app.command(
    "verdict",
    help="Render a per-shop-profile migratability verdict from an assessment footprint.",
)(verdict_command)
cli_app.command(
    "caps",
    help=(
        "Crosswalk an assessment footprint to Honua capability keys, emitting "
        "honua-caps.json plus a shareable catalog URL."
    ),
)(caps_command)
cli_app.command("version", help="Print package and bundled schema versions.")(
    version_command
)
