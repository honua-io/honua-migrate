"""ArcGIS Online Portal scanner adapter."""

from __future__ import annotations

from honua_migrate.assessment import __version__
from honua_migrate.assessment.commands.common import ScanOptions, ScanResult
from honua_migrate.assessment.diagnostics import AssessmentError, DiagnosticError
from honua_migrate.assessment.footprint.v0_1 import to_footprint_v0_1
from honua_migrate.assessment.portal import (
    AnonymousCredential,
    PortalClient,
    PortalScanner,
    RetryPolicy,
    TokenCredential,
)
from honua_migrate.assessment.portal.auth import Credential


def run(options: ScanOptions) -> ScanResult:
    credential: Credential = (
        TokenCredential(options.token) if options.token else AnonymousCredential()
    )
    try:
        client = PortalClient(
            options.target,
            credential=credential,
            timeout=options.timeout,
            retry_policy=RetryPolicy(attempts=max(1, options.max_retries + 1)),
            user_agent=options.user_agent,
        )
        result = PortalScanner(client, deep=False).scan()
    except AssessmentError as exc:
        error = DiagnosticError(
            exc.message,
            code=exc.code,
            scope="agol",
        )
        error.exit_code = exc.exit_code
        raise error from exc
    footprint = to_footprint_v0_1(result, tool_version=__version__)
    return ScanResult(
        footprint=footprint,
        diagnostics=tuple(result.diagnostics),
    )
