from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from honua_migrate import plan_digest
from honua_migrate.runs.reconciliation import reconcile_run
from honua_migrate.services.geoserver import geoserver_app

runner = CliRunner()


def _plan_with_apply_plan() -> dict[str, Any]:
    apply_plan = {
        "sourceKind": "geoserver-rest",
        "planFingerprint": "sha256:" + "a" * 64,
        "source": {
            "displayName": "Demo GeoServer",
            "baseUrl": "https://geoserver.test/rest",
            "product": "GeoServer",
            "version": "2.26.0",
        },
        "steps": [
            {
                "stepId": "resource:layer:demo:observations",
                "sourceId": "layer:demo:observations",
                "kind": "layer",
                "disposition": "ready",
                "targetServiceName": "demo-geoserver",
                "targetResourceName": "observations",
                "styleIds": ["style:demo:obs_style"],
            },
            {
                "stepId": "style:style:demo:obs_style",
                "sourceId": "style:demo:obs_style",
                "kind": "style",
                "disposition": "ready",
                "targetResourceName": None,
                "targetServiceName": None,
                "styleIds": [],
            },
        ],
        "manualReviewItems": [],
        "unsupportedItems": [],
    }
    request = {
        "geoServerRestUrl": "https://geoserver.test/rest",
        "dryRun": True,
        "applyMode": False,
        "requestTimeoutSeconds": 120,
        "maxRetries": 3,
    }
    payload: dict[str, Any] = {
        "contract_version": "v1",
        "id": "geoserver-plan-job-1",
        "service": "geoserver",
        "safety_mode": "plan",
        "actions": [
            {
                "kind": "geoserver-import",
                "request": request,
                "dry_run_job": {
                    "jobId": "job-1",
                    "status": "completed",
                    "completedAt": "2026-07-22T20:00:00Z",
                },
                "result": {
                    "failedResources": 0,
                    "applyPlan": apply_plan,
                },
            }
        ],
    }
    payload["plan_digest"] = plan_digest(payload)
    return payload


def _completed_apply_job(*, include_style_applied: bool = True) -> dict[str, Any]:
    step_results: list[dict[str, Any]] = [
        {
            "stepId": "resource:layer:demo:observations",
            "sourceId": "layer:demo:observations",
            "kind": "layer",
            "outcome": "applied",
            "targetServiceName": "demo-geoserver",
            "targetResourceName": "observations",
            "honuaLayerId": 100,
        }
    ]
    if include_style_applied:
        step_results.append(
            {
                "stepId": "style:style:demo:obs_style",
                "sourceId": "style:demo:obs_style",
                "kind": "style",
                "outcome": "applied",
                "targetResourceName": None,
                "targetServiceName": None,
            }
        )
    return {
        "jobId": "apply-job-9",
        "status": "completed",
        "completedAt": "2026-07-22T20:05:00Z",
        "geoServerUrl": "https://geoserver.test/rest",
        "progress": {
            "applyPlan": _plan_with_apply_plan()["actions"][0]["result"]["applyPlan"],
            "applyExecution": {
                "stepResults": step_results,
            },
        },
    }


def test_apply_with_reconcile_bundle_dir_emits_run_and_snapshots_that_reconcile_matched(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(_plan_with_apply_plan()), encoding="utf-8")
    bundle_dir = tmp_path / "bundle"
    reconcile_out = tmp_path / "reconciliation.json"

    class FakeClient:
        def status(self, job_id: str) -> dict[str, Any]:
            assert job_id == "job-1"
            return {
                "jobId": "job-1",
                "status": "completed",
                "completedAt": "2026-07-22T20:00:00Z",
                "geoServerUrl": "https://geoserver.test/rest",
                "progress": {},
            }

        def start(self, request: dict[str, Any]) -> dict[str, Any]:
            assert request["applyMode"] is True
            assert request["dryRun"] is False
            return {"jobId": "apply-job-9", "message": "started"}

        def wait_for_terminal(self, job_id: str, **kwargs: Any) -> dict[str, Any]:
            assert job_id == "apply-job-9"
            return _completed_apply_job(include_style_applied=True)

    monkeypatch.setattr("honua_migrate.services.geoserver._client", lambda *a, **k: FakeClient())

    result = runner.invoke(
        geoserver_app,
        [
            "apply",
            "--honua-url",
            "https://honua.test",
            "--honua-api-key-ref",
            "env:HONUA_KEY",
            "--plan",
            str(plan_path),
            "--geoserver-password-ref",
            "env:GEOSERVER_PASSWORD",
            "--acknowledge-apply",
            "--reconcile-bundle-dir",
            str(bundle_dir),
        ],
    )

    assert result.exit_code == 0, result.output
    run_path = bundle_dir / "run.json"
    source_path = bundle_dir / "source-snapshot.json"
    target_path = bundle_dir / "target-snapshot.json"
    assert run_path.exists()
    assert source_path.exists()
    assert target_path.exists()

    reconciled = reconcile_run(run_path, source_path, target_path, reconcile_out)
    assert reconciled["status"] == "matched"
    assert reconciled["run_id"] == "geoserver-run-apply-job-9"


def test_apply_reconcile_bundle_detects_missing_target_step_as_mismatched(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(_plan_with_apply_plan()), encoding="utf-8")
    bundle_dir = tmp_path / "bundle-mismatch"
    reconcile_out = tmp_path / "reconciliation-mismatch.json"

    class FakeClient:
        def status(self, job_id: str) -> dict[str, Any]:
            return {
                "jobId": "job-1",
                "status": "completed",
                "completedAt": "2026-07-22T20:00:00Z",
                "geoServerUrl": "https://geoserver.test/rest",
                "progress": {},
            }

        def start(self, request: dict[str, Any]) -> dict[str, Any]:
            return {"jobId": "apply-job-9", "message": "started"}

        def wait_for_terminal(self, job_id: str, **kwargs: Any) -> dict[str, Any]:
            return _completed_apply_job(include_style_applied=False)

    monkeypatch.setattr("honua_migrate.services.geoserver._client", lambda *a, **k: FakeClient())

    result = runner.invoke(
        geoserver_app,
        [
            "apply",
            "--honua-url",
            "https://honua.test",
            "--honua-api-key-ref",
            "env:HONUA_KEY",
            "--plan",
            str(plan_path),
            "--geoserver-password-ref",
            "env:GEOSERVER_PASSWORD",
            "--acknowledge-apply",
            "--reconcile-bundle-dir",
            str(bundle_dir),
        ],
    )

    assert result.exit_code == 0, result.output
    reconciled = reconcile_run(
        bundle_dir / "run.json",
        bundle_dir / "source-snapshot.json",
        bundle_dir / "target-snapshot.json",
        reconcile_out,
    )
    assert reconciled["status"] == "mismatched"
