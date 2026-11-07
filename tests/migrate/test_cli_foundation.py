"""Tests for the stable unified CLI foundation."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

import honua_migrate.app as app
from honua_migrate.app import cli_app
from honua_migrate.cli import main
from honua_migrate.contracts import EXIT_APPLY_REFUSED, EXIT_UNAVAILABLE, MigrationPlan


def test_root_help_exposes_the_migration_command_tree() -> None:
    result = CliRunner().invoke(cli_app, ["--help"], env={"COLUMNS": "160"})

    assert result.exit_code == 0
    for command in ("assess", "plan", "services", "content", "code", "apply", "reconcile"):
        assert command in result.output


def test_assess_nests_the_legacy_read_only_cli() -> None:
    result = CliRunner().invoke(cli_app, ["assess", "--help"], env={"COLUMNS": "160"})

    assert result.exit_code == 0
    assert "scan" in result.output
    assert "report" in result.output


def test_placeholders_are_explicit_and_safe() -> None:
    assert main(["plan", "create"]) == EXIT_UNAVAILABLE
    assert main(["apply", "plan"]) == EXIT_APPLY_REFUSED


def test_plan_contract_is_json_compatible_and_versioned() -> None:
    plan = MigrationPlan(id="plan-1", service="arcgis", actions=({"kind": "copy"},))

    assert plan.to_dict() == {
        "id": "plan-1",
        "service": "arcgis",
        "actions": [{"kind": "copy"}],
        "contract_version": "v1",
        "safety_mode": "plan",
        "plan_digest": "sha256:0c81fdd5035b503ed17aadabc25d25a34b013dd0eb1d6d872754ab957dde5fb5",
    }


def test_main_surfaces_actionable_typer_bad_parameter_errors(capsys) -> None:
    """A ``typer.BadParameter`` raised deep in a service command must reach the
    operator with its real message and exit code 2, not the generic internal
    failure fallback (regression: Typer's vendored ``_click`` fork moved
    ``Exit`` out of ``_click.exceptions``, which masked every ClickException)."""

    exit_code = main(["services", "geoservices-rest", "status", "../secrets"])

    assert exit_code == 2
    output = capsys.readouterr().err
    assert "internal migration command failure" not in output
    assert "Job ID may contain only letters" in output


def test_service_cli_uses_geoservices_rest_route() -> None:
    result = CliRunner().invoke(cli_app, ["services", "geoservices-rest", "--help"])

    assert result.exit_code == 0
    assert "discover" in result.output
    service_help = CliRunner().invoke(cli_app, ["services", "--help"])
    assert service_help.exit_code == 0
    assert "geoservices-rest" in service_help.output
    assert "arcgis" not in service_help.output
    retired_route = CliRunner().invoke(cli_app, ["services", "arcgis", "--help"])
    assert retired_route.exit_code == 2
    assert "No such command" in retired_route.output


@pytest.mark.parametrize("command", ["geoservices-rest", "geoserver"])
def test_every_builtin_service_command_registers(command: str) -> None:
    result = CliRunner().invoke(cli_app, ["services", command, "--help"])

    assert result.exit_code == 0
    assert f"services {command}" in result.output


def test_missing_builtin_service_module_fails_loudly(monkeypatch) -> None:
    import_module = app.importlib.import_module

    def missing_builtin(name: str):
        if name == "honua_migrate.services.geoservices_rest":
            raise ModuleNotFoundError("built-in service module missing", name=name)
        return import_module(name)

    monkeypatch.setattr(app.importlib, "import_module", missing_builtin)
    with pytest.raises(ModuleNotFoundError, match="built-in service module missing"):
        app._discover_service_apps()


def test_python_module_entry_point_displays_help() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        filter(None, (str(repo_root / "src"), env.get("PYTHONPATH", "")))
    )
    result = subprocess.run(
        [sys.executable, "-m", "honua_migrate", "--help"],
        cwd=repo_root,
        env=env,
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0
    assert "Honua migration planning" in result.stdout
