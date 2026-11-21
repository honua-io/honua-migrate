"""Portable MigrationRun and reconciliation snapshot bundle for GeoServer migrations."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from honua_migrate.contract_validation import assert_artifact_safe, validate_contract
from honua_migrate.contracts import MigrationError, MigrationRun, SafetyMode

_SUPPORTED_METADATA_KEYS = (
    "planFingerprint",
    "sourceKind",
    "sourceProduct",
    "sourceVersion",
)


def _map_job_outcome(status: str) -> str:
    normalized = status.strip().lower()
    if normalized == "completed":
        return "succeeded"
    if normalized in {"failed", "cancelled"}:
        return normalized
    if normalized in {"queued", "processing"}:
        return "running"
    return "partial"


def _step_list(container: Any, key: str) -> list[dict[str, Any]]:
    if not isinstance(container, Mapping):
        return []
    raw = container.get(key)
    if not isinstance(raw, list):
        return []
    return [dict(item) for item in raw if isinstance(item, Mapping)]


def _extract_source_plan(
    plan_payload: Mapping[str, Any], apply_job: Mapping[str, Any]
) -> Mapping[str, Any]:
    actions = plan_payload.get("actions")
    if isinstance(actions, list) and actions:
        first = actions[0]
        if isinstance(first, Mapping):
            result = first.get("result")
            if isinstance(result, Mapping) and isinstance(result.get("applyPlan"), Mapping):
                return result["applyPlan"]
    progress = apply_job.get("progress")
    if isinstance(progress, Mapping) and isinstance(progress.get("applyPlan"), Mapping):
        return progress["applyPlan"]
    return {}


def _extract_execution_steps(apply_job: Mapping[str, Any]) -> list[dict[str, Any]]:
    progress = apply_job.get("progress")
    if not isinstance(progress, Mapping):
        return []
    return _step_list(progress.get("applyExecution"), "stepResults")


def build_geoserver_migration_run(
    plan_payload: Mapping[str, Any],
    apply_job: Mapping[str, Any],
    *,
    run_id: str | None = None,
    redacted_config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build and schema-validate a durable v1 MigrationRun for a GeoServer apply job."""
    job_id = apply_job.get("jobId")
    if not isinstance(job_id, str) or not job_id.strip():
        raise MigrationError("GeoServer apply job did not include a jobId.")

    plan_id = str(plan_payload.get("id", "")).strip()
    plan_digest_value = str(plan_payload.get("plan_digest", "")).strip()
    if not plan_id or not plan_digest_value:
        raise MigrationError("GeoServer plan is missing id or plan_digest.")

    status = str(apply_job.get("status", "")).strip().lower()
    outcome = _map_job_outcome(status)
    checkpoint: dict[str, Any] = {
        "index": 0,
        "kind": "geoserver-import",
        "job_id": job_id,
        "status": status or "unknown",
    }
    completed_at = apply_job.get("completedAt")
    if isinstance(completed_at, str) and completed_at:
        checkpoint["completed_at"] = completed_at

    run = MigrationRun(
        id=run_id or f"geoserver-run-{job_id}",
        plan_id=plan_id,
        plan_digest=plan_digest_value,
        service="geoserver",
        safety_mode=SafetyMode.APPLY,
        job_ids=(job_id,),
        checkpoints=(checkpoint,),
        outcome=outcome,
        config=dict(redacted_config) if isinstance(redacted_config, Mapping) else {},
    ).to_dict()
    validate_contract("run", run)
    assert_artifact_safe(run)
    return run


def _counts_by_kind(steps: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for step in steps:
        kind = str(step.get("kind") or "unknown")
        counts[kind] = counts.get(kind, 0) + 1
    return dict(sorted(counts.items()))


def _schemas_by_source(steps: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    schemas: dict[str, dict[str, Any]] = {}
    for step in steps:
        source_id = step.get("sourceId")
        if not isinstance(source_id, str) or not source_id:
            continue
        schemas[source_id] = {
            "kind": str(step.get("kind") or ""),
            "targetResourceName": step.get("targetResourceName"),
            "targetServiceName": step.get("targetServiceName"),
        }
    return dict(sorted(schemas.items()))


def _style_relationships(steps: list[dict[str, Any]]) -> list[dict[str, str]]:
    edges: list[dict[str, str]] = []
    for step in steps:
        source_id = step.get("sourceId")
        style_ids = step.get("styleIds")
        if not isinstance(source_id, str) or not isinstance(style_ids, list):
            continue
        for style_id in style_ids:
            if isinstance(style_id, str) and style_id:
                edges.append({"layer": source_id, "style": style_id})
    return edges


def _samples(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for step in steps:
        source_id = step.get("sourceId")
        if not isinstance(source_id, str) or not source_id:
            continue
        items.append(
            {
                "sourceId": source_id,
                "kind": str(step.get("kind") or ""),
                "targetResourceName": step.get("targetResourceName"),
            }
        )
    return items


def _plan_metadata(apply_plan: Mapping[str, Any]) -> dict[str, Any]:
    source = apply_plan.get("source")
    source_map = source if isinstance(source, Mapping) else {}
    return {
        "planFingerprint": apply_plan.get("planFingerprint"),
        "sourceKind": apply_plan.get("sourceKind"),
        "sourceProduct": source_map.get("product"),
        "sourceVersion": source_map.get("version"),
    }


def build_geoserver_reconciliation_snapshots(
    plan_payload: Mapping[str, Any],
    run_payload: Mapping[str, Any],
    apply_job: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build portable source and target snapshots bound to a GeoServer MigrationRun."""
    binding = {
        "run_id": run_payload["id"],
        "plan_id": run_payload["plan_id"],
        "plan_digest": run_payload["plan_digest"],
        "service": run_payload["service"],
    }

    source_plan = _extract_source_plan(plan_payload, apply_job)
    planned_steps = _step_list(source_plan, "steps")
    ready_source_steps = [
        step
        for step in planned_steps
        if str(step.get("disposition", "")).lower() in {"ready", "applied", "already-applied"}
    ]

    execution_steps = _extract_execution_steps(apply_job)
    applied_target_steps = [
        step
        for step in execution_steps
        if str(step.get("outcome", "")).lower() in {"applied", "already-applied"}
        and str(step.get("kind", "")).lower() not in {"workspace", "datastore"}
    ]

    progress = apply_job.get("progress")
    raw_target_plan = (
        progress.get("applyPlan")
        if isinstance(progress, Mapping)
        else None
    )
    target_plan: Mapping[str, Any] = (
        raw_target_plan if isinstance(raw_target_plan, Mapping) else source_plan
    )

    source_steps_by_id = {
        str(step["sourceId"]): step
        for step in ready_source_steps
        if isinstance(step.get("sourceId"), str)
    }
    target_style_steps = [
        source_steps_by_id[str(step["sourceId"])]
        for step in applied_target_steps
        if isinstance(step.get("sourceId"), str) and str(step["sourceId"]) in source_steps_by_id
    ]

    source_snapshot: dict[str, Any] = {
        **binding,
        "counts": _counts_by_kind(ready_source_steps),
        "schemas": _schemas_by_source(ready_source_steps),
        "extents": {},
        "samples": _samples(ready_source_steps),
        "relationships": _style_relationships(ready_source_steps),
        "metadata": _plan_metadata(source_plan),
    }
    target_snapshot: dict[str, Any] = {
        **binding,
        "counts": _counts_by_kind(applied_target_steps),
        "schemas": _schemas_by_source(applied_target_steps),
        "extents": {},
        "samples": _samples(applied_target_steps),
        "relationships": _style_relationships(target_style_steps),
        "metadata": _plan_metadata(target_plan),
        "supported_metadata": list(_SUPPORTED_METADATA_KEYS),
    }

    assert_artifact_safe(source_snapshot)
    assert_artifact_safe(target_snapshot)
    return source_snapshot, target_snapshot


def write_geoserver_reconcile_bundle(
    bundle_dir: Path,
    plan_payload: Mapping[str, Any],
    apply_job: Mapping[str, Any],
    *,
    write_fn: Any,
    run_id: str | None = None,
    redacted_config: Mapping[str, Any] | None = None,
    force: bool = False,
) -> dict[str, str]:
    """Write run.json, source-snapshot.json, and target-snapshot.json into bundle_dir."""
    run_payload = build_geoserver_migration_run(
        plan_payload,
        apply_job,
        run_id=run_id,
        redacted_config=redacted_config,
    )
    source_snapshot, target_snapshot = build_geoserver_reconciliation_snapshots(
        plan_payload,
        run_payload,
        apply_job,
    )

    run_path = bundle_dir / "run.json"
    source_path = bundle_dir / "source-snapshot.json"
    target_path = bundle_dir / "target-snapshot.json"

    write_fn(run_payload, run_path, force=force)
    write_fn(source_snapshot, source_path, force=force)
    write_fn(target_snapshot, target_path, force=force)

    return {
        "run": str(run_path),
        "source_snapshot": str(source_path),
        "target_snapshot": str(target_path),
    }
