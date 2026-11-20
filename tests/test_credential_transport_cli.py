"""Credentials stay out of process arguments and off plain HTTP (honua-migrate#266)."""

from __future__ import annotations

from typing import Any

import click
import pytest
import responses
from typer.testing import CliRunner

from honua_migrate.assessment.cli import main
from honua_migrate.services.geoservices_rest import geoservices_app

SOURCE_URL = "https://arcgis.test/rest/services/Parcels/FeatureServer"


def test_api_key_on_the_command_line_is_refused() -> None:
    result = CliRunner().invoke(
        geoservices_app,
        ["discover", SOURCE_URL, "--api-key", "secret-key"],
        env={"HONUA_URL": "https://honua.test"},
        color=False,
    )

    assert result.exit_code != 0
    assert "HONUA_API_KEY" in click.unstyle(result.output)
    assert "secret-key" not in click.unstyle(result.output)


@pytest.mark.parametrize(
    "target",
    ["http://gis.example.com/arcgis", "HTTP://gis.example.com/arcgis"],
)
@pytest.mark.parametrize("command", ["agol", "server", "rbac"])
@responses.activate
def test_scan_refuses_token_over_plain_http(
    tmp_path: Any, monkeypatch: Any, capsys: Any, command: str, target: str
) -> None:
    monkeypatch.setenv("ESRI_TOKEN", "secret-token")

    exit_code = main(
        ["scan", command, "--target", target, "--token-env", "ESRI_TOKEN", "--output", str(tmp_path / "out.json")]
    )

    assert exit_code != 0
    assert "--allow-insecure-http" in capsys.readouterr().err
    assert len(responses.calls) == 0


@pytest.mark.parametrize(
    ("target", "extra"),
    [
        ("http://localhost:6080/arcgis", []),
        ("http://127.0.0.1:6080/arcgis", []),
        ("http://gis.example.com/arcgis", ["--allow-insecure-http"]),
    ],
)
@responses.activate
def test_scan_allows_plain_http_for_loopback_or_opt_in(
    tmp_path: Any, monkeypatch: Any, capsys: Any, target: str, extra: list[str]
) -> None:
    monkeypatch.setenv("ESRI_TOKEN", "secret-token")

    main(["scan", "server", "--target", target, "--token-env", "ESRI_TOKEN", "--output", str(tmp_path / "out.json"), *extra])

    assert "--allow-insecure-http" not in capsys.readouterr().err


@responses.activate
def test_scan_without_token_may_use_plain_http(tmp_path: Any, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.delenv("ESRI_TOKEN", raising=False)

    main(["scan", "server", "--target", "http://gis.example.com/arcgis", "--output", str(tmp_path / "out.json")])

    assert "--allow-insecure-http" not in capsys.readouterr().err
