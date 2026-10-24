"""Read-only Honua target readiness for GeoServices import.

The server capability manifest is authoritative. This client does not infer a
product tier, upload a license, or call an import mutation. A deployment with
licensing disabled (``Licensing:Mode=Disabled``) reports validation state
``Disabled`` and may declare ``import.geoservices`` available without a signed
license; that declaration is ready. When licensing is enabled, license validity
and feature entitlement stay distinct and both come from the server.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests

from honua_migrate import __version__
from honua_migrate.contracts import (
    EXIT_APPLY_REFUSED,
    EXIT_REMOTE_ERROR,
    EXIT_SUCCESS,
    EXIT_UNAVAILABLE,
    MigrationError,
)

CAPABILITY_ID = "import.geoservices"
MANIFEST_PATH = "/api/v1/capabilities/manifest"
IMPORT_JOBS_PATH = "/api/v1/admin/import/geoservices/jobs"
MANIFEST_SCHEMA = "honua.capability_manifest.v1"
API_VERSION = "v1"
READINESS_CONTRACT = "honua.target-readiness/v1"
_RETRYABLE = {429, 502, 503, 504}
_REDIRECTS = {301, 302, 303, 307, 308}
_MAX_BODY_BYTES = 1_000_000
_CODE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,80}")
_REVISION = re.compile(r"(?:[0-9a-fA-F]{40}|sha256:[0-9a-fA-F]{64})")
_TOKEN = re.compile(r"[0-9A-Za-z][0-9A-Za-z._+-]{0,40}")
_SCHEMA = re.compile(r"honua\.capability_manifest\.v[0-9]{1,4}")
_STATE = re.compile(r"[A-Za-z][A-Za-z0-9]{0,40}")

_EXIT = {
    "ready": EXIT_SUCCESS,
    "unreachable": EXIT_REMOTE_ERROR,
    "unauthenticated": EXIT_APPLY_REFUSED,
    "forbidden": EXIT_APPLY_REFUSED,
    "incompatible-version": EXIT_UNAVAILABLE,
    "unavailable-capability": EXIT_APPLY_REFUSED,
    "unknown": EXIT_UNAVAILABLE,
}


class TargetReadinessError(MigrationError):
    """Preflight did not report ready. Callers must not start an import."""


def preflight_target(client: Any) -> dict[str, Any]:
    """GET the capability manifest and confirm import permission. Never mutates."""

    started = client.clock()
    kind, status, body = _get(client, MANIFEST_PATH)
    if kind == "timeout":
        return _report(
            client,
            started,
            "unreachable",
            code="timeout",
            message=(
                "The target timed out before a readiness response. Check HONUA_URL "
                "and retry with a larger --timeout-seconds. No import was started."
            ),
            http_status=status,
        )
    if kind != "response":
        return _report(
            client,
            started,
            "unreachable",
            code="unreachable",
            message=(
                "The target could not be reached before the timeout. Check HONUA_URL, "
                "DNS, and that the server is running. No import was started."
            ),
            http_status=status,
        )
    return _from_manifest(client, started, status, body)


def _get(client: Any, path: str) -> tuple[str, int | None, Any]:
    attempts = max(0, int(client.retries)) + 1
    headers = {
        "Accept": (
            "application/json, application/problem+json, "
            "application/vnd.honua.capability-manifest+json"
        )
    }
    secret = client.api_key or ""
    if secret:
        headers["X-API-Key"] = secret
    for attempt in range(attempts):
        try:
            response = client.session.request(
                "GET",
                f"{client.base_url}{path}",
                headers=headers,
                timeout=client.timeout_seconds,
                allow_redirects=False,
            )
        except requests.Timeout:
            if attempt + 1 == attempts:
                return "timeout", None, None
        except requests.RequestException:
            if attempt + 1 == attempts:
                return "unreachable", None, None
        else:
            if response.status_code not in _RETRYABLE or attempt + 1 == attempts:
                return "response", response.status_code, _body(response)
        client.sleeper(0.25 * (2**attempt))
    return "unreachable", None, None


def _body(response: Any) -> Any:
    content = response.content or b""
    if len(content) > _MAX_BODY_BYTES:
        return None
    if not content:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _from_manifest(client: Any, started: float, status: int | None, body: Any) -> dict[str, Any]:
    secret = client.api_key or ""
    problem_code, problem_type = _problem(body, secret)
    if status in (401,):
        return _auth_report(client, started, "unauthenticated", status, problem_code, problem_type)
    if status == 403:
        return _auth_report(client, started, "forbidden", status, problem_code, problem_type)
    if status == 402:
        return _report(
            client,
            started,
            "unavailable-capability",
            code="unavailable-capability",
            message=(
                "The target refused import.geoservices before a manifest was read "
                f"(server reason: {problem_code or 'payment-required'}). "
                "No import was started, and this CLI will not change licensing."
            ),
            http_status=status,
            server_reason=problem_code or "payment-required",
            problem_type=problem_type,
        )
    if status in _REDIRECTS or status != 200 or not isinstance(body, dict):
        return _unknown(client, started, status, problem_code, problem_type)

    scope_value = body.get("scope")
    scope = scope_value if isinstance(scope_value, dict) else {}
    if scope.get("authenticated") is False:
        return _auth_report(client, started, "unauthenticated", status, problem_code, problem_type)
    if scope.get("authenticated") is not True:
        return _unknown(client, started, status, problem_code, problem_type)

    kind, job_status, _job_body = _get(client, IMPORT_JOBS_PATH)
    if kind == "timeout":
        return _report(
            client,
            started,
            "unreachable",
            code="timeout",
            message=(
                "The target timed out before a readiness response. Check HONUA_URL "
                "and retry with a larger --timeout-seconds. No import was started."
            ),
            http_status=job_status,
            **_observed(body, secret),
        )
    if kind != "response":
        return _report(
            client,
            started,
            "unreachable",
            code="unreachable",
            message=(
                "The target could not be reached before the timeout. Check HONUA_URL, "
                "DNS, and that the server is running. No import was started."
            ),
            http_status=job_status,
            **_observed(body, secret),
        )
    if job_status == 401:
        return _auth_report(client, started, "unauthenticated", job_status, problem_code, problem_type, body)
    if job_status == 403:
        job_code, job_type = _problem(_job_body, secret)
        return _auth_report(
            client,
            started,
            "forbidden",
            job_status,
            job_code or problem_code,
            job_type or problem_type,
            body,
        )
    if job_status != 200:
        return _unknown(client, started, job_status, problem_code, problem_type, body)

    observed = _observed(body, secret)
    schema = observed["schema_version"]
    api = observed["api_version"]
    if schema != MANIFEST_SCHEMA or api != API_VERSION:
        if schema is None or api is None:
            return _unknown(client, started, status, problem_code, problem_type, body)
        return _report(
            client,
            started,
            "incompatible-version",
            code="incompatible-version",
            message=(
                "The target server contract is not compatible with this CLI "
                f"(expected capability manifest {MANIFEST_SCHEMA} and API {API_VERSION}). "
                "Point HONUA_URL at a compatible server. No import was started."
            ),
            http_status=status,
            server_reason=problem_code,
            problem_type=problem_type,
            **observed,
        )
    return _capability(client, started, status, body, observed, problem_code, problem_type)


def _capability(
    client: Any,
    started: float,
    status: int | None,
    body: dict[str, Any],
    observed: dict[str, Any],
    problem_code: str | None,
    problem_type: str | None,
) -> dict[str, Any]:
    declarations = _declarations(body, client.api_key or "")
    licensing = observed["licensing"]
    if not declarations:
        return _unknown(client, started, status, problem_code, problem_type, body)
    denied = next((item for item in declarations if not item[0]), None)
    if denied is not None:
        server_reason = denied[1] or problem_code
        return _report(
            client,
            started,
            "unavailable-capability",
            code="unavailable-capability",
            message=_unavailable_message(licensing, observed, server_reason),
            http_status=status,
            server_reason=server_reason,
            problem_type=problem_type,
            capability_declared=True,
            capability_available=False,
            **observed,
        )
    # Enabled licensing: server license validity is not implied by an active entitlement.
    if licensing == "enabled" and observed["license_valid"] is not True:
        return _report(
            client,
            started,
            "unavailable-capability",
            code="unavailable-capability",
            message=_unavailable_message(licensing, observed, problem_code),
            http_status=status,
            server_reason=problem_code,
            problem_type=problem_type,
            capability_declared=True,
            capability_available=False,
            **observed,
        )
    if licensing == "disabled":
        message = (
            "The server reports import.geoservices is available. "
            "Licensing is disabled on this deployment, so no license is required."
        )
    else:
        message = "The server reports import.geoservices is available."
    return _report(
        client,
        started,
        "ready",
        code="ready",
        message=message,
        http_status=status,
        server_reason=None,
        problem_type=None,
        capability_declared=True,
        capability_available=True,
        **observed,
    )


def _unavailable_message(licensing: str, observed: dict[str, Any], server_reason: str | None) -> str:
    reason = server_reason or "unspecified"
    if licensing == "disabled":
        return (
            "The server has licensing disabled and reports import.geoservices is not "
            f"available ({reason}). This CLI does not add a license requirement. "
            "No import was started."
        )
    state = observed.get("validation_state")
    if observed.get("license_valid") is True:
        return (
            "The target license is valid, but import.geoservices is not entitled "
            f"(server reason: {reason}). Ask the server operator to grant that "
            "capability or use a deployment whose licensing mode is disabled. "
            "This CLI will not change licensing or assume a product tier. "
            "No import was started."
        )
    state_text = state or "not valid"
    return (
        f"The target license is not valid (validation state {state_text}). "
        "Renew or replace the license configured on the server. This is a "
        "license-validity failure, not a client-side edition check. "
        f"Server reason: {reason}. No import was started."
    )


def _declarations(body: dict[str, Any], secret: str) -> list[tuple[bool, str | None]]:
    found: list[tuple[bool, str | None]] = []
    capabilities = body.get("capabilities")
    if isinstance(capabilities, list):
        for item in capabilities:
            if (
                isinstance(item, dict)
                and item.get("id") == CAPABILITY_ID
                and isinstance(item.get("available"), bool)
            ):
                found.append((item["available"], _public_code(item.get("reasonCode"), secret)))
    policies = body.get("policies") if isinstance(body.get("policies"), dict) else {}
    entitlements = policies.get("entitlements") if isinstance(policies, dict) else None
    if isinstance(entitlements, list):
        for item in entitlements:
            if (
                isinstance(item, dict)
                and item.get("key") == CAPABILITY_ID
                and isinstance(item.get("active"), bool)
            ):
                found.append((item["active"], _public_code(item.get("reasonCode"), secret)))
    return found


def _schema_version(value: Any, secret: str) -> str | None:
    if not isinstance(value, str) or (secret and secret in value):
        return None
    if _SCHEMA.fullmatch(value):
        return value
    return None


def _hides_secret(value: str, secret: str) -> bool:
    return bool(secret) and secret in value


def _observed(body: dict[str, Any], secret: str) -> dict[str, Any]:
    server_value = body.get("server")
    server = server_value if isinstance(server_value, dict) else {}
    policies_value = body.get("policies")
    policies = policies_value if isinstance(policies_value, dict) else {}
    schema = _schema_version(body.get("schemaVersion"), secret)
    api = server.get("apiVersion")
    state = policies.get("licenseValidationState")
    valid = policies.get("licenseValid")
    validation = (
        state
        if isinstance(state, str) and _STATE.fullmatch(state) and not _hides_secret(state, secret)
        else None
    )
    if isinstance(validation, str) and validation.lower() == "disabled":
        licensing = "disabled"
    elif not policies:
        licensing = "unknown"
    else:
        licensing = "enabled"
    revision = None
    for key in ("deploymentRevision", "serverRevision"):
        candidate = server.get(key)
        if (
            isinstance(candidate, str)
            and _REVISION.fullmatch(candidate)
            and not _hides_secret(candidate, secret)
        ):
            revision = candidate
            break
    server_version = server.get("serverVersion")
    if (
        not isinstance(server_version, str)
        or not _TOKEN.fullmatch(server_version)
        or _hides_secret(server_version, secret)
    ):
        server_version = None
    api_version = api if isinstance(api, str) and _TOKEN.fullmatch(api) and not _hides_secret(api, secret) else None
    return {
        "schema_version": schema,
        "api_version": api_version,
        "deployment_revision": revision,
        "server_version": server_version,
        "licensing": licensing,
        "validation_state": validation,
        "license_valid": valid if isinstance(valid, bool) else None,
    }


def _auth_report(
    client: Any,
    started: float,
    outcome: str,
    status: int | None,
    problem_code: str | None,
    problem_type: str | None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    observed = _observed(body, client.api_key or "") if isinstance(body, dict) else {}
    if outcome == "forbidden":
        message = (
            "The target authenticated the caller but refused access to GeoServices "
            "import. Use an admin API key that is allowed to call the import API. "
            "No import was started."
        )
    else:
        message = (
            "The target did not authenticate this request. Set HONUA_API_KEY to a "
            "Honua admin API key and retry. No import was started."
        )
    return _report(
        client,
        started,
        outcome,
        code=outcome,
        message=message,
        http_status=status,
        server_reason=problem_code,
        problem_type=problem_type,
        **observed,
    )


def _unknown(
    client: Any,
    started: float,
    status: int | None,
    problem_code: str | None,
    problem_type: str | None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    observed = _observed(body, client.api_key or "") if isinstance(body, dict) else {}
    return _report(
        client,
        started,
        "unknown",
        code="unknown",
        message=(
            "Target readiness could not be determined from the server response. "
            "Import was not started. Retry when the capability manifest is available; "
            "do not treat this as success."
        ),
        http_status=status,
        server_reason=problem_code,
        problem_type=problem_type,
        **observed,
    )


def _problem(body: Any, secret: str) -> tuple[str | None, str | None]:
    if not isinstance(body, dict):
        return None, None
    code = _public_code(body.get("code"), secret)
    if code is None and isinstance(body.get("error"), dict):
        nested = body["error"].get("code")
        code = _public_code(nested, secret) if isinstance(nested, str) else None
    return code, _problem_type(body.get("type"), secret)


def _problem_type(value: Any, secret: str) -> str | None:
    if not isinstance(value, str) or len(value) > 200 or (secret and secret in value):
        return None
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def _public_code(value: Any, secret: str) -> str | None:
    if not isinstance(value, str) or (secret and secret in value):
        return None
    if _CODE.fullmatch(value) is None:
        return None
    return value


def _report(
    client: Any,
    started: float,
    outcome: str,
    *,
    code: str,
    message: str,
    http_status: int | None,
    server_reason: str | None = None,
    problem_type: str | None = None,
    capability_declared: bool = False,
    capability_available: bool | None = None,
    schema_version: str | None = None,
    api_version: str | None = None,
    deployment_revision: str | None = None,
    server_version: str | None = None,
    licensing: str = "unknown",
    validation_state: str | None = None,
    license_valid: bool | None = None,
) -> dict[str, Any]:
    elapsed = max(0.0, float(client.clock() - started))
    reason: dict[str, Any] = {
        "code": code,
        "serverReasonCode": server_reason,
        "message": message,
        "licensing": licensing,
        "licenseValidationState": validation_state,
        "licenseValid": license_valid,
        "capabilityDeclared": capability_declared,
        "capabilityAvailable": capability_available,
    }
    if problem_type is not None:
        reason["problemType"] = problem_type
    return {
        "artifactVersion": "honua.arcgis-service-migration/v1",
        "kind": "target-preflight",
        "contractVersion": READINESS_CONTRACT,
        "outcome": outcome,
        "ready": outcome == "ready",
        "capability": CAPABILITY_ID,
        "exitCode": _EXIT[outcome],
        "httpStatus": http_status,
        "elapsedSeconds": round(elapsed, 3),
        "reason": reason,
        "identity": {
            "target": client.base_url,
            "package": __version__,
            "capability": CAPABILITY_ID,
            "schemaVersion": schema_version,
            "apiVersion": api_version,
            "deploymentRevision": deployment_revision,
            "serverVersion": server_version,
        },
    }
