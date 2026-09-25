import json
from pathlib import Path

import click
import pytest
import responses
from typer.testing import CliRunner

from honua_migrate.services.arcgis import (
    API_PREFIX,
    ArcGisClient,
    ArcGisMigrationError,
    _validate_secret_reference,
    arcgis_app,
)


runner = CliRunner()
HONUA_ENV = {"HONUA_URL": "https://honua.test", "HONUA_API_KEY": "key"}
SOURCE_URL = "https://arcgis.test/rest/services/Parcels/FeatureServer"


def _invoke(args: list[str], *, env: dict[str, str] | None = None):
    return runner.invoke(arcgis_app, args, env=env, color=False)


def _plain(result) -> str:
    return click.unstyle(result.output)


def _plan(path: Path, *extra: str):
    return _invoke(
        [
            "plan",
            SOURCE_URL,
            "--layer-id",
            "7",
            "--table-name",
            "parcels",
            "--output",
            str(path),
            *extra,
        ]
    )


@responses.activate
def test_discover_is_read_only_does_not_retry_and_redacts_credentials(tmp_path):
    responses.add(
        responses.POST,
        f"https://honua.test{API_PREFIX}/discover",
        json={"layers": []},
        status=503,
    )
    artifact = tmp_path / "discover.json"
    result = _invoke(
        [
            "discover",
            SOURCE_URL,
            "--token-secret-ref",
            "env:SOURCE_SECRET",
            "--output",
            str(artifact),
        ],
        env=HONUA_ENV,
    )
    assert result.exit_code != 0
    assert len(responses.calls) == 1
    assert "SOURCE_SECRET" not in _plain(result)


@responses.activate
def test_apply_injects_runtime_credential_and_round_trips_optional_fields(tmp_path):
    plan = tmp_path / "plan.json"
    plan_result = _plan(
        plan,
        "--target-schema",
        "cadastre",
        "--target-srid",
        "3857",
        "--overwrite-existing",
        "--batch-size",
        "250",
        "--max-retries",
        "5",
        "--request-timeout-seconds",
        "90",
        "--no-auto-publish",
        "--service-name",
        "land-records",
        "--where-clause",
        "STATUS = 'active'",
        "--output-fields",
        "OBJECTID",
        "--output-fields",
        "SHAPE",
    )
    assert plan_result.exit_code == 0, plan_result.output
    plan_artifact = json.loads(plan.read_text(encoding="utf-8"))
    expected_plan_id = plan_artifact["id"]
    assert expected_plan_id.startswith("arcgis-plan-")
    assert plan_artifact["contract_version"] == "v1"
    assert plan_artifact["service"] == "arcgis"
    assert plan_artifact["safety_mode"] == "plan"
    assert plan_artifact["actions"][0]["kind"] == "arcgis-service-import"
    assert "SOURCE_SECRET" not in plan.read_text(encoding="utf-8")

    responses.add(
        responses.POST,
        f"https://honua.test{API_PREFIX}/start",
        json={
            "jobId": "job-1",
            "credentials": {"accessTokenSecretReference": "env:SOURCE_SECRET"},
        },
        status=202,
    )
    output = tmp_path / "apply.json"
    apply_result = _invoke(
        [
            "apply",
            str(plan),
            "--yes",
            "--token-secret-ref",
            "env:SOURCE_SECRET",
            "--output",
            str(output),
        ],
        env=HONUA_ENV,
    )
    assert apply_result.exit_code == 0, apply_result.output

    sent = json.loads(responses.calls[0].request.body)
    assert sent == {
        "serviceUrl": SOURCE_URL,
        "layerId": 7,
        "tableName": "parcels",
        "targetSchema": "cadastre",
        "targetSrid": 3857,
        "overwriteExisting": True,
        "batchSize": 250,
        "maxRetries": 5,
        "requestTimeoutSeconds": 90,
        "autoPublish": False,
        "serviceName": "land-records",
        "whereClause": "STATUS = 'active'",
        "outputFields": ["OBJECTID", "SHAPE"],
        "credentials": {
            "mode": "token",
            "accessTokenSecretReference": "env:SOURCE_SECRET",
        },
    }
    assert "SOURCE_SECRET" not in plan.read_text(encoding="utf-8")
    assert "SOURCE_SECRET" not in output.read_text(encoding="utf-8")
    assert "SOURCE_SECRET" not in _plain(apply_result)
    output_artifact = json.loads(output.read_text(encoding="utf-8"))
    assert output_artifact["planId"] == expected_plan_id
    assert "credentials" not in output_artifact["response"]


@responses.activate
def test_relationships_file_plans_the_related_table_and_apply_omits_evidence(tmp_path):
    catalog = tmp_path / "relationships.json"
    catalog.write_text(
        json.dumps(
            {
                "service": {
                    "layers": [{"id": 0, "name": "Hexes"}],
                    "tables": [{"id": 1, "name": "Aggregated Group By"}],
                },
                "layers": {
                    "0": {
                        "relationships": [
                            {
                                "id": 0,
                                "name": "groupBySummary",
                                "relatedTableId": 1,
                                "cardinality": "esriRelCardinalityOneToMany",
                                "role": "esriRelRoleOrigin",
                                "keyField": "Join_ID",
                            }
                        ]
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "plan.json"
    result = _invoke(
        [
            "plan",
            SOURCE_URL,
            "--layer-id",
            "0",
            "--table-name",
            "hexes",
            "--no-auto-publish",
            "--service-name",
            "cities",
            "--relationships-file",
            str(catalog),
            "--output",
            str(plan),
        ]
    )
    assert result.exit_code == 0, result.output
    artifact = json.loads(plan.read_text(encoding="utf-8"))
    actions = artifact["actions"]
    assert [action["request"]["layerId"] for action in actions] == [0, 1]
    relationship = actions[0]["request"]["relationships"][0]
    assert relationship["keyField"] == "Join_ID"
    assert relationship["destinationLayerId"] == 1
    assert relationship["cardinality"] == "esriRelCardinalityOneToMany"
    assert actions[1]["request"]["tableName"] == "aggregated_group_by"
    assert actions[1]["request"]["serviceName"] == "cities-rel-1"
    assert "relationships" not in actions[1]["request"]

    responses.add(responses.POST, f"https://honua.test{API_PREFIX}/start", json={"jobId": "job-a"}, status=202)
    responses.add(responses.POST, f"https://honua.test{API_PREFIX}/start", json={"jobId": "job-b"}, status=202)
    apply_result = _invoke(["apply", str(plan), "--yes"], env=HONUA_ENV)
    assert apply_result.exit_code == 0, apply_result.output
    sent = [json.loads(call.request.body) for call in responses.calls]
    assert [item["layerId"] for item in sent] == [0, 1]
    assert all("relationships" not in item for item in sent)


@responses.activate
def test_apply_refuses_existing_output_before_network(tmp_path):
    plan = tmp_path / "plan.json"
    assert _plan(plan).exit_code == 0
    output = tmp_path / "apply.json"
    output.write_text("keep", encoding="utf-8")

    result = _invoke(
        ["apply", str(plan), "--yes", "--output", str(output)],
        env=HONUA_ENV,
    )

    assert result.exit_code != 0
    assert "--force" in _plain(result)
    assert output.read_text(encoding="utf-8") == "keep"
    assert not responses.calls


@responses.activate
def test_apply_rejects_tampered_and_legacy_plans_before_network(tmp_path):
    tampered = tmp_path / "tampered.json"
    assert _plan(tampered).exit_code == 0
    artifact = json.loads(tampered.read_text(encoding="utf-8"))
    artifact["actions"][0]["request"]["tableName"] = "unreviewed_table"
    tampered.write_text(json.dumps(artifact), encoding="utf-8")

    result = _invoke(["apply", str(tampered), "--yes"], env=HONUA_ENV)
    assert result.exit_code != 0
    assert "modified after it was reviewed" in _plain(result)
    assert not responses.calls

    legacy = tmp_path / "legacy.json"
    artifact.pop("id")
    legacy.write_text(json.dumps(artifact), encoding="utf-8")
    result = _invoke(["apply", str(legacy), "--yes"], env=HONUA_ENV)
    assert result.exit_code != 0
    assert "immutable plan ID" in _plain(result)
    assert not responses.calls


@responses.activate
def test_apply_rejects_plaintext_credential_without_echoing_it(tmp_path):
    plan = tmp_path / "plan.json"
    assert _plan(plan).exit_code == 0
    plaintext = "eyJhbGciOiJIUzI1NiJ9.raw-token"
    result = _invoke(
        ["apply", str(plan), "--yes", "--token-secret-ref", plaintext],
        env=HONUA_ENV,
    )
    assert result.exit_code != 0
    assert "provider secret reference" in _plain(result)
    assert plaintext not in _plain(result)
    assert not responses.calls


def test_accepts_environment_and_provider_credential_references():
    assert _validate_secret_reference("env:ARCGIS_TOKEN") == "env:ARCGIS_TOKEN"
    assert _validate_secret_reference("vault:gis/arcgis-token") == "vault:gis/arcgis-token"


def test_artifacts_require_force_to_overwrite(tmp_path):
    plan = tmp_path / "plan.json"
    first = _plan(plan)
    assert first.exit_code == 0, first.output
    original = plan.read_text(encoding="utf-8")

    refused = _plan(plan, "--target-srid", "3857")
    assert refused.exit_code != 0
    assert "--force" in _plain(refused)
    assert plan.read_text(encoding="utf-8") == original

    replaced = _plan(plan, "--target-srid", "3857", "--force")
    assert replaced.exit_code == 0, replaced.output
    artifact = json.loads(plan.read_text(encoding="utf-8"))
    assert artifact["actions"][0]["request"]["targetSrid"] == 3857


def test_mutations_require_acknowledgement_before_files_env_or_ids(monkeypatch, tmp_path):
    monkeypatch.delenv("HONUA_URL", raising=False)
    monkeypatch.delenv("HONUA_API_KEY", raising=False)

    apply_result = _invoke(["apply", str(tmp_path / "missing.json")])
    assert apply_result.exit_code != 0
    assert "Re-run with --yes" in _plain(apply_result)
    assert "Could not read plan" not in _plain(apply_result)
    assert "HONUA_URL" not in _plain(apply_result)

    cancel_result = _invoke(["cancel", "../unsafe"])
    assert cancel_result.exit_code != 0
    assert "Re-run with --yes" in _plain(cancel_result)
    assert "Job ID" not in _plain(cancel_result)
    assert "HONUA_URL" not in _plain(cancel_result)


@responses.activate
def test_get_retries_but_mutations_do_not_retry():
    client = ArcGisClient("https://honua.test", "key", retries=1, sleeper=lambda _: None)
    responses.add(
        responses.POST,
        f"https://honua.test{API_PREFIX}/start",
        status=503,
        json={"message": "busy"},
    )
    with pytest.raises(ArcGisMigrationError):
        client.start({"serviceUrl": SOURCE_URL, "layerId": 0, "tableName": "p"})
    assert len(responses.calls) == 1

    responses.add(
        responses.POST,
        f"https://honua.test{API_PREFIX}/jobs/a1/cancel",
        status=503,
        json={"message": "busy"},
    )
    with pytest.raises(ArcGisMigrationError):
        client.cancel("a1")
    assert len(responses.calls) == 2

    responses.add(
        responses.GET,
        f"https://honua.test{API_PREFIX}/jobs/a1",
        status=503,
        json={},
    )
    responses.add(
        responses.GET,
        f"https://honua.test{API_PREFIX}/jobs/a1",
        status=200,
        json={"status": "Queued"},
    )
    assert client.status("a1")["status"] == "Queued"


@responses.activate
def test_resume_waits_for_existing_job_with_get_only_polling(tmp_path):
    job_url = f"https://honua.test{API_PREFIX}/jobs/a1"
    responses.add(responses.GET, job_url, status=200, json={"status": "Processing"})
    responses.add(responses.GET, job_url, status=200, json={"status": "Completed"})
    output = tmp_path / "resume.json"

    result = _invoke(
        [
            "resume",
            "a1",
            "--poll-interval",
            "0.1",
            "--max-wait",
            "0.2",
            "--output",
            str(output),
        ],
        env=HONUA_ENV,
    )
    assert result.exit_code == 0, result.output
    assert [call.request.method for call in responses.calls] == ["GET", "GET"]
    response = json.loads(output.read_text(encoding="utf-8"))["response"]
    assert response["terminal"] is True
    assert response["timedOut"] is False
    assert response["pollCount"] == 2
    assert response["status"]["status"] == "Completed"


@responses.activate
def test_resume_is_bounded_and_reports_nonterminal_timeout(tmp_path):
    job_url = f"https://honua.test{API_PREFIX}/jobs/a1"
    responses.add(responses.GET, job_url, status=200, json={"status": "Processing"})
    output = tmp_path / "resume-timeout.json"

    result = _invoke(
        [
            "resume",
            "a1",
            "--poll-interval",
            "10",
            "--max-wait",
            "0",
            "--output",
            str(output),
        ],
        env=HONUA_ENV,
    )
    assert result.exit_code == 10, result.output
    assert len(responses.calls) == 1
    assert responses.calls[0].request.method == "GET"
    response = json.loads(output.read_text(encoding="utf-8"))["response"]
    assert response["terminal"] is False
    assert response["timedOut"] is True
    assert response["pollCount"] == 1


@responses.activate
def test_server_error_body_is_never_exposed():
    responses.add(
        responses.GET,
        f"https://honua.test{API_PREFIX}/jobs/a1",
        status=400,
        json={
            "message": "request contained env:SOURCE_SECRET",
            "details": {"password": "raw-password"},
        },
    )
    result = _invoke(["status", "a1"], env=HONUA_ENV)
    assert result.exit_code != 0
    assert "HTTP 400" in _plain(result)
    assert "SOURCE_SECRET" not in _plain(result)
    assert "raw-password" not in _plain(result)
    assert "request contained" not in _plain(result)


@pytest.mark.parametrize(
    "url",
    [
        "https://user:secret@honua.test",
        "https://honua.test?token=secret",
        "https://honua.test/#fragment",
        "https://honua.test/%0aHeader:value",
        "https://honua.test\\@evil.test",
        "http:///missing-host",
        "file:///tmp/socket",
    ],
)
def test_refuses_malformed_or_unsafe_urls(url):
    with pytest.raises(ArcGisMigrationError):
        ArcGisClient.from_options(url, "key", 30, 2)


@pytest.mark.parametrize("job_id", ["../secrets", "a/b", "https://evil.test", "a?token=x", ""])
def test_refuses_unsafe_job_ids_before_environment_resolution(monkeypatch, job_id):
    monkeypatch.delenv("HONUA_URL", raising=False)
    monkeypatch.delenv("HONUA_API_KEY", raising=False)
    result = _invoke(["status", job_id])
    assert result.exit_code != 0
    assert "Job ID" in _plain(result) or "Missing argument" in _plain(result)
    assert "HONUA_URL" not in _plain(result)


@pytest.mark.parametrize("status,verdict,exit_code,outcome", [
    (8, "full-fidelity", 0, "completed"),
    (9, "incomplete", 10, "needs-review"),
    (10, None, 10, "failed"),
    (11, None, 10, "cancelled"),
    ("NeedsReview", "incomplete", 10, "needs-review"),
    ("needs-review", "incomplete", 10, "needs-review"),
    ("Cancelled", None, 10, "cancelled"),
    ("Canceled", None, 10, "cancelled"),
    ("Completed", "incomplete", 10, "needs-review"),
    ("Completed", None, 0, "completed"),
    (99, None, 10, "unknown-status"),
    (True, None, 10, "unknown-status"),
    ("FutureState", None, 10, "unknown-status"),
])
@responses.activate
def test_resume_preserves_terminal_and_fidelity_outcomes(tmp_path, status, verdict, exit_code, outcome):
    payload = {"status": status, "fidelityFindings": [{"code": "catalog.spatial.srid-mismatch"}],
               "apiKey": "must-not-be-exported"}
    if verdict is not None:
        payload["fidelityVerdict"] = verdict
    responses.add(responses.GET, f"https://honua.test{API_PREFIX}/jobs/a1", json=payload)
    output = tmp_path / "outcome.json"
    result = _invoke(["resume", "a1", "--max-wait", "30", "--output", str(output)], env=HONUA_ENV)
    assert result.exit_code == exit_code, result.output
    assert len(responses.calls) == 1
    receipt = json.loads(output.read_text())["response"]
    assert receipt["outcome"] == outcome
    assert receipt["successful"] is (exit_code == 0)
    assert receipt["fidelityVerified"] is (exit_code == 0 and verdict == "full-fidelity")
    assert receipt["timedOut"] is False
    assert receipt["status"]["status"] == status
    assert receipt["status"]["fidelityFindings"] == payload["fidelityFindings"]
    assert "must-not-be-exported" not in output.read_text() + result.output


class _FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


@responses.activate
def test_resume_deadline_includes_request_latency_and_clamps_poll_sleep():
    clock = _FakeClock()

    def slow_status(_request):
        clock.now += 0.8
        return 200, {}, json.dumps({"status": 2})  # retrieving, not generic file-import Completed

    responses.add_callback(responses.GET, f"https://honua.test{API_PREFIX}/jobs/a1", slow_status)
    client = ArcGisClient("https://honua.test", "key", clock=clock, sleeper=clock.sleep)
    result = client.wait_for_terminal("a1", poll_interval_seconds=0.5, max_wait_seconds=1)
    assert result["outcome"] == "timed-out"
    assert result["successful"] is False
    assert result["normalizedStatus"] == "retrieving-features"
    assert result["pollCount"] == 1
    assert result["elapsedSeconds"] == pytest.approx(1)
    assert clock.sleeps == [pytest.approx(0.2)]
    assert len(responses.calls) == 1


@responses.activate
def test_resume_retry_backoff_cannot_extend_deadline():
    clock = _FakeClock()

    def unavailable(_request):
        clock.now += 0.9
        return 503, {}, "{}"

    responses.add_callback(responses.GET, f"https://honua.test{API_PREFIX}/jobs/a1", unavailable)
    client = ArcGisClient("https://honua.test", "key", retries=5, clock=clock, sleeper=clock.sleep)
    result = client.wait_for_terminal("a1", poll_interval_seconds=0.5, max_wait_seconds=1)
    assert result["outcome"] == "timed-out"
    assert result["elapsedSeconds"] == pytest.approx(1)
    assert len(responses.calls) == 1
    assert clock.sleeps == [pytest.approx(0.1)]


def test_resume_passes_remaining_deadline_to_network_timeout():
    clock = _FakeClock()
    timeouts = []

    class Session:
        def request(self, *args, **kwargs):
            import requests
            timeouts.append(kwargs["timeout"].total)
            clock.now += 2
            raise requests.Timeout()

    client = ArcGisClient("https://honua.test", "key", timeout_seconds=30,
                         clock=clock, sleeper=clock.sleep, session=Session())
    result = client.wait_for_terminal("a1", poll_interval_seconds=0.5, max_wait_seconds=2)
    assert timeouts == [2]
    assert result["outcome"] == "timed-out"
    assert result["pollCount"] == 1
