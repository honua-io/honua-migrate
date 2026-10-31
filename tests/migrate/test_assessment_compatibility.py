"""Parity checks for the assessment successor and legacy compatibility surface."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterator
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

import pytest
from typer.testing import CliRunner

from honua_esri_assess.app import cli_app as legacy_app
from honua_esri_assess.commands.common import ScanOptions, ScanResult
from honua_esri_assess.commands.scan_handlers import HANDLERS, ScanHandler, register
from honua_esri_assess.footprint import AccessFootprint, build_access_footprint
from honua_esri_assess.footprint.artifact import build_footprint
from honua_migrate.app import cli_app as migration_app

REPO_ROOT = Path(__file__).resolve().parents[2]
ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
SECRET_TARGET = (
    "https://alice:superpass@fixture.local/sharing/rest;jsessionid=session-secret"
    "?token=topsecret-token&password=hidden-password#session"
)
FIXED_TIME = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
WARNING_FRAGMENT = "honua_esri_assess and honua-esri-assess are compatibility surfaces"

SCHEMA_HASHES = {
    "geoservices-rest-footprint-v0.1.json": "a7776eb3019f9898e9057484b774be99f5de48926c4f9f61a97cc54743f0cd02",
    "geoservices-rest-footprint-v0.2.json": "77cf8d30c0770f204491c471854217760e1c984086d7a8e63b5500bf50adf933",
    "geoservices-rest-footprint-v0.3.json": "f448d79ba892cbec1bf308f02d63c9dac907a8554fa682060f9bc4b964a4a9dd",
    "geoservices-rest-access-footprint-v0.1.json": "76ea38ec78e7a43e01297f90bd03ac54e68e0768b880c9a63625c586f34a7722",
    "geoservices-rest-access-footprint-v0.2.json": "b03c27096704400813b6e9d56d200f29a67e014c4f29f25f7203bf995e1c214b",
    "geoservices-rest-access-footprint-v0.3.json": "d47a57eb675f531668f9381f48fb769c0b2cbd14fa7d95a0d2406b2d6664a9a1",
}


@pytest.fixture(autouse=True)
def restore_handlers() -> Iterator[None]:
    original = dict(HANDLERS)
    try:
        yield
    finally:
        HANDLERS.clear()
        HANDLERS.update(original)


def _visible_help(output: str) -> str:
    lines = ANSI_ESCAPE.sub("", output).splitlines()
    return "\n".join(line for line in lines if "Usage:" not in line)


@pytest.mark.parametrize(
    "args",
    [
        ("scan", "agol", "--help"),
        ("scan", "server", "--help"),
        ("scan", "filegdb", "--help"),
        ("scan", "filegdb-workspace", "--help"),
        ("scan", "rbac", "--help"),
        ("report", "--help"),
        ("verdict", "--help"),
        ("caps", "--help"),
        ("schema", "--help"),
    ],
)
def test_successor_help_matches_every_assessment_workflow(args: tuple[str, ...]) -> None:
    runner = CliRunner()
    env = {"COLUMNS": "160"}

    legacy = runner.invoke(legacy_app, list(args), env=env)
    successor = runner.invoke(migration_app, ["assess", *args], env=env)

    assert legacy.exit_code == successor.exit_code == 0
    assert _visible_help(successor.output) == _visible_help(legacy.output)


def test_successor_mounts_the_same_application_object() -> None:
    mounted = next(
        group.typer_instance
        for group in migration_app.registered_groups
        if group.name == "assess"
    )

    assert mounted is legacy_app


@pytest.mark.parametrize("backend", ["agol", "server", "filegdb"])
def test_footprint_artifact_and_redaction_are_byte_identical(
    backend: str,
    tmp_path: Path,
) -> None:
    source_kind = {
        "agol": "portal",
        "server": "geoservices-server",
        "filegdb": "filegdb",
    }[backend]

    def run(options: ScanOptions) -> ScanResult:
        kwargs: dict[str, Any] = {}
        if backend == "agol":
            kwargs["portal"] = {
                "orgId": "fixture-org",
                "orgUrl": "https://fixture.local",
                "itemCounts": {},
            }
        elif backend == "server":
            kwargs["server"] = {"folders": [], "serviceCounts": {}}
        else:
            kwargs["filegdb"] = {"pathHash": "sha256:fixture", "featureClassCount": 0}
        return ScanResult(
            footprint=build_footprint(
                source_kind=source_kind,
                target=options.target,
                inventory=[],
                diagnostics=[],
                generated_at=FIXED_TIME,
                captured_at=FIXED_TIME,
                **kwargs,
            )
        )

    register(ScanHandler(name=backend, run=run))
    legacy_output = tmp_path / f"legacy-{backend}.json"
    successor_output = tmp_path / f"successor-{backend}.json"
    runner = CliRunner()

    legacy = runner.invoke(
        legacy_app,
        ["scan", backend, "--target", SECRET_TARGET, "--output", str(legacy_output)],
    )
    successor = runner.invoke(
        migration_app,
        [
            "assess",
            "scan",
            backend,
            "--target",
            SECRET_TARGET,
            "--output",
            str(successor_output),
        ],
    )

    assert legacy.exit_code == successor.exit_code == 0
    assert successor_output.read_bytes() == legacy_output.read_bytes()
    artifact_text = successor_output.read_text(encoding="utf-8")
    for secret in (
        "alice:superpass",
        "superpass",
        "session-secret",
        "topsecret-token",
        "hidden-password",
    ):
        assert secret not in artifact_text


def test_access_artifact_is_byte_and_shape_identical(tmp_path: Path) -> None:
    artifact = build_access_footprint(
        AccessFootprint(source_kind="portal", locator=SECRET_TARGET),
        generated_at=FIXED_TIME,
        captured_at=FIXED_TIME,
    )
    register(
        ScanHandler(
            name="rbac",
            run=lambda options: ScanResult(footprint=deepcopy(artifact)),
        )
    )
    legacy_output = tmp_path / "legacy-access.json"
    successor_output = tmp_path / "successor-access.json"
    runner = CliRunner()

    legacy = runner.invoke(
        legacy_app,
        ["scan", "rbac", "--target", SECRET_TARGET, "--output", str(legacy_output)],
    )
    successor = runner.invoke(
        migration_app,
        [
            "assess",
            "scan",
            "rbac",
            "--target",
            SECRET_TARGET,
            "--output",
            str(successor_output),
        ],
    )

    assert legacy.exit_code == successor.exit_code == 0
    assert successor_output.read_bytes() == legacy_output.read_bytes()
    assert json.loads(successor_output.read_text(encoding="utf-8")) == artifact
    assert "superpass" not in successor_output.read_text(encoding="utf-8")


def test_schema_show_is_byte_identical() -> None:
    runner = CliRunner()

    legacy = runner.invoke(legacy_app, ["schema", "show"])
    successor = runner.invoke(migration_app, ["assess", "schema", "show"])

    assert legacy.exit_code == successor.exit_code == 0
    assert successor.stdout_bytes == legacy.stdout_bytes


@pytest.mark.parametrize(("filename", "digest"), SCHEMA_HASHES.items())
def test_schema_contract_bytes_are_locked(filename: str, digest: str) -> None:
    root_bytes = (REPO_ROOT / "schemas" / filename).read_bytes()
    package_bytes = (
        REPO_ROOT / "src" / "honua_esri_assess" / "schemas" / filename
    ).read_bytes()

    assert package_bytes == root_bytes
    # Git may materialize JSON as CRLF on Windows. Lock the repository's
    # canonical LF content so this contract check is platform-independent.
    canonical_bytes = root_bytes.replace(b"\r\n", b"\n")
    assert hashlib.sha256(canonical_bytes).hexdigest() == digest


def _subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    source = str(REPO_ROOT / "src")
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = source if not existing else os.pathsep.join((source, existing))
    return env


def test_public_legacy_import_warns_once_and_survives_strict_warnings() -> None:
    code = """
import importlib
import honua_esri_assess
from honua_esri_assess import SCHEMA_VERSION, bundled_schema_version
from honua_esri_assess.footprint import build_footprint
importlib.reload(honua_esri_assess)
print(SCHEMA_VERSION, bundled_schema_version(), callable(build_footprint))
"""
    result = subprocess.run(
        [sys.executable, "-W", "error", "-c", code],
        cwd=REPO_ROOT,
        env=_subprocess_env(),
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0
    assert result.stdout.strip() == "v0.3 v0.3 True"
    assert result.stderr.count(WARNING_FRAGMENT) == 1
    assert "no earlier than honua-migrate 1.2" in result.stderr


def test_legacy_module_remains_functional_and_keeps_stdout_clean() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "honua_esri_assess", "--version"],
        cwd=REPO_ROOT,
        env=_subprocess_env(),
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0
    assert result.stdout.startswith("honua-esri-assess ")
    assert WARNING_FRAGMENT not in result.stdout
    assert result.stderr.count(WARNING_FRAGMENT) == 1


def test_successor_module_does_not_emit_the_legacy_warning() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "honua_migrate", "assess", "--version"],
        cwd=REPO_ROOT,
        env=_subprocess_env(),
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0
    assert result.stdout.startswith("honua-esri-assess ")
    assert WARNING_FRAGMENT not in result.stderr


def test_transition_document_has_no_curl_text() -> None:
    text = (REPO_ROOT / "docs" / "assessment-transition.md").read_text(
        encoding="utf-8"
    )

    assert "curl" not in text.casefold()
    assert "two consecutive `honua-migrate` minor releases" in text
    assert "at least 90" in text
    assert "before `honua-migrate`\n1.2" in text
