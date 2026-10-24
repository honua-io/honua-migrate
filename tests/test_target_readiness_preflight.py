"""Target readiness preflight for GeoServices import.

The shipped CLI entry is ``honua_migrate.cli.main``. These tests start from
that entry with no cached readiness and assert the server response, not a
client-side edition name, decides whether an import may be queued.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path

import pytest
import responses

from honua_migrate.cli import main
from honua_migrate.services.arcgis import ArcGisClient
from honua_migrate.services.target_readiness import preflight_target

SOURCE_URL = "https://arcgis.test/rest/services/Parcels/FeatureServer"
API_KEY = "super-secret-api-key"
OTHER_KEY = "other-secret-api-key"
MANIFEST = "https://honua.test/api/v1/capabilities/manifest"
JOBS = "https://honua.test/api/v1/admin/import/geoservices/jobs"
START = "https://honua.test/api/v1/admin/import/geoservices/start"
POISON = (
    API_KEY,
    OTHER_KEY,
    "sig=deadbeef",
    "secret-row",
    "lic-secret",
    "LicensedTo-PRIVATE-PAYLOAD",
)


def _ready_manifest(**overrides: object) -> dict:
    capability_available = overrides.pop("capabilityAvailable", None)
    body: dict = {
        "schemaVersion": "honua.capability_manifest.v1",
        "scope": {"authenticated": True, "tenantId": "tenant-private"},
        "server": {
            "serverVersion": "2026.1.0",
            "apiVersion": "v1",
            "deploymentRevision": "a" * 40,
        },
        "policies": {
            "currentEdition": "Community",
            "licenseValidationState": "Disabled",
            "licenseValid": True,
            "licenseId": "lic-secret",
            "licensedTo": "LicensedTo-PRIVATE-PAYLOAD",
            "entitlements": [
                {
                    "key": "import.geoservices",
                    "active": True,
                    "minimumEdition": "Enterprise",
                    "reasonCode": None,
                }
            ],
        },
        "signedLicenseUrl": "https://files.example/license?sig=deadbeef",
        "features": [{"attributes": {"OWNER": "secret-row"}}],
    }
    for key, value in overrides.items():
        if key in body["policies"] or key in {
            "licenseValidationState",
            "licenseValid",
            "currentEdition",
        }:
            body["policies"][key] = value
        elif key == "active":
            body["policies"]["entitlements"][0]["active"] = value
        elif key == "reasonCode":
            body["policies"]["entitlements"][0]["reasonCode"] = value
        elif key == "authenticated":
            body["scope"]["authenticated"] = value
        else:
            body[key] = value
    if capability_available is not None:
        body["capabilities"] = [
            {
                "id": "import.geoservices",
                "available": capability_available,
                "reasonCode": body["policies"]["entitlements"][0]["reasonCode"],
                "minimumEdition": "Enterprise",
            }
        ]
    return body


def _env(monkeypatch: pytest.MonkeyPatch, **extra: str | None) -> None:
    for name in (
        "HONUA_URL",
        "HONUA_API_KEY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ):
        monkeypatch.delenv(name, raising=False)
    values: dict[str, str | None] = {
        "HONUA_URL": "https://honua.test",
        "HONUA_API_KEY": API_KEY,
    }
    values.update(extra)
    for name, value in values.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)


def _run(args: list[str]) -> int:
    return main(args)


def _report(capsys: pytest.CaptureFixture[str]) -> tuple[dict, str, str]:
    captured = capsys.readouterr()
    report = json.loads(captured.out)
    return report, captured.out, captured.err


def _assert_clean(*chunks: str) -> None:
    combined = "\n".join(chunks)
    for poison in POISON:
        assert poison not in combined


def _assert_get_only() -> None:
    assert responses.calls
    assert all(call.request.method == "GET" for call in responses.calls)
    assert not any(call.request.url.endswith("/start") for call in responses.calls)
    assert all(call.request.method != "POST" for call in responses.calls)


def _stub_jobs(status: int = 200) -> None:
    responses.add(
        responses.GET,
        JOBS,
        json={"jobs": [{"attributes": {"OWNER": "secret-row"}, "serviceUrl": "https://src.example/a?sig=deadbeef"}]},
        status=status,
    )


def _plan(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> Path:
    path = tmp_path / "plan.json"
    code = _run(
        [
            "services",
            "arcgis",
            "plan",
            SOURCE_URL,
            "--layer-id",
            "3",
            "--table-name",
            "parcels",
            "--output",
            str(path),
        ]
    )
    captured = capsys.readouterr()
    assert code == 0, captured.err
    return path


@responses.activate
def test_preflight_command_is_read_only_for_a_licensing_disabled_ready_target(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    responses.add(responses.GET, MANIFEST, json=_ready_manifest(), status=200)
    _stub_jobs()
    output = tmp_path / "preflight.json"
    code = _run(
        ["services", "arcgis", "preflight", "--retries", "0", "--output", str(output)]
    )
    report, out, err = _report(capsys)
    assert code == 0, err
    assert report["outcome"] == "ready"
    assert report["ready"] is True
    assert report["capability"] == "import.geoservices"
    assert report["reason"]["licensing"] == "disabled"
    assert "no license is required" in report["reason"]["message"]
    assert "Enterprise" not in out + err + output.read_text(encoding="utf-8")
    assert report["identity"]["schemaVersion"] == "honua.capability_manifest.v1"
    assert report["identity"]["apiVersion"] == "v1"
    assert report["elapsedSeconds"] >= 0
    _assert_clean(out, err, output.read_text(encoding="utf-8"))
    _assert_get_only()


@responses.activate
def test_enabled_license_outcomes_follow_server_availability_not_edition(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(
            currentEdition="Pro",
            licenseValidationState="Valid",
            licenseValid=True,
            active=True,
        ),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code == 0, err
    assert report["outcome"] == "ready"
    assert report["reason"]["licensing"] == "enabled"
    assert "import.geoservices is available" in report["reason"]["message"]
    assert "Enterprise" not in out + err

    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(
            currentEdition="Enterprise",
            licenseValidationState="Valid",
            licenseValid=True,
            active=False,
            reasonCode="entitlement-inactive",
        ),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unavailable-capability"
    assert report["ready"] is False
    assert report["reason"]["licenseValid"] is True
    assert report["reason"]["serverReasonCode"] == "entitlement-inactive"
    assert "license is valid" in report["reason"]["message"]
    assert "not entitled" in report["reason"]["message"]
    assert "Enterprise" not in out + err
    _assert_clean(out, err)

    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(
            currentEdition="Enterprise",
            licenseValidationState="Expired",
            licenseValid=False,
            active=False,
            reasonCode="license-required",
        ),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unavailable-capability"
    assert report["reason"]["licenseValidationState"] == "Expired"
    assert report["reason"]["licenseValid"] is False
    assert "not valid" in report["reason"]["message"]
    assert "Expired" in report["reason"]["message"]
    assert "license is valid" not in report["reason"]["message"]
    assert "Enterprise" not in out + err
    _assert_get_only()


@responses.activate
def test_capability_declaration_overrides_an_edition_shaped_entitlement(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(
            currentEdition="Community",
            licenseValidationState="Disabled",
            active=True,
            capabilityAvailable=False,
            reasonCode="dependency-unavailable",
        ),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, _out, err = _report(capsys)
    assert code != 0, err
    assert report["outcome"] == "unavailable-capability"
    assert report["reason"]["serverReasonCode"] == "dependency-unavailable"
    assert report["reason"]["licensing"] == "disabled"
    assert "not available" in report["reason"]["message"]


@responses.activate
@pytest.mark.parametrize(
    ("status", "outcome", "snippet"),
    [
        (401, "unauthenticated", "did not authenticate"),
        (403, "forbidden", "refused access"),
    ],
)
def test_manifest_auth_statuses(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    status: int,
    outcome: str,
    snippet: str,
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json={"title": "denied", "status": status, "code": "auth-problem", "detail": API_KEY},
        status=status,
    )
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == outcome
    assert snippet in report["reason"]["message"]
    assert report["reason"]["serverReasonCode"] == "auth-problem"
    _assert_clean(out, err)
    assert len(responses.calls) == 1
    assert responses.calls[0].request.method == "GET"


@responses.activate
def test_unauthenticated_scope_does_not_probe_import_or_start(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(authenticated=False),
        status=200,
    )
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unauthenticated"
    assert "did not authenticate" in report["reason"]["message"]
    _assert_clean(out, err)
    assert [call.request.url for call in responses.calls] == [MANIFEST]


@responses.activate
def test_authenticated_forbidden_on_import_api(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(responses.GET, MANIFEST, json=_ready_manifest(), status=200)
    _stub_jobs(403)
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "forbidden"
    assert "refused access" in report["reason"]["message"]
    _assert_clean(out, err)
    _assert_get_only()


@responses.activate
def test_incompatible_manifest_or_api_version(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(schemaVersion="honua.capability_manifest.v2"),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, _out, err = _report(capsys)
    assert code != 0, err
    assert report["outcome"] == "incompatible-version"
    assert "not compatible" in report["reason"]["message"]

    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(server={"apiVersion": "v2", "serverVersion": "2099.0.0"}),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, _out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "incompatible-version"


@responses.activate
def test_missing_capability_declaration_is_unknown_not_ready(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json={
            "schemaVersion": "honua.capability_manifest.v1",
            "scope": {"authenticated": True},
            "server": {"apiVersion": "v1", "serverVersion": "2026.1.0"},
            "policies": {"licenseValidationState": "Disabled", "licenseValid": True, "entitlements": []},
            "features": [{"attributes": {"OWNER": "secret-row"}}],
        },
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unknown"
    assert "could not be determined" in report["reason"]["message"]
    _assert_clean(out, err)


@responses.activate
def test_payment_required_preserves_problem_code_without_secrets(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json={
            "type": "https://honua.io/problems/admin",
            "title": "Payment Required",
            "status": 402,
            "code": "license-required",
            "detail": f"{API_KEY} https://files.example/license?sig=deadbeef",
            "licenseId": "lic-secret",
        },
        status=402,
    )
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unavailable-capability"
    assert report["reason"]["serverReasonCode"] == "license-required"
    _assert_clean(out, err)
    assert len(responses.calls) == 1


@responses.activate
def test_redirect_is_not_followed(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        status=302,
        headers={"Location": "https://evil.test/collect?sig=deadbeef"},
    )
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unknown"
    assert "could not be determined" in report["reason"]["message"]
    assert len(responses.calls) == 1
    _assert_clean(out, err)


def test_unreachable_closed_port(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    _env(monkeypatch, HONUA_URL=f"http://127.0.0.1:{port}")
    started = time.monotonic()
    code = _run(["services", "arcgis", "preflight", "--retries", "0", "--timeout-seconds", "1"])
    assert time.monotonic() - started < 8
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unreachable"
    assert "could not be reached" in report["reason"]["message"]
    _assert_clean(out, err)


def test_preflight_timeout_is_bounded(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    released = threading.Event()

    def _accept() -> None:
        try:
            conn, _addr = listener.accept()
        except OSError:
            return
        released.wait(5)
        conn.close()

    thread = threading.Thread(target=_accept, daemon=True)
    thread.start()
    _env(monkeypatch, HONUA_URL=f"http://127.0.0.1:{port}")
    started = time.monotonic()
    try:
        code = _run(
            ["services", "arcgis", "preflight", "--retries", "0", "--timeout-seconds", "1"]
        )
    finally:
        released.set()
        listener.close()
        thread.join(timeout=2)
    elapsed = time.monotonic() - started
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unreachable"
    assert report["reason"]["code"] == "timeout"
    assert "timed out" in report["reason"]["message"]
    assert elapsed < 8
    _assert_clean(out, err)


@responses.activate
def test_apply_does_not_queue_when_preflight_is_not_ready(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    plan = _plan(tmp_path, capsys)
    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(
            licenseValidationState="Valid",
            licenseValid=True,
            currentEdition="Enterprise",
            active=False,
            reasonCode="entitlement-inactive",
        ),
        status=200,
    )
    _stub_jobs()
    output = tmp_path / "apply.json"
    code = _run(
        [
            "services",
            "arcgis",
            "apply",
            str(plan),
            "--yes",
            "--retries",
            "0",
            "--output",
            str(output),
        ]
    )
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unavailable-capability"
    assert report["ready"] is False
    _assert_get_only()
    saved = output.read_text(encoding="utf-8")
    assert "jobId" not in saved
    _assert_clean(out, err, saved)


@responses.activate
def test_apply_rechecks_and_refuses_a_capability_that_is_no_longer_ready(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    plan = _plan(tmp_path, capsys)
    seen = {"manifest": 0}

    def manifest(_request: object) -> tuple[int, dict, str]:
        seen["manifest"] += 1
        if seen["manifest"] == 1:
            return 200, {}, json.dumps(_ready_manifest())
        return 200, {}, json.dumps(
            _ready_manifest(
                licenseValidationState="Expired",
                licenseValid=False,
                active=False,
                reasonCode="license-required",
                currentEdition="Enterprise",
            )
        )

    responses.add_callback(responses.GET, MANIFEST, manifest)
    responses.add(responses.GET, JOBS, json={}, status=200)
    responses.add(responses.GET, JOBS, json={}, status=200)
    preflight = _run(["services", "arcgis", "preflight", "--retries", "0"])
    ready, _out, err = _report(capsys)
    assert preflight == 0, err
    assert ready["outcome"] == "ready"

    code = _run(["services", "arcgis", "apply", str(plan), "--yes", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unavailable-capability"
    assert report["reason"]["licenseValidationState"] == "Expired"
    assert not any(call.request.method == "POST" for call in responses.calls)
    _assert_clean(out, err)


@responses.activate
def test_apply_rechecks_a_changed_target_and_principal(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    plan = _plan(tmp_path, capsys)
    responses.add(responses.GET, MANIFEST, json=_ready_manifest(), status=200)
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    ready, _out, err = _report(capsys)
    assert code == 0, err
    assert ready["outcome"] == "ready"
    assert ready["identity"]["target"] == "https://honua.test"

    other_manifest = "https://other.test/api/v1/capabilities/manifest"
    responses.add(
        responses.GET,
        other_manifest,
        json=_ready_manifest(authenticated=False),
        status=200,
    )
    _env(monkeypatch, HONUA_URL="https://other.test", HONUA_API_KEY=OTHER_KEY)
    code = _run(["services", "arcgis", "apply", str(plan), "--yes", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unauthenticated"
    assert report["identity"]["target"] == "https://other.test"
    assert not any(call.request.method == "POST" for call in responses.calls)
    assert not any(call.request.url == START for call in responses.calls)
    _assert_clean(out, err)


@responses.activate
def test_apply_refuses_when_permission_or_schema_changes(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    plan = _plan(tmp_path, capsys)
    jobs_seen = {"n": 0}

    def jobs(_request: object) -> tuple[int, dict, str]:
        jobs_seen["n"] += 1
        if jobs_seen["n"] == 1:
            return 200, {}, "{}"
        return 403, {}, json.dumps({"title": "Forbidden", "status": 403, "code": "insufficient-policy"})

    responses.add(responses.GET, MANIFEST, json=_ready_manifest(), status=200)
    responses.add_callback(responses.GET, JOBS, jobs)
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    ready, _out, err = _report(capsys)
    assert code == 0, err
    assert ready["outcome"] == "ready"

    code = _run(["services", "arcgis", "apply", str(plan), "--yes", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "forbidden"
    assert not any(call.request.method == "POST" for call in responses.calls)
    _assert_clean(out, err)

    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(schemaVersion="honua.capability_manifest.v9"),
        status=200,
    )
    responses.add(responses.GET, JOBS, json={}, status=200)
    code = _run(["services", "arcgis", "apply", str(plan), "--yes", "--retries", "0"])
    report, _out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "incompatible-version"
    assert not any(call.request.method == "POST" for call in responses.calls)


@responses.activate
def test_apply_queues_only_after_a_fresh_ready_recheck(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    plan = _plan(tmp_path, capsys)
    first = _ready_manifest()
    second = _ready_manifest()
    second["server"] = {
        "serverVersion": "2026.1.1",
        "apiVersion": "v1",
        "deploymentRevision": "b" * 40,
    }
    responses.add(responses.GET, MANIFEST, json=first, status=200)
    responses.add(responses.GET, MANIFEST, json=second, status=200)
    _stub_jobs()
    _stub_jobs()
    responses.add(responses.POST, START, json={"jobId": "job-1"}, status=202)
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    ready, _out, err = _report(capsys)
    assert code == 0, err
    assert ready["identity"]["deploymentRevision"] == "a" * 40

    output = tmp_path / "apply.json"
    code = _run(
        [
            "services",
            "arcgis",
            "apply",
            str(plan),
            "--yes",
            "--retries",
            "0",
            "--output",
            str(output),
        ]
    )
    captured = capsys.readouterr()
    assert code == 0, captured.err
    artifact = json.loads(output.read_text(encoding="utf-8"))
    assert artifact["kind"] == "apply"
    assert artifact["preflight"]["outcome"] == "ready"
    assert artifact["preflight"]["identity"]["deploymentRevision"] == "b" * 40
    posts = [call for call in responses.calls if call.request.method == "POST"]
    assert len(posts) == 1
    assert posts[0].request.url == START
    _assert_clean(captured.out, captured.err, output.read_text(encoding="utf-8"))


@responses.activate
def test_disabled_but_inactive_capability_is_not_treated_as_ready(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _env(monkeypatch)
    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(active=False, reasonCode="disabled-by-configuration"),
        status=200,
    )
    _stub_jobs()
    code = _run(["services", "arcgis", "preflight", "--retries", "0"])
    report, out, err = _report(capsys)
    assert code != 0
    assert report["outcome"] == "unavailable-capability"
    assert report["reason"]["licensing"] == "disabled"
    assert "licensing disabled" in report["reason"]["message"].lower() or "licensing is disabled" in report["reason"]["message"]
    assert "not available" in report["reason"]["message"]
    assert "Enterprise" not in out + err
    _assert_clean(out, err)


def _client() -> ArcGisClient:
    client = ArcGisClient("https://honua.test", API_KEY, 30, 0)

    def _start(_request: object) -> dict:
        raise AssertionError("client.start must not run during readiness")

    client.start = _start  # type: ignore[method-assign]
    return client


@responses.activate
def test_invalid_license_is_not_ready_while_entitlement_stays_active(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    _env(monkeypatch)
    plan = _plan(tmp_path, capsys)
    expired = _ready_manifest(
        currentEdition="Enterprise",
        licenseValidationState="Expired",
        licenseValid=False,
        active=True,
    )
    responses.add(responses.GET, MANIFEST, json=expired, status=200)
    _stub_jobs()
    report = preflight_target(_client())
    assert report["ready"] is False
    assert report["outcome"] == "unavailable-capability"
    assert report["reason"]["licensing"] == "enabled"
    assert report["reason"]["licenseValid"] is False
    assert report["reason"]["licenseValidationState"] == "Expired"
    assert report["reason"]["capabilityDeclared"] is True
    assert "not valid" in report["reason"]["message"]
    assert "Expired" in report["reason"]["message"]

    responses.add(responses.GET, MANIFEST, json=expired, status=200)
    _stub_jobs()
    output = tmp_path / "apply.json"
    code = _run(
        [
            "services",
            "arcgis",
            "apply",
            str(plan),
            "--yes",
            "--retries",
            "0",
            "--output",
            str(output),
        ]
    )
    applied, out, err = _report(capsys)
    assert code != 0
    assert applied["ready"] is False
    assert applied["outcome"] == "unavailable-capability"
    assert applied["reason"]["licenseValid"] is False
    saved = output.read_text(encoding="utf-8")
    assert "jobId" not in saved
    assert not any(call.request.method == "POST" for call in responses.calls)
    assert not any(call.request.url == START for call in responses.calls)
    _assert_clean(out, err, saved)

    responses.add(
        responses.GET,
        MANIFEST,
        json=_ready_manifest(
            currentEdition="Enterprise",
            licenseValidationState="Disabled",
            licenseValid=False,
            active=True,
        ),
        status=200,
    )
    _stub_jobs()
    disabled = preflight_target(_client())
    assert disabled["ready"] is True
    assert disabled["outcome"] == "ready"
    assert disabled["reason"]["licensing"] == "disabled"
    assert disabled["reason"]["licenseValid"] is False
    assert "no license is required" in disabled["reason"]["message"]
    _assert_get_only()
