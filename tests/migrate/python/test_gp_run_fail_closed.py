"""Shipped ``honua-migrate code python run`` must fail closed.

These tests drive ``honua_migrate.cli:main``, the console-script entry.
Exit 0 is execution success only after every required job reaches a
successful terminal state and every declared output reference checks out.
``--yes`` does not weaken that. Scan, translate, and dry-run are not
execution success.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from typing import Any

import pytest

import honua_migrate
from honua_migrate.cli import main
from honua_migrate.contracts import (
    EXIT_BAD_ARGUMENTS,
    EXIT_PARTIAL,
    EXIT_REMOTE_ERROR,
    EXIT_SAFETY_REFUSAL,
    EXIT_SUCCESS,
    EXIT_VALIDATION_ERROR,
)

_SCHEMA = "honua.migration.python.gp-run/v1"
_SERVER = "https://example.test"
_POLL_BOUND = 120

_BUFFER = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('roads', 'buffered', '10 Meters')\n"
)
_KEYWORD_BUFFER = (
    "import arcpy\n"
    "arcpy.analysis.Buffer("
    "in_features='roads', out_feature_class='buffered', "
    "buffer_distance_or_field='10 Meters')\n"
)
_KRIGING = "import arcpy\narcpy.sa.Kriging('stations', 'PredZ')\n"
_ERASE = "import arcpy\narcpy.analysis.Erase('a', 'b', 'c')\n"
_MIXED = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('roads', 'roads_buffer', '25 Meters')\n"
    "arcpy.sa.Kriging('stations', 'PredZ')\n"
)
_MISSING = "import arcpy\narcpy.analysis.Clip('parcels', 'district')\n"
_UNRESOLVED = "import arcpy\narcpy.analysis.Buffer(roads, 'buffered', '10 Meters')\n"
_DEPENDENCY = (
    "import arcpy\n"
    "buffered = arcpy.analysis.Buffer('roads', 'buffered', '10 Meters')\n"
    "arcpy.analysis.Clip(buffered, 'district', 'clipped')\n"
)
_BRANCH = (
    "import arcpy\n"
    "if include:\n"
    "    arcpy.analysis.Buffer('roads', 'buffered', '10 Meters')\n"
)
_LOOP = (
    "import arcpy\n"
    "for name in ('roads',):\n"
    "    arcpy.analysis.Buffer(name, 'buffered', '10 Meters')\n"
)
_FUNCTION = (
    "import arcpy\n"
    "def build():\n"
    "    arcpy.analysis.Buffer('roads', 'buffered', '10 Meters')\n"
)
_BRANCH_AND_STRAIGHT = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('roads', 'buffered', '10 Meters')\n"
    "if False:\n"
    "    arcpy.analysis.Buffer('roads', 'other', '5 Meters')\n"
)
_SYNTAX = "import arcpy\narcpy.analysis.Buffer(\n"
_CHAIN = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('parcels', 'parcels_buffer', '10 Meters')\n"
    "arcpy.analysis.Clip('parcels_buffer', 'district', 'parcels_clip')\n"
)
_ALIAS_BUFFER = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('a', distance='5 Meters', output='result-fc')\n"
)
_ALIAS_DISTANCE_ONLY = (
    "import arcpy\n"
    "arcpy.analysis.Buffer('a', distance='5 Meters')\n"
)


class _Processes:
    def __init__(self, behavior: dict[str, Any]) -> None:
        self.behavior = behavior
        self.posts: list[dict[str, Any]] = []
        self.job_calls: list[str] = []
        self.result_calls: list[str] = []

    def execute(self, process_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.posts.append({"processId": process_id, "payload": payload})
        action = self.behavior.get("execute", "accept")
        if action == "raise":
            raise ConnectionError("connection reset")
        if action == "sync-success":
            return {
                "status": "successful",
                "outputs": {"result": f"{_SERVER}/outputs/{process_id}"},
            }
        if action == "sync-accepted":
            return {"status": "accepted", "processID": process_id}
        if action == "sync-outputs-only":
            return {"outputs": {"result": f"{_SERVER}/outputs/{process_id}"}}
        job_id = f"https://jobs.example.test/{process_id}?token=secret"
        if action == "plain-job":
            job_id = f"job-{process_id}"
        return {"jobID": job_id, "status": "accepted"}

    def job(self, job_id: str) -> dict[str, Any]:
        self.job_calls.append(job_id)
        action = self.behavior.get("job", "running")
        if action == "raise":
            raise ConnectionError("connection reset")
        status = {
            "running": "running",
            "failed": "failed",
            "cancelled": "cancelled",
            "successful": "successful",
        }[action]
        return {"jobID": job_id, "status": status}

    def job_results(self, job_id: str) -> dict[str, Any]:
        self.result_calls.append(job_id)
        results = self.behavior.get("results", "verified")
        if results == "raise":
            raise ConnectionError("connection reset")
        if results == "verified":
            return {"outputs": {"result": f"{_SERVER}/outputs/{job_id}"}}
        if results == "mismatch":
            return {"outputs": {"result": "not-the-dataset"}}
        if results == "empty":
            return {"outputs": {"result": ""}}
        return {"outputs": {}}


def _install_sdk(monkeypatch: pytest.MonkeyPatch, behavior: dict[str, Any]) -> _Processes:
    processes = _Processes(behavior)
    state = {"clients": 0}

    class Client:
        def __init__(self, server: str) -> None:
            state["clients"] += 1
            self.server = server

        def __enter__(self) -> Client:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def ogc_processes(self) -> _Processes:
            return processes

    module = types.ModuleType("honua_sdk")
    module.HonuaClient = Client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "honua_sdk", module)
    processes.behavior["clients"] = state
    return processes


def _quiet_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    import honua_migrate.code.python.arcpy as arcpy_mod

    monkeypatch.setattr(arcpy_mod.time, "sleep", lambda _seconds: None)


def _run(
    tmp_path: Path,
    source: str,
    *args: str,
    monkeypatch: pytest.MonkeyPatch,
    behavior: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any], _Processes]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    script = tmp_path / "workflow.py"
    script.write_text(source, encoding="utf-8")
    output = tmp_path / "run.json"
    processes = _install_sdk(monkeypatch, {} if behavior is None else behavior)
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
    assert str(tmp_path) not in text
    payload = json.loads(text)
    assert isinstance(payload, dict)
    return code, payload, processes


def _assert_common(payload: dict[str, Any], *, mode: str) -> None:
    assert payload["schema"] == _SCHEMA
    assert payload["command"] == "run"
    assert payload["mode"] == mode
    assert payload["script"] == "workflow.py"
    assert payload["server"] == _SERVER
    assert payload["package"] == {
        "name": "honua-migrate",
        "version": honua_migrate.__version__,
    }
    assert str(payload["planId"]).startswith("sha256:")
    assert payload["maxPolls"] == _POLL_BOUND
    assert payload["pollIntervalSeconds"] == 1.0
    assert "attest" not in json.dumps(payload).lower()
    assert isinstance(payload["guidance"], str) and payload["guidance"]


@pytest.mark.parametrize(
    ("source", "flag", "exit_code", "outcome", "reason"),
    [
        ("import arcpy\n", "--yes", EXIT_PARTIAL, "empty", "no-runnable-steps"),
        ("import arcpy\n", "--dry-run", EXIT_PARTIAL, "empty", "no-runnable-steps"),
        (_KRIGING, "--yes", EXIT_PARTIAL, "unsupported", "unsupported-calls"),
        (_KRIGING, "--acknowledge", EXIT_PARTIAL, "unsupported", "unsupported-calls"),
        (_ERASE, "--yes", EXIT_PARTIAL, "partial", "manual-review-only"),
        (_MIXED, "--yes", EXIT_PARTIAL, "partial", "partial-plan"),
        (_MIXED, "--acknowledge", EXIT_PARTIAL, "partial", "partial-plan"),
        (_MIXED, "--dry-run", EXIT_PARTIAL, "partial", "partial-plan"),
        (_MISSING, "--yes", EXIT_VALIDATION_ERROR, "incomplete", "missing-input"),
        (
            _ALIAS_DISTANCE_ONLY,
            "--yes",
            EXIT_VALIDATION_ERROR,
            "incomplete",
            "missing-input",
        ),
        (_UNRESOLVED, "--yes", EXIT_VALIDATION_ERROR, "incomplete", "unresolved-input"),
        (_DEPENDENCY, "--yes", EXIT_VALIDATION_ERROR, "incomplete", "unsupported-dependency"),
        (_BRANCH, "--yes", EXIT_VALIDATION_ERROR, "unsupported", "unsupported-control-flow"),
        (_LOOP, "--dry-run", EXIT_VALIDATION_ERROR, "unsupported", "unsupported-control-flow"),
        (_FUNCTION, "--yes", EXIT_VALIDATION_ERROR, "unsupported", "unsupported-control-flow"),
        (
            _BRANCH_AND_STRAIGHT,
            "--yes",
            EXIT_VALIDATION_ERROR,
            "unsupported",
            "unsupported-control-flow",
        ),
        (_SYNTAX, "--dry-run", EXIT_BAD_ARGUMENTS, "refused", "syntax-error"),
        (_SYNTAX, "--yes", EXIT_BAD_ARGUMENTS, "refused", "syntax-error"),
    ],
)
def test_refused_plans_do_not_dispatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    source: str,
    flag: str,
    exit_code: int,
    outcome: str,
    reason: str,
) -> None:
    code, payload, processes = _run(tmp_path, source, flag, monkeypatch=monkeypatch)

    assert code == exit_code
    assert code != EXIT_SUCCESS
    _assert_common(payload, mode="dry-run" if flag == "--dry-run" else "execute")
    assert payload["outcome"] == outcome
    assert payload["reason"] == reason
    assert payload["executionSuccess"] is False
    assert payload["submitted"] is False
    assert payload["dispatchCount"] == 0
    assert payload["jobs"] == []
    assert processes.behavior["clients"]["clients"] == 0
    assert processes.posts == []
    if reason == "partial-plan":
        assert "--yes" in payload["guidance"]
        skipped = {item["qualifiedName"] for item in payload["skipped"]}
        assert "arcpy.sa.Kriging" in skipped
    assert reason in capsys.readouterr().err


def test_yes_does_not_change_a_partial_outcome(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dry_code, dry, _processes = _run(
        tmp_path / "dry",
        _MIXED,
        "--dry-run",
        monkeypatch=monkeypatch,
    )
    live_code, live, processes = _run(
        tmp_path / "live",
        _MIXED,
        "--yes",
        monkeypatch=monkeypatch,
    )

    assert dry_code == live_code == EXIT_PARTIAL
    assert dry["reason"] == live["reason"] == "partial-plan"
    assert dry["executionSuccess"] is live["executionSuccess"] is False
    assert processes.posts == []


def test_supported_dry_run_is_not_execution_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _KEYWORD_BUFFER,
        "--dry-run",
        monkeypatch=monkeypatch,
    )

    assert code == EXIT_SUCCESS
    _assert_common(payload, mode="dry-run")
    assert payload["outcome"] == "dry-run"
    assert payload["reason"] == "not-executed"
    assert payload["executionSuccess"] is False
    assert payload["submitted"] is False
    assert payload["dryRun"] is True
    assert [item["processId"] for item in payload["executions"]] == ["buffer"]
    assert processes.behavior["clients"]["clients"] == 0


def test_scan_and_translate_are_not_execution_success(tmp_path: Path) -> None:
    script = tmp_path / "workflow.py"
    script.write_text(_MIXED, encoding="utf-8")
    scan_out = tmp_path / "scan.json"
    plan_out = tmp_path / "plan.json"

    assert main(["code", "python", "scan", str(script), "--output", str(scan_out)]) == 0
    assert main(
        ["code", "python", "translate", str(script), "--output", str(plan_out)]
    ) == 0

    scan = json.loads(scan_out.read_text(encoding="utf-8"))
    plan = json.loads(plan_out.read_text(encoding="utf-8"))
    assert "executionSuccess" not in scan
    assert scan.get("outcome") != "succeeded"
    assert "executionSuccess" not in plan
    assert plan.get("outcome") != "succeeded"


def test_ack_refusal_does_not_dispatch_a_supported_script(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "workflow.py"
    script.write_text(_BUFFER, encoding="utf-8")
    output = tmp_path / "run.json"
    processes = _install_sdk(monkeypatch, {"execute": "plain-job", "job": "successful"})

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
        ]
    )

    assert code == EXIT_SAFETY_REFUSAL
    assert not output.exists()
    assert processes.behavior["clients"]["clients"] == 0
    assert processes.posts == []


def test_synchronous_acceptance_is_not_execution_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "sync-accepted"},
    )

    assert code == EXIT_PARTIAL
    assert payload["outcome"] == "partial"
    assert payload["reason"] == "submission-not-terminal"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert processes.job_calls == []
    assert len(processes.posts) == 1


def test_statusless_output_body_is_not_execution_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "sync-outputs-only"},
    )

    assert code == EXIT_PARTIAL
    assert payload["reason"] == "submission-not-terminal"
    assert payload["executionSuccess"] is False
    assert len(processes.posts) == 1
    assert processes.job_calls == []


def test_synchronous_terminal_success_verifies_outputs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "sync-success"},
    )

    assert code == EXIT_SUCCESS
    _assert_common(payload, mode="execute")
    assert payload["outcome"] == "succeeded"
    assert payload["reason"] == "completed"
    assert payload["executionSuccess"] is True
    assert payload["dispatchCount"] == 1
    assert processes.job_calls == []
    assert payload["outputChecks"] == [
        {
            "name": "result",
            "verified": True,
            "reference": f"{_SERVER}/outputs/buffer",
        }
    ]


def test_successful_job_without_declared_output_is_not_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "plain-job", "job": "successful", "results": "mismatch"},
    )

    assert code == EXIT_PARTIAL
    assert payload["outcome"] == "partial"
    assert payload["reason"] == "output-unverified"
    assert payload["executionSuccess"] is False
    assert [post["processId"] for post in processes.posts] == ["buffer"]
    assert processes.result_calls == ["job-buffer"]
    assert payload["jobs"][0]["jobId"] == "job-buffer"
    assert payload["outputChecks"][0]["verified"] is False
    assert "not resubmitted" in payload["guidance"]


def test_failed_job_preserves_reference_without_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"job": "failed"},
    )

    text = json.dumps(payload)
    assert code == EXIT_REMOTE_ERROR
    assert payload["outcome"] == "failed"
    assert payload["reason"] == "job-failed"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(processes.posts) == 1
    assert processes.result_calls == []
    assert payload["jobs"][0]["jobId"] == "https://jobs.example.test/buffer"
    assert "secret" not in text
    assert "token=" not in text
    assert "not resubmitted" in payload["guidance"]


def test_cancelled_job_preserves_reference_without_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"job": "cancelled"},
    )

    assert code == EXIT_PARTIAL
    assert payload["outcome"] == "cancelled"
    assert payload["reason"] == "job-cancelled"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(processes.posts) == 1
    assert processes.result_calls == []
    assert payload["jobs"][0]["status"] == "cancelled"
    assert payload["jobs"][0]["jobId"] == "https://jobs.example.test/buffer"
    assert "secret" not in json.dumps(payload)


def test_timeout_keeps_one_resumable_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"job": "running"},
    )

    assert code == EXIT_PARTIAL
    assert payload["outcome"] == "timed-out"
    assert payload["reason"] == "job-timed-out"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(processes.posts) == 1
    assert len(processes.job_calls) == _POLL_BOUND
    assert payload["jobs"][0]["jobId"] == "https://jobs.example.test/buffer"
    assert payload["jobs"][0]["status"] == "running"
    assert "secret" not in json.dumps(payload)
    assert payload["jobs"][0]["jobId"] in payload["guidance"]
    assert "not resubmitted" in payload["guidance"]


def test_supported_alias_keywords_are_not_missing_input(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _ALIAS_BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "sync-success"},
    )

    assert code == EXIT_SUCCESS
    assert payload["outcome"] == "succeeded"
    assert payload["reason"] == "completed"
    assert payload["reason"] != "missing-input"
    assert payload["executionSuccess"] is True
    assert len(processes.posts) == 1
    body = processes.posts[0]["payload"]
    assert body["inputs"]["input_features"] == "a"
    assert body["inputs"]["distance"] == "5 Meters"
    assert body["outputs"] == {"result": "result-fc"}


def test_poll_transport_failure_keeps_sanitized_job_id(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"job": "raise"},
    )

    text = json.dumps(payload)
    assert code == EXIT_REMOTE_ERROR
    assert code != EXIT_SUCCESS
    assert payload["outcome"] == "failed"
    assert payload["reason"] == "remote-error"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(processes.posts) == 1
    assert processes.job_calls == ["https://jobs.example.test/buffer?token=secret"]
    assert processes.result_calls == []
    assert payload["jobs"][0]["jobId"] == "https://jobs.example.test/buffer"
    assert payload["jobs"][0]["succeeded"] is False
    assert "secret" not in text
    assert "token=" not in text
    assert payload["jobs"][0]["jobId"] in payload["guidance"]
    assert "not retried" in payload["guidance"]


def test_results_transport_failure_keeps_sanitized_job_id(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"job": "successful", "results": "raise"},
    )

    text = json.dumps(payload)
    assert code == EXIT_REMOTE_ERROR
    assert code != EXIT_SUCCESS
    assert payload["outcome"] == "failed"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(processes.posts) == 1
    assert processes.result_calls == ["https://jobs.example.test/buffer?token=secret"]
    assert payload["jobs"][0]["jobId"] == "https://jobs.example.test/buffer"
    assert payload["jobs"][0]["succeeded"] is False
    assert "secret" not in text
    assert "token=" not in text
    assert "not retried" in payload["guidance"]


def test_transport_failure_is_not_retried(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, payload, processes = _run(
        tmp_path,
        _BUFFER,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "raise"},
    )

    assert code == EXIT_REMOTE_ERROR
    assert payload["outcome"] == "failed"
    assert payload["reason"] == "remote-error"
    assert payload["executionSuccess"] is False
    assert payload["dispatchCount"] == 1
    assert len(processes.posts) == 1
    assert payload["jobs"][0]["jobId"] is None
    assert "not retried" in payload["guidance"]


def test_dependency_chain_succeeds_only_after_every_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, processes = _run(
        tmp_path,
        _CHAIN,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "plain-job", "job": "successful", "results": "verified"},
    )

    assert code == EXIT_SUCCESS
    assert payload["outcome"] == "succeeded"
    assert payload["reason"] == "completed"
    assert payload["executionSuccess"] is True
    assert [post["processId"] for post in processes.posts] == ["buffer", "clip"]
    assert processes.posts[1]["payload"]["inputs"]["input_features"] == "parcels_buffer"
    assert processes.result_calls == ["job-buffer", "job-clip"]
    assert [item["jobId"] for item in payload["jobs"]] == ["job-buffer", "job-clip"]
    assert [item["verified"] for item in payload["outputChecks"]] == [True, True]


def test_chain_does_not_continue_when_an_output_is_unverified(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _quiet_sleep(monkeypatch)
    code, payload, processes = _run(
        tmp_path,
        _CHAIN,
        "--yes",
        monkeypatch=monkeypatch,
        behavior={"execute": "plain-job", "job": "successful", "results": "empty"},
    )

    assert code == EXIT_PARTIAL
    assert payload["reason"] == "output-unverified"
    assert payload["executionSuccess"] is False
    assert [post["processId"] for post in processes.posts] == ["buffer"]


def test_chain_does_not_replay_a_finished_job_when_a_later_job_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"count": 0}

    def execute(process_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        del payload
        calls["count"] += 1
        status = "successful" if process_id == "buffer" else "failed"
        return {"jobID": f"job-{process_id}", "status": status}

    processes = _Processes({"execute": "plain-job", "job": "successful"})
    processes.execute = execute  # type: ignore[method-assign]
    processes.job_results = lambda job_id: {  # type: ignore[method-assign]
        "outputs": {"result": f"{_SERVER}/outputs/{job_id}"}
    }
    script = tmp_path / "workflow.py"
    script.write_text(_CHAIN, encoding="utf-8")
    output = tmp_path / "run.json"

    class Client:
        def __init__(self, server: str) -> None:
            self.server = server

        def __enter__(self) -> Client:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def ogc_processes(self) -> _Processes:
            return processes

    module = types.ModuleType("honua_sdk")
    module.HonuaClient = Client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "honua_sdk", module)

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
    assert payload["executionSuccess"] is False
    assert payload["reason"] == "job-failed"
    assert calls["count"] == 2
    assert [item["jobId"] for item in payload["jobs"]] == ["job-buffer", "job-clip"]
