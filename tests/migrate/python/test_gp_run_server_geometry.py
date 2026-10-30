"""Live ``code python run`` against a geoprocessing-capable Honua server.

The offline translator still emits the bare process id ``buffer``. A server
that publishes ``geometry.buffer`` is executed only through the SDK
geoprocessing client, and only for a literal geometry the server accepts.
Feature-class names are refused before any request. A credential failure is
not a submitted job. A failed or unfinished job keeps its id and is posted once.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from typing import Any

import pytest

from honua_migrate.cli import main
from honua_migrate.contracts import (
    EXIT_BAD_ARGUMENTS,
    EXIT_PARTIAL,
    EXIT_REMOTE_ERROR,
    EXIT_SUCCESS,
    EXIT_UNAVAILABLE,
    EXIT_VALIDATION_ERROR,
)

_SERVER = "https://example.test"
_POLL_BOUND = 120
_SENTINEL = "hk_test_credential_9f3a"
_POINT = '{"type": "Point", "coordinates": [0.0, 0.0]}'
_WKB_POINT = "AQEAAAAAAAAAAAAAAAAAAAAAAAAA"
_GEOMETRY = (
    "import arcpy\n"
    "arcpy.analysis.Buffer("
    f"{_POINT}, 'buffered', 10, srid=4326)\n"
)
_WKB = (
    "import arcpy\n"
    "arcpy.analysis.Buffer("
    f"'{_WKB_POINT}', 'buffered', 10, srid=4326)\n"
)
_FEATURE_CLASS = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('roads', 'roads_buffer', '25 Meters')\n"
)
_GEOMETRY_THEN_CLIP = (
    "import arcpy\n"
    "arcpy.analysis.Buffer("
    f"{_POINT}, 'buffered', 10, srid=4326)\n"
    "arcpy.analysis.Clip('buffered', 'district', 'clipped')\n"
)
_FEATURE = {
    "type": "Feature",
    "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
    "properties": {},
}


class _Job:
    def __init__(self, job_id: str, status: str) -> None:
        self.job_id = job_id
        self.status = status
        self.inline_results = None


class _Geoprocessing:
    def __init__(self) -> None:
        self.posts: list[dict[str, Any]] = []
        self.job_calls: list[str] = []
        self.result_calls: list[str] = []
        self.mode = "success"

    def submit_geometry(
        self,
        process_id: str,
        inputs: dict[str, Any],
        *,
        respond_async: bool = True,
    ) -> _Job:
        self.posts.append(
            {
                "processId": process_id,
                "inputs": inputs,
                "respond_async": respond_async,
            }
        )
        if self.mode == "auth":
            error = RuntimeError("HTTP 401")
            error.status_code = 401  # type: ignore[attr-defined]
            raise error
        if self.mode == "failed":
            return _Job("gp-fail", "accepted")
        if self.mode == "timeout":
            return _Job("gp-slow", "accepted")
        return _Job("gp-ok", "accepted")

    def job(self, job_id: str) -> _Job:
        self.job_calls.append(job_id)
        if self.mode == "failed":
            return _Job(job_id, "failed")
        if self.mode == "timeout":
            return _Job(job_id, "running")
        return _Job(job_id, "successful")

    def results(self, job_id: str) -> dict[str, Any]:
        self.result_calls.append(job_id)
        if self.mode == "empty-output":
            return {}
        return {"outputFeatureLayer": {"value": _FEATURE}}


def _install_sdk(monkeypatch: pytest.MonkeyPatch) -> tuple[_Geoprocessing, dict[str, Any]]:
    geoprocessing = _Geoprocessing()
    seen: dict[str, Any] = {"clients": 0, "api_key": None, "kwargs": None}

    class Client:
        def __init__(self, server: str, **kwargs: object) -> None:
            seen["clients"] += 1
            seen["server"] = server
            seen["kwargs"] = kwargs
            seen["api_key"] = kwargs.get("api_key")

        def __enter__(self) -> Client:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def geoprocessing(self) -> _Geoprocessing:
            return geoprocessing

    module = types.ModuleType("honua_sdk")
    module.HonuaClient = Client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "honua_sdk", module)
    return geoprocessing, seen


def _quiet_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    import honua_migrate.code.python.arcpy as arcpy_mod

    monkeypatch.setattr(arcpy_mod.time, "sleep", lambda _seconds: None)


def _run(
    tmp_path: Path,
    source: str,
    *args: str,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[int, dict[str, Any], _Geoprocessing, dict[str, Any]]:
    script = tmp_path / "workflow.py"
    script.write_text(source, encoding="utf-8")
    output = tmp_path / "run.json"
    geoprocessing, seen = _install_sdk(monkeypatch)
    code = main(
        [
            "code",
            "python",
            "run",
            str(script),
            "--server",
            _SERVER,
            "--output",
            str(output),
            *args,
        ]
    )
    text = output.read_text(encoding="utf-8")
    assert _SENTINEL not in text
    assert "coordinates" not in text
    payload = json.loads(text)
    assert isinstance(payload, dict)
    return code, payload, geoprocessing, seen


def test_geometry_literal_buffer_verifies_inline_feature(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    monkeypatch.setenv("HONUA_API_KEY", _SENTINEL)
    code, payload, geoprocessing, seen = _run(
        tmp_path,
        _GEOMETRY,
        "--yes",
        "--api-key-env",
        "HONUA_API_KEY",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_SUCCESS
    assert payload["outcome"] == "succeeded"
    assert payload["reason"] == "completed"
    assert payload["executionSuccess"] is True
    assert payload["submitted"] is True
    assert payload["dispatchCount"] == 1
    assert seen["api_key"] == _SENTINEL
    assert seen["kwargs"] == {"api_key": _SENTINEL}
    assert len(geoprocessing.posts) == 1
    post = geoprocessing.posts[0]
    assert post["processId"] == "geometry.buffer"
    assert post["respond_async"] is True
    assert post["inputs"] == {
        "wkb": {"type": "Point", "coordinates": [0.0, 0.0]},
        "srid": 4326,
        "distance": 10,
    }
    assert "outputs" not in post["inputs"]
    assert geoprocessing.result_calls == ["gp-ok"]
    assert payload["jobs"] == [
        {
            "jobId": "gp-ok",
            "processId": "geometry.buffer",
            "qualifiedName": "arcpy.analysis.Buffer",
            "status": "successful",
            "succeeded": True,
        }
    ]
    assert payload["outputChecks"] == [
        {"name": "result", "verified": True, "reference": "inline:Feature"}
    ]


def test_base64_wkb_buffer_is_posted_unchanged(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, geoprocessing, _seen = _run(
        tmp_path,
        _WKB,
        "--yes",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_SUCCESS
    assert geoprocessing.posts[0]["inputs"]["wkb"] == _WKB_POINT
    assert payload["jobs"][0]["jobId"] == "gp-ok"
    assert _seen["kwargs"] == {}


def test_feature_class_buffer_is_not_dispatched(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, geoprocessing, _seen = _run(
        tmp_path,
        _FEATURE_CLASS,
        "--yes",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_VALIDATION_ERROR
    assert payload["outcome"] == "incomplete"
    assert payload["reason"] == "not-executable"
    assert payload["executionSuccess"] is False
    assert payload["submitted"] is False
    assert payload["dispatchCount"] == 0
    assert payload["jobs"] == []
    assert geoprocessing.posts == []


def test_unmapped_later_step_refuses_the_whole_plan(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, geoprocessing, _seen = _run(
        tmp_path,
        _GEOMETRY_THEN_CLIP,
        "--yes",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_VALIDATION_ERROR
    assert payload["reason"] == "not-executable"
    assert payload["submitted"] is False
    assert payload["dispatchCount"] == 0
    assert geoprocessing.posts == []


def test_feature_class_dry_run_keeps_the_offline_process_id(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, geoprocessing, seen = _run(
        tmp_path,
        _FEATURE_CLASS,
        "--dry-run",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_SUCCESS
    assert payload["outcome"] == "dry-run"
    assert payload["reason"] == "not-executed"
    assert payload["executionSuccess"] is False
    assert payload["submitted"] is False
    assert [item["processId"] for item in payload["executions"]] == ["buffer"]
    assert geoprocessing.posts == []
    assert seen["clients"] == 0


def test_auth_failure_is_not_a_submitted_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.py"
    script.write_text(_GEOMETRY, encoding="utf-8")
    output = tmp_path / "run.json"
    geoprocessing, _seen = _install_sdk(monkeypatch)
    geoprocessing.mode = "auth"
    code = main(
        [
            "code",
            "python",
            "run",
            str(script),
            "--server",
            _SERVER,
            "--output",
            str(output),
            "--yes",
        ]
    )
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert code == EXIT_UNAVAILABLE
    assert payload["outcome"] == "unavailable"
    assert payload["reason"] == "unauthenticated"
    assert payload["executionSuccess"] is False
    assert payload["submitted"] is False
    assert payload["dispatchCount"] == 0
    assert len(geoprocessing.posts) == 1
    assert geoprocessing.job_calls == []
    assert payload["jobs"][0]["jobId"] is None
    assert payload["jobs"][0]["succeeded"] is False
    assert "not retried" in payload["guidance"]


def test_failed_job_keeps_its_id_and_is_not_resubmitted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    script = tmp_path / "workflow.py"
    script.write_text(_GEOMETRY, encoding="utf-8")
    output = tmp_path / "run.json"
    geoprocessing, _seen = _install_sdk(monkeypatch)
    geoprocessing.mode = "failed"
    code = main(
        [
            "code",
            "python",
            "run",
            str(script),
            "--server",
            _SERVER,
            "--output",
            str(output),
            "--yes",
        ]
    )
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert code == EXIT_REMOTE_ERROR
    assert payload["outcome"] == "failed"
    assert payload["reason"] == "job-failed"
    assert payload["executionSuccess"] is False
    assert payload["submitted"] is True
    assert payload["dispatchCount"] == 1
    assert len(geoprocessing.posts) == 1
    assert geoprocessing.result_calls == []
    assert payload["jobs"][0]["jobId"] == "gp-fail"
    assert payload["jobs"][0]["status"] == "failed"
    assert "not resubmitted" in payload["guidance"]


def test_unfinished_job_keeps_its_id_and_is_not_resubmitted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    script = tmp_path / "workflow.py"
    script.write_text(_GEOMETRY, encoding="utf-8")
    output = tmp_path / "run.json"
    geoprocessing, _seen = _install_sdk(monkeypatch)
    geoprocessing.mode = "timeout"
    code = main(
        [
            "code",
            "python",
            "run",
            str(script),
            "--server",
            _SERVER,
            "--output",
            str(output),
            "--yes",
        ]
    )
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert code == EXIT_PARTIAL
    assert payload["outcome"] == "timed-out"
    assert payload["reason"] == "job-timed-out"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(geoprocessing.posts) == 1
    assert len(geoprocessing.job_calls) == _POLL_BOUND
    assert payload["jobs"][0]["jobId"] == "gp-slow"
    assert payload["jobs"][0]["status"] == "running"
    assert "not resubmitted" in payload["guidance"]
    assert "gp-slow" in payload["guidance"]


def test_successful_job_without_geometry_output_is_not_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    script = tmp_path / "workflow.py"
    script.write_text(_GEOMETRY, encoding="utf-8")
    output = tmp_path / "run.json"
    geoprocessing, _seen = _install_sdk(monkeypatch)
    geoprocessing.mode = "empty-output"
    code = main(
        [
            "code",
            "python",
            "run",
            str(script),
            "--server",
            _SERVER,
            "--output",
            str(output),
            "--yes",
        ]
    )
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert code == EXIT_PARTIAL
    assert payload["reason"] == "output-unverified"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(geoprocessing.posts) == 1
    assert payload["jobs"][0]["jobId"] == "gp-ok"
    assert payload["outputChecks"][0]["verified"] is False
    assert payload["outputChecks"][0]["reference"] is None


def test_missing_api_key_does_not_open_a_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("HONUA_API_KEY", raising=False)
    code, payload, geoprocessing, seen = _run(
        tmp_path,
        _GEOMETRY,
        "--yes",
        "--api-key-env",
        "HONUA_API_KEY",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_UNAVAILABLE
    assert payload["outcome"] == "unavailable"
    assert payload["reason"] == "unauthenticated"
    assert payload["submitted"] is False
    assert payload["dispatchCount"] == 0
    assert payload["jobs"] == []
    assert geoprocessing.posts == []
    assert seen["clients"] == 0


def test_invalid_api_key_env_name_writes_no_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.py"
    script.write_text(_GEOMETRY, encoding="utf-8")
    output = tmp_path / "run.json"
    _install_sdk(monkeypatch)
    code = main(
        [
            "code",
            "python",
            "run",
            str(script),
            "--server",
            _SERVER,
            "--output",
            str(output),
            "--yes",
            "--api-key-env",
            "not-a-name",
        ]
    )

    assert code == EXIT_BAD_ARGUMENTS
    assert not output.exists()
