"""Command-line entrypoint for the ArcPy -> Honua GP migration codemod.

Secondary module entry point (the canonical CLI is
``honua-migrate code python``)::

    python -m honua_migrate.code.python scan path/to/script.py
    python -m honua_migrate.code.python translate script.py --evidence out.json
    python -m honua_migrate.code.python run script.py --server https://example.test

The ``scan``, ``translate``, ``pyt``, ``atbx``, and ``gpservice`` commands work
offline (no ArcGIS or network). Their success is not target execution. ``run``
submits a fully supported straight-line plan and exits 0 only after every
required job reaches a successful terminal state and every declared output
checks out. Asynchronous jobs are polled for at most 120 seconds. ``--yes``
does not accept an empty, partial, unsupported, or unfinished plan.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from honua_esri_assess.output_io import (
    OutputExistsError,
    atomic_write_text,
    ensure_overwrite_allowed,
)
from honua_migrate.contract_validation import assert_artifact_safe
from honua_migrate.contracts import (
    EXIT_BAD_ARGUMENTS,
    EXIT_PARTIAL,
    EXIT_REMOTE_ERROR,
    EXIT_SAFETY_REFUSAL,
    EXIT_SUCCESS,
    EXIT_UNAVAILABLE,
    EXIT_VALIDATION_ERROR as EXIT_UNSUPPORTED_INPUT,
    MigrationError,
    plan_digest,
)

from .arcpy import (
    JOB_STATUS_DISMISSED,
    JOB_STATUS_SUCCESSFUL,
    ArcPyCall,
    ArcPyJobError,
    ArcPyJobTimeoutError,
    ArcPyMigrationPlan,
    ArcPyProcessExecution,
    ArcPyProcessRunner,
    ArcPyProcessTranslation,
    _call_argument,
    _job_status,
    _lookup_spec,
    _normalize_status,
    build_parity_evidence,
    scan_arcpy_file,
    scan_arcpy_source,
    translate_arcpy_report,
)
from .modelbuilder import (
    UnsupportedModelFormatError,
    build_atbx_parity_evidence,
    build_gp_service_parity_evidence,
    parse_atbx_toolbox,
    parse_gp_service_definition,
)
from .pyt import (
    UnsupportedToolboxError,
    build_pyt_parity_evidence,
    parse_binary_toolbox,
    parse_pyt_file,
)

# .atbx is now handled clean-room by the modelbuilder reader; only the
# proprietary binary .tbx remains an explicit stub in the ``pyt`` command.
_BINARY_TOOLBOX_SUFFIXES = {".tbx"}

# Asynchronous jobs are polled at one-second intervals and abandoned as
# non-success after two minutes. The submitted job id is kept; it is not retried.
_POLL_INTERVAL_SECONDS = 1.0
_MAX_POLLS = 120
_RUN_SCHEMA = "honua.migration.python.gp-run/v1"
_BLOCKING_SCOPES = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.Try,
    ast.With,
    ast.AsyncWith,
    ast.Match,
    ast.ExceptHandler,
    ast.IfExp,
    ast.BoolOp,
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.ClassDef,
    ast.Lambda,
    ast.ListComp,
    ast.SetComp,
    ast.DictComp,
    ast.GeneratorExp,
)


def _preflight_outputs(
    *paths: Path | None,
    force: bool,
) -> int | None:
    requested = [path for path in paths if path is not None]
    if len(set(requested)) != len(requested):
        print("output paths must be distinct", file=sys.stderr)
        return EXIT_UNSUPPORTED_INPUT
    try:
        for path in requested:
            ensure_overwrite_allowed(path, force=force)
    except OutputExistsError:
        print("output already exists; use --force to replace it", file=sys.stderr)
        return EXIT_UNSUPPORTED_INPUT
    return None


def _emit(
    obj: object,
    *,
    out: Path | None,
    force: bool,
) -> int | None:
    try:
        assert_artifact_safe(obj)
    except MigrationError as exc:
        print("artifact validation failed", file=sys.stderr)
        return exc.exit_code
    text = json.dumps(obj, indent=2, sort_keys=False)
    if out is None:
        print(text)
        return None
    try:
        ensure_overwrite_allowed(out, force=force)
        atomic_write_text(out, text + "\n")
    except OutputExistsError:
        print("output already exists; use --force to replace it", file=sys.stderr)
        return EXIT_UNSUPPORTED_INPUT
    except OSError:
        print("could not write output", file=sys.stderr)
        return EXIT_UNSUPPORTED_INPUT
    return None


def _valid_server_url(value: str) -> bool:
    if not value or any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        return False
    if "\\" in value:
        return False
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme.lower() in {"http", "https"}
        and bool(parsed.netloc)
        and hostname is not None
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
    )


def _cmd_scan(args: argparse.Namespace) -> int:
    failure = _preflight_outputs(args.output, force=args.force)
    if failure is not None:
        return failure
    report = scan_arcpy_file(args.path)
    failure = _emit(report.to_dict(), out=args.output, force=args.force)
    if failure is not None:
        return failure
    if report.syntax_error is not None:
        print(f"syntax error: {report.syntax_error}", file=sys.stderr)
        return EXIT_BAD_ARGUMENTS
    return EXIT_SUCCESS


def _cmd_translate(args: argparse.Namespace) -> int:
    failure = _preflight_outputs(
        args.output,
        args.evidence,
        force=args.force,
    )
    if failure is not None:
        return failure
    report = scan_arcpy_file(args.path)
    if report.syntax_error is not None:
        print(f"syntax error: {report.syntax_error}", file=sys.stderr)
        return EXIT_BAD_ARGUMENTS
    plan = translate_arcpy_report(report)
    evidence = build_parity_evidence(plan)
    if args.evidence is not None:
        failure = _emit(evidence, out=args.evidence, force=args.force)
        if failure is not None:
            return failure
    failure = _emit(plan.to_dict(), out=args.output, force=args.force)
    if failure is not None:
        return failure

    summary = evidence["summary"]
    print(
        f"coverage: {summary['translatableCalls']}/{summary['totalCalls']} translatable "
        f"({summary['coveragePercent']}%), {summary['manualReviewCalls']} manual-review, "
        f"{summary['unsupportedCalls']} unsupported",
        file=sys.stderr,
    )
    return EXIT_SUCCESS


def _package_identity() -> dict[str, str]:
    from honua_migrate import __version__

    return {"name": "honua-migrate", "version": __version__}


def _public_http_url(value: str) -> str | None:
    """Return scheme, host, and path, dropping userinfo and query secrets."""

    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    hostname = parsed.hostname
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or hostname is None
        or parsed.username is not None
        or parsed.password is not None
    ):
        return None
    netloc = hostname if parsed.port is None else f"{hostname}:{parsed.port}"
    return f"{parsed.scheme.lower()}://{netloc}{parsed.path}"


def _public_job_id(job_id: str | None) -> str | None:
    if job_id is None:
        return None
    if job_id.lower().startswith(("http://", "https://")):
        return _public_http_url(job_id)
    lowered = job_id.lower()
    if any(mark in job_id for mark in ("?", "#")) or any(
        mark in lowered for mark in ("token", "secret", "password")
    ):
        return None
    return job_id


def _public_status(status: str | None) -> str | None:
    normalized = _normalize_status(status)
    if normalized == JOB_STATUS_DISMISSED:
        return "cancelled"
    return normalized


def _python_expressions(value: Any) -> list[str]:
    if isinstance(value, Mapping) and set(value) == {"python"} and isinstance(value.get("python"), str):
        return [value["python"]]
    found: list[str] = []
    if isinstance(value, Mapping):
        for item in value.values():
            found.extend(_python_expressions(item))
    elif isinstance(value, list | tuple):
        for item in value:
            found.extend(_python_expressions(item))
    return found


def _expression_names(expression: str) -> set[str]:
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return set()
    return {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}


def _call_values(call: ArcPyCall) -> list[Any]:
    return [*call.args, *call.kwargs.values(), *call.expanded_kwargs]


def _missing_required(call: ArcPyCall) -> str | None:
    spec = _lookup_spec(call.family, call.tool)
    if spec is None:
        return None
    for index, arg in enumerate(spec.args):
        if arg.kind not in {"input", "output"}:
            continue
        if _call_argument(call, index, arg.arcpy_name) is None:
            return arg.arcpy_name
    return None


def _produced_names(call: ArcPyCall) -> set[str]:
    names = set(call.assignment_targets)
    spec = _lookup_spec(call.family, call.tool)
    if spec is None:
        return names
    for index, arg in enumerate(spec.args):
        if arg.kind != "output":
            continue
        value = _call_argument(call, index, arg.arcpy_name)
        if isinstance(value, str) and value.isidentifier():
            names.add(value)
    return names


def _blocked_call_locations(source: str) -> set[tuple[int, int]]:
    """Locations of calls inside branches, loops, or nested definitions.

    This runner is not a Python interpreter. A call that might not run, or
    might run more than once, is refused before any target request.
    """

    tree = ast.parse(source)
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    blocked: set[tuple[int, int]] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        current: ast.AST | None = node
        while current in parents:
            current = parents[current]
            if isinstance(current, _BLOCKING_SCOPES):
                blocked.add((node.lineno, node.col_offset))
                break
    return blocked


def _static_refusal(plan: ArcPyMigrationPlan, source: str) -> dict[str, Any] | None:
    """Return a pre-dispatch refusal, or None when every call may be executed."""

    if plan.report.syntax_error is not None:
        return {
            "outcome": "refused",
            "reason": "syntax-error",
            "exit_code": EXIT_BAD_ARGUMENTS,
            "guidance": "The script has a syntax error. Nothing was submitted.",
        }
    blocked = _blocked_call_locations(source)
    if any((call.line, call.column) in blocked for call in plan.report.calls):
        return {
            "outcome": "unsupported",
            "reason": "unsupported-control-flow",
            "exit_code": EXIT_UNSUPPORTED_INPUT,
            "guidance": (
                "Branches, loops, and nested definitions are not executed. "
                "Nothing was submitted."
            ),
        }

    produced: set[str] = set()
    for call in plan.report.calls:
        if not call.translatable:
            continue
        for value in _call_values(call):
            for expression in _python_expressions(value):
                if _expression_names(expression) & produced:
                    return {
                        "outcome": "incomplete",
                        "reason": "unsupported-dependency",
                        "exit_code": EXIT_UNSUPPORTED_INPUT,
                        "guidance": (
                            "A later step depends on a prior result this runner "
                            "cannot bind. Nothing was submitted."
                        ),
                    }
                return {
                    "outcome": "incomplete",
                    "reason": "unresolved-input",
                    "exit_code": EXIT_UNSUPPORTED_INPUT,
                    "guidance": (
                        "A required value is not a literal. Nothing was submitted."
                    ),
                }
        if _missing_required(call) is not None:
            return {
                "outcome": "incomplete",
                "reason": "missing-input",
                "exit_code": EXIT_UNSUPPORTED_INPUT,
                "guidance": (
                    "A required input or output is missing. Nothing was submitted."
                ),
            }
        produced.update(_produced_names(call))

    calls = plan.report.calls
    translatable = [call for call in calls if call.translatable]
    if not calls:
        return {
            "outcome": "empty",
            "reason": "no-runnable-steps",
            "exit_code": EXIT_PARTIAL,
            "guidance": (
                "no translatable ArcPy calls to execute. Nothing was submitted."
            ),
        }
    if not translatable:
        if all(call.status == "unsupported" for call in calls):
            return {
                "outcome": "unsupported",
                "reason": "unsupported-calls",
                "exit_code": EXIT_PARTIAL,
                "guidance": "Every ArcPy call is unsupported. Nothing was submitted.",
            }
        if all(call.status == "manual-review" for call in calls):
            return {
                "outcome": "partial",
                "reason": "manual-review-only",
                "exit_code": EXIT_PARTIAL,
                "guidance": (
                    "no translatable ArcPy calls to execute. Nothing was submitted."
                ),
            }
        return _partial_plan_refusal()
    if len(translatable) != len(calls) or any(
        not translation.call.translatable for translation in plan.translations
    ):
        return _partial_plan_refusal()
    return None


def _partial_plan_refusal() -> dict[str, Any]:
    return {
        "outcome": "partial",
        "reason": "partial-plan",
        "exit_code": EXIT_PARTIAL,
        "guidance": "Nothing was submitted. --yes does not run a partial plan.",
    }


def _plan_id(script_name: str, plan: ArcPyMigrationPlan) -> str:
    return plan_digest(
        {
            "script": script_name,
            "syntaxError": plan.report.syntax_error,
            "calls": [
                {
                    "qualifiedName": call.qualified_name,
                    "line": call.line,
                    "status": call.status,
                }
                for call in plan.report.calls
            ],
        }
    )


def _skipped_calls(plan: ArcPyMigrationPlan) -> list[dict[str, Any]]:
    return [
        {
            "qualifiedName": call.qualified_name,
            "status": call.status,
            "line": call.line,
        }
        for call in plan.report.calls
        if not call.translatable
    ]


def _run_document(
    args: argparse.Namespace,
    plan: ArcPyMigrationPlan,
    *,
    script_name: str,
    outcome: str,
    reason: str,
    guidance: str,
    jobs: list[dict[str, Any]],
    output_checks: list[dict[str, Any]],
    dispatch_count: int,
    executions: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schema": _RUN_SCHEMA,
        "command": "run",
        "mode": "dry-run" if args.dry_run else "execute",
        "dryRun": bool(args.dry_run),
        "outcome": outcome,
        "reason": reason,
        "executionSuccess": outcome == "succeeded",
        "script": script_name,
        "server": args.server,
        "package": _package_identity(),
        "planId": _plan_id(script_name, plan),
        "maxPolls": _MAX_POLLS,
        "pollIntervalSeconds": _POLL_INTERVAL_SECONDS,
        "pollBoundSeconds": _POLL_INTERVAL_SECONDS * _MAX_POLLS,
        "submitted": dispatch_count > 0,
        "dispatchCount": dispatch_count,
        "jobs": jobs,
        "outputChecks": output_checks,
        "skipped": _skipped_calls(plan),
        "executions": executions,
        "guidance": guidance,
    }


def _finish_run(
    args: argparse.Namespace,
    plan: ArcPyMigrationPlan,
    *,
    script_name: str,
    outcome: str,
    reason: str,
    guidance: str,
    exit_code: int,
    jobs: list[dict[str, Any]] | None = None,
    output_checks: list[dict[str, Any]] | None = None,
    dispatch_count: int = 0,
    executions: list[dict[str, Any]] | None = None,
) -> int:
    document = _run_document(
        args,
        plan,
        script_name=script_name,
        outcome=outcome,
        reason=reason,
        guidance=guidance,
        jobs=[] if jobs is None else jobs,
        output_checks=[] if output_checks is None else output_checks,
        dispatch_count=dispatch_count,
        executions=[] if executions is None else executions,
    )
    failure = _emit(document, out=args.output, force=args.force)
    if failure is not None:
        return failure
    print(f"{reason}: {guidance}", file=sys.stderr)
    return exit_code


def _terminal_success(execution: ArcPyProcessExecution) -> bool:
    """True only for an explicit successful terminal status.

    A missing status is not success. ``accepted`` is only submission.
    """

    if execution.job_id is not None:
        return _normalize_status(execution.status) == JOB_STATUS_SUCCESSFUL
    return _normalize_status(_job_status(execution.result)) == JOB_STATUS_SUCCESSFUL


def _reference_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, Mapping):
        for key in ("href", "url", "value", "reference"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                return item.strip()
    return None


def _checked_reference(declared: Any, actual: Any) -> str | None:
    text = _reference_text(actual)
    if text is None:
        return None
    if text.lower().startswith(("http://", "https://")):
        return _public_http_url(text)
    if isinstance(declared, str) and text == declared.strip():
        return text
    return None


def _output_checks(execution: ArcPyProcessExecution) -> tuple[bool, list[dict[str, Any]]]:
    declared = execution.translation.payload.get("outputs")
    if not isinstance(declared, Mapping) or not declared:
        return True, []
    document = execution.results if isinstance(execution.results, Mapping) else execution.result
    produced: Mapping[str, Any] = {}
    if isinstance(document, Mapping):
        outputs = document.get("outputs")
        if isinstance(outputs, Mapping):
            produced = outputs
        else:
            produced = document
    checks: list[dict[str, Any]] = []
    verified_all = True
    for name, declared_value in declared.items():
        reference = _checked_reference(declared_value, produced.get(name))
        verified = reference is not None
        verified_all = verified_all and verified
        checks.append({"name": str(name), "verified": verified, "reference": reference})
    return verified_all, checks


def _job_record(
    translation: ArcPyProcessTranslation,
    *,
    job_id: str | None,
    status: str | None,
    succeeded: bool,
) -> dict[str, Any]:
    return {
        "jobId": _public_job_id(job_id),
        "processId": translation.process_id,
        "qualifiedName": translation.call.qualified_name,
        "status": _public_status(status),
        "succeeded": succeeded,
    }


def _sdk_unavailable_guidance() -> str:
    return (
        "run requires the public honua-sdk package. honua-sdk 0.x also owns "
        "the honua-migrate console script; use an isolated environment and "
        "invoke this distribution as python -m honua_migrate. See "
        "https://github.com/honua-io/honua-migrate/blob/trunk/docs/"
        "console-script-collision.md."
    )


def _execute_plan(
    args: argparse.Namespace,
    plan: ArcPyMigrationPlan,
    *,
    script_name: str,
) -> int:
    try:
        from honua_sdk import HonuaClient
    except ImportError:
        return _finish_run(
            args,
            plan,
            script_name=script_name,
            outcome="unavailable",
            reason="sdk-unavailable",
            guidance=_sdk_unavailable_guidance(),
            exit_code=EXIT_UNAVAILABLE,
        )

    jobs: list[dict[str, Any]] = []
    output_checks: list[dict[str, Any]] = []
    dispatch_count = 0
    # One attempt per step. A lost or unfinished response is not posted again.
    with HonuaClient(args.server) as client:
        runner = ArcPyProcessRunner(
            client,
            poll_interval=_POLL_INTERVAL_SECONDS,
            max_polls=_MAX_POLLS,
        )
        for translation in plan.translations:
            dispatch_count += 1
            try:
                execution = runner.execute_async(translation)
            except ArcPyJobTimeoutError as exc:
                job_id = _public_job_id(exc.job_id)
                jobs.append(
                    _job_record(
                        translation,
                        job_id=exc.job_id,
                        status=exc.status,
                        succeeded=False,
                    )
                )
                shown = job_id or "the submitted job"
                return _finish_run(
                    args,
                    plan,
                    script_name=script_name,
                    outcome="timed-out",
                    reason="job-timed-out",
                    guidance=(
                        f"Job {shown} is still unfinished after "
                        f"{_POLL_INTERVAL_SECONDS * _MAX_POLLS:.0f}s. It was not "
                        "cancelled and was not resubmitted. Resume from this job id "
                        "instead of starting the plan again."
                    ),
                    exit_code=EXIT_PARTIAL,
                    jobs=jobs,
                    output_checks=output_checks,
                    dispatch_count=dispatch_count,
                )
            except ArcPyJobError as exc:
                job_id = _public_job_id(exc.job_id)
                cancelled = _normalize_status(exc.status) == JOB_STATUS_DISMISSED
                jobs.append(
                    _job_record(
                        translation,
                        job_id=exc.job_id,
                        status=exc.status,
                        succeeded=False,
                    )
                )
                shown = job_id or "the submitted job"
                if cancelled:
                    return _finish_run(
                        args,
                        plan,
                        script_name=script_name,
                        outcome="cancelled",
                        reason="job-cancelled",
                        guidance=(
                            f"Job {shown} was cancelled and was not resubmitted."
                        ),
                        exit_code=EXIT_PARTIAL,
                        jobs=jobs,
                        output_checks=output_checks,
                        dispatch_count=dispatch_count,
                    )
                return _finish_run(
                    args,
                    plan,
                    script_name=script_name,
                    outcome="failed",
                    reason="job-failed",
                    guidance=(
                        f"Job {shown} failed and was not resubmitted. Inspect it "
                        "before any manual retry."
                    ),
                    exit_code=EXIT_REMOTE_ERROR,
                    jobs=jobs,
                    output_checks=output_checks,
                    dispatch_count=dispatch_count,
                )
            except Exception:
                jobs.append(
                    _job_record(
                        translation,
                        job_id=None,
                        status=None,
                        succeeded=False,
                    )
                )
                return _finish_run(
                    args,
                    plan,
                    script_name=script_name,
                    outcome="failed",
                    reason="remote-error",
                    guidance=(
                        "The target request failed. It was not retried. Check "
                        "whether a job was created before resubmitting."
                    ),
                    exit_code=EXIT_REMOTE_ERROR,
                    jobs=jobs,
                    output_checks=output_checks,
                    dispatch_count=dispatch_count,
                )

            if not _terminal_success(execution):
                jobs.append(
                    _job_record(
                        translation,
                        job_id=execution.job_id,
                        status=execution.status or _job_status(execution.result),
                        succeeded=False,
                    )
                )
                return _finish_run(
                    args,
                    plan,
                    script_name=script_name,
                    outcome="partial",
                    reason="submission-not-terminal",
                    guidance=(
                        "The server did not return a successful terminal result. "
                        "It was not resubmitted."
                    ),
                    exit_code=EXIT_PARTIAL,
                    jobs=jobs,
                    output_checks=output_checks,
                    dispatch_count=dispatch_count,
                )

            verified, checks = _output_checks(execution)
            output_checks.extend(checks)
            jobs.append(
                _job_record(
                    translation,
                    job_id=execution.job_id,
                    status=execution.status or _job_status(execution.result),
                    succeeded=verified,
                )
            )
            if not verified:
                job_id = _public_job_id(execution.job_id)
                shown = job_id or "the submitted job"
                return _finish_run(
                    args,
                    plan,
                    script_name=script_name,
                    outcome="partial",
                    reason="output-unverified",
                    guidance=(
                        f"Job {shown} did not produce a verified declared output. "
                        "It was not resubmitted."
                    ),
                    exit_code=EXIT_PARTIAL,
                    jobs=jobs,
                    output_checks=output_checks,
                    dispatch_count=dispatch_count,
                )

    return _finish_run(
        args,
        plan,
        script_name=script_name,
        outcome="succeeded",
        reason="completed",
        guidance=(
            "Every required job succeeded and every declared output was verified."
        ),
        exit_code=EXIT_SUCCESS,
        jobs=jobs,
        output_checks=output_checks,
        dispatch_count=dispatch_count,
    )


def _cmd_run(args: argparse.Namespace) -> int:
    # --yes authorizes a mutating request. It does not make a partial plan succeed.
    if not args.dry_run and not args.acknowledge:
        print(
            "refusing remote execution without --yes/--acknowledge",
            file=sys.stderr,
        )
        return EXIT_SAFETY_REFUSAL
    failure = _preflight_outputs(args.output, force=args.force)
    if failure is not None:
        return failure
    if not _valid_server_url(args.server):
        print("invalid server URL", file=sys.stderr)
        return EXIT_UNSUPPORTED_INPUT

    script_name = Path(args.path).name
    try:
        source = Path(args.path).read_text(encoding="utf-8")
    except OSError:
        print("could not read the input script", file=sys.stderr)
        return EXIT_BAD_ARGUMENTS

    plan = translate_arcpy_report(
        scan_arcpy_source(source, filename=script_name)
    )
    refusal = _static_refusal(plan, source)
    if refusal is not None:
        return _finish_run(
            args,
            plan,
            script_name=script_name,
            outcome=refusal["outcome"],
            reason=refusal["reason"],
            guidance=refusal["guidance"],
            exit_code=refusal["exit_code"],
        )

    if args.dry_run:
        return _finish_run(
            args,
            plan,
            script_name=script_name,
            outcome="dry-run",
            reason="not-executed",
            guidance=(
                "Dry run only. No target request was sent. This is not "
                "execution success."
            ),
            exit_code=EXIT_SUCCESS,
            executions=[translation.to_dict() for translation in plan.translations],
        )

    return _execute_plan(args, plan, script_name=script_name)


def _cmd_pyt(args: argparse.Namespace) -> int:
    failure = _preflight_outputs(
        args.output,
        args.evidence,
        force=args.force,
    )
    if failure is not None:
        return failure
    suffix = Path(args.path).suffix.lower()
    if suffix in _BINARY_TOOLBOX_SUFFIXES:
        try:
            parse_binary_toolbox(args.path)
        except UnsupportedToolboxError as exc:
            print(str(exc), file=sys.stderr)
            return EXIT_UNSUPPORTED_INPUT

    toolbox = parse_pyt_file(args.path)
    if args.evidence is not None:
        failure = _emit(
            build_pyt_parity_evidence(toolbox),
            out=args.evidence,
            force=args.force,
        )
        if failure is not None:
            return failure
    failure = _emit(toolbox.to_dict(), out=args.output, force=args.force)
    if failure is not None:
        return failure
    if toolbox.syntax_error is not None:
        print(f"syntax error: {toolbox.syntax_error}", file=sys.stderr)
        return EXIT_BAD_ARGUMENTS
    return EXIT_SUCCESS


def _cmd_atbx(args: argparse.Namespace) -> int:
    failure = _preflight_outputs(
        args.output,
        args.evidence,
        force=args.force,
    )
    if failure is not None:
        return failure
    try:
        toolbox = parse_atbx_toolbox(args.path)
    except UnsupportedModelFormatError as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_UNSUPPORTED_INPUT
    if args.evidence is not None:
        failure = _emit(
            build_atbx_parity_evidence(toolbox),
            out=args.evidence,
            force=args.force,
        )
        if failure is not None:
            return failure
    failure = _emit(toolbox.to_dict(), out=args.output, force=args.force)
    if failure is not None:
        return failure
    if toolbox.parse_error is not None:
        print(f"parse error: {toolbox.parse_error}", file=sys.stderr)
        return EXIT_BAD_ARGUMENTS
    return EXIT_SUCCESS


def _cmd_gpservice(args: argparse.Namespace) -> int:
    failure = _preflight_outputs(
        args.output,
        args.evidence,
        force=args.force,
    )
    if failure is not None:
        return failure
    text = Path(args.path).read_text(encoding="utf-8")
    try:
        service = parse_gp_service_definition(text, url=args.url)
    except (UnsupportedModelFormatError, json.JSONDecodeError) as exc:
        print(f"could not parse GP service definition: {exc}", file=sys.stderr)
        return EXIT_BAD_ARGUMENTS
    if args.evidence is not None:
        failure = _emit(
            build_gp_service_parity_evidence(service),
            out=args.evidence,
            force=args.force,
        )
        if failure is not None:
            return failure
    failure = _emit(service.to_dict(), out=args.output, force=args.force)
    if failure is not None:
        return failure
    return EXIT_SUCCESS


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m honua_migrate.code.python",
        description=__doc__.splitlines()[0],
    )
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="Classify ArcPy calls in a Python script (offline).")
    scan.add_argument("path", type=Path, help="Path to an arcpy .py script.")
    scan.add_argument("--output", type=Path, default=None, help="Write JSON report to this path (default: stdout).")
    scan.add_argument("--force", action="store_true", help="Replace existing output files.")
    scan.set_defaults(func=_cmd_scan)

    translate = sub.add_parser(
        "translate",
        help="Emit OGC Processes payloads + a parity-evidence coverage report (offline).",
    )
    translate.add_argument("path", type=Path, help="Path to an arcpy .py script.")
    translate.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write the migration plan JSON here (default: stdout).",
    )
    translate.add_argument(
        "--evidence",
        type=Path,
        default=None,
        help="Write the parity-evidence JSON report to this path.",
    )
    translate.add_argument("--force", action="store_true", help="Replace existing output files.")
    translate.set_defaults(func=_cmd_translate)

    run = sub.add_parser(
        "run",
        help=(
            "Execute a fully supported straight-line plan. Exit 0 only after every "
            "required job succeeds and declared outputs are verified."
        ),
    )
    run.add_argument("path", type=Path, help="Path to an arcpy .py script.")
    run.add_argument("--server", required=True, help="Honua server base URL.")
    run.add_argument("--output", type=Path, default=None, help="Write execution results JSON here (default: stdout).")
    run.add_argument("--dry-run", action="store_true", help="Emit payloads without contacting the server.")
    run.add_argument(
        "--yes",
        "--acknowledge",
        dest="acknowledge",
        action="store_true",
        help=(
            "Acknowledge that non-dry-run execution mutates the Honua target. "
            "This does not accept an empty, partial, unsupported, or unfinished plan."
        ),
    )
    run.add_argument("--force", action="store_true", help="Replace existing output files.")
    run.set_defaults(func=_cmd_run)

    pyt = sub.add_parser("pyt", help="Parse a .pyt Python toolbox and classify its tools' GP calls.")
    pyt.add_argument("path", type=Path, help="Path to a .pyt Python toolbox (or .tbx to see the binary-format stub).")
    pyt.add_argument("--output", type=Path, default=None, help="Write the toolbox JSON here (default: stdout).")
    pyt.add_argument("--evidence", type=Path, default=None, help="Write the aggregated parity-evidence JSON here.")
    pyt.add_argument("--force", action="store_true", help="Replace existing output files.")
    pyt.set_defaults(func=_cmd_pyt)

    atbx = sub.add_parser(
        "atbx",
        help="Parse a .atbx ModelBuilder toolbox clean-room and classify its models' GP steps.",
    )
    atbx.add_argument("path", type=Path, help="Path to a .atbx ModelBuilder toolbox.")
    atbx.add_argument("--output", type=Path, default=None, help="Write the toolbox JSON here (default: stdout).")
    atbx.add_argument("--evidence", type=Path, default=None, help="Write the aggregated parity-evidence JSON here.")
    atbx.add_argument("--force", action="store_true", help="Replace existing output files.")
    atbx.set_defaults(func=_cmd_atbx)

    gpservice = sub.add_parser(
        "gpservice",
        help="Parse an ArcGIS REST GPServer service-definition JSON and classify its tasks (offline).",
    )
    gpservice.add_argument("path", type=Path, help="Path to a GPServer service-definition JSON (.../GPServer?f=json).")
    gpservice.add_argument("--url", default=None, help="Original service URL to record in the report.")
    gpservice.add_argument("--output", type=Path, default=None, help="Write the service JSON here (default: stdout).")
    gpservice.add_argument(
        "--evidence", type=Path, default=None, help="Write the aggregated parity-evidence JSON here."
    )
    gpservice.add_argument("--force", action="store_true", help="Replace existing output files.")
    gpservice.set_defaults(func=_cmd_gpservice)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    exit_code: int = args.func(args)
    return exit_code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
