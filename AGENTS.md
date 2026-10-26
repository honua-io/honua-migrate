# AGENTS.md

**No AI/agent attribution in commits or PR bodies** (Fleet rule 1 at the end of this file).

## Overview

`honua-migrate` is the open-source (Apache-2.0) migration CLI. Its
`honua-migrate assess` surface is a **read-only** Esri footprint assessment
tool used for Honua migration discovery. The `honua-esri-assess` command and
`honua_esri_assess` import package remain supported compatibility surfaces.

Hard project constraints (do not violate):
- The legacy assessment modules and `honua-migrate assess` are strictly read-only
  against Esri systems — only HTTP `GET`s, never `POST`/`PUT`/`DELETE`. No write
  helpers exist in their HTTP wrappers. Write-capable target operations belong only
  under `honua_migrate`, and must be protected by reviewable plan and explicit apply
  gates.
- No network telemetry, usage pings, crash uploads, or update checks. These are
  off by default and there is no opt-in sink. Tests enforce this.
- `EsriFootprint.json` is the sole supported handoff into the closed Honua
  product. Credentials, tokens, query strings, and URL userinfo must never be
  written into the artifact, diagnostics, cache keys, or logs.

## Tech Stack

- Language: Python, `requires-python = ">=3.11"` (CI tests 3.11, 3.12, 3.13).
- Build backend: Hatchling (`hatchling>=1.24`), PEP 517.
- CLI framework: Typer / Click.
- Runtime deps: `jsonschema>=4.21,<5`, `requests>=2.31,<3`,
  `typer>=0.12,<1`.
- Optional extra `filegdb`: `pyogrio>=0.12,<0.13` (GDAL/OGR read-only metadata).
- Dev tooling: `pytest`, `ruff`, `mypy`, `build`, `hatchling`, `responses`,
  `packaging`.

## Setup

Install in editable mode with the dev extra (matches CI):

```bash
python3 -m pip install -e ".[dev]"
```

For the fixture-backed smoke suite only:

```bash
python -m pip install -e ".[smoke]"
```

To use the `pyogrio` FileGDB workspace scanner library, also install the
`filegdb` extra (requires GDAL): `pip install -e ".[filegdb]"`.

## Commands

Run from the repo root. These are copied from CI (`.github/workflows/ci.yml`)
and `pyproject.toml`.

- Unit tests (excludes smoke): `pytest tests --ignore=tests/smoke`
- Full test suite: `pytest`
- Smoke tests: `pytest tests/smoke -v`
- Lint: `ruff check`
- Type check: `mypy`
- Dependency license guard: `python scripts/check_dep_licenses.py`
- Build distribution: `python -m build`
- Run the CLI: `honua-migrate <command>` or `python -m honua_migrate <command>`
- Run assessment compatibility: `honua-esri-assess <command>` or `python -m honua_esri_assess <command>`

pytest config (`pyproject.toml`): `pythonpath = ["src"]`, `testpaths = ["tests"]`,
`addopts = ["--import-mode=importlib"]`.

### CLI surface

`scan agol`, `scan server`, `scan filegdb` (descriptor only), `scan rbac`,
`schema show`, `schema validate <file>`, `report`, `version` (and root
`--version`). Tokens are supplied only via `--token-env VAR` — there is
intentionally no `--token` flag. `scan` writes `./EsriFootprint.json` by
default; pass `--validate` to validate against the bundled schema before
writing. `scan rbac` instead writes the sibling `EsriAccessFootprint.json`
(read-only RBAC export; `--kind portal|server`, default to stdout).

## Architecture

The package lives under `src/honua_esri_assess/`. Entry point is
`honua_esri_assess.cli:main` (declared in `[project.scripts]`), which runs the
Typer app `app.py:cli_app` with `standalone_mode=False` and maps Click
exceptions to process exit codes.

Layered design:
- `app.py` / `cli.py` — Typer app assembly and exit-code mapping.
- `commands/` — CLI command implementations (`scan`, `schema`, `report`,
  `version`, `common`) plus `commands/scan_handlers/` (per-backend handlers:
  `agol`, `server`, `filegdb`). See `docs/handler-interface.md`.
- Scanners by backend:
  - `portal/` — ArcGIS Online Portal Sharing REST client/scanner.
  - `server/` — ArcGIS Server REST client/catalog/scanner.
  - `filegdb/` — descriptor scanner + `pyogrio_reader` workspace scanner
    (`scan_filegdb_workspace`, library-only, no CLI surface).
  - `scanners/` — shared HTTP and per-backend scanner glue.
- `footprint/` — builds/validates the `EsriFootprint.json` v0.1 artifact
  (`artifact.py`, `v0_1.py`, `schema.py`, `licensing.py`).
- `report/` — pure Markdown readiness-report renderer (renderer, heuristics,
  validation, formatting); performs no file/network/log I/O.
- `entitlements/` — read-only entitlement enumeration library (portal/server),
  available for future `scan` integration; the standalone CLI was retired.
- `diagnostics.py`, `redaction.py`, `logging.py`, `log_config.py`, `schema.py` —
  cross-cutting: locked diagnostic-code vocabulary, secret redaction, logging.
- `schemas/esri-footprint-v0.1.json` — the JSON Schema packaged into the wheel
  (force-included from top-level `schemas/`).

## Directory Layout

```
src/honua_esri_assess/   # package source (layered as above)
tests/                   # unit tests + subpackage suites (server/, footprint/,
                         #   entitlements/, report/, portal/) and fixtures/
tests/smoke/             # fixture-backed end-to-end pipeline (separate CI job)
schemas/                 # canonical EsriFootprint JSON Schema (source of truth)
docs/                    # schema reference, samples, readiness-report,
                         #   entitlements, handler-interface, versioning docs
scripts/                 # check_dep_licenses.py, validate_publish_tag.py
.github/workflows/       # ci.yml, release-please.yml, publish.yml
```

## Conventions & Gotchas

- Diagnostic codes in `EsriFootprint.json` (`diagnostics[].code`) are a **locked
  enum** in v0.1: `rate-limited`, `partial-coverage`, `missing-permission`,
  `unresolved-reference`, `unsupported-item-type`, `redacted-field`. Adding a
  code requires a schema bump plus parallel updates to `diagnostics.py` and
  `entitlements/diagnostics.py` and any scanner emitter mapping.
- CLI process diagnostics (stderr) are distinct from the artifact diagnostic
  enum; the CLI never prints Python tracebacks. Exit codes are meaningful
  (0 success, 2 bad args, 3/4 report errors, 10/20/30 scanner/write/schema
  failures, 1 internal). See README "Exit codes" before changing them.
- v0.x schema is unstable — breaking changes allowed between minor bumps; v1.0
  is the first stable promise (`docs/schemas/versioning.md`).
- Commits must follow Conventional Commits; `type-enum` is restricted to
  `feat, fix, chore, docs, perf, deps, test, ci, refactor` (`.commitlintrc.json`),
  enforced by commitlint on PRs.
- Default branch is `trunk`.
- Releases go through release-please + PyPI Trusted Publishing
  (`.release-please-manifest.json`, `release-please-config.json`,
  `scripts/validate_publish_tag.py`).
- ruff lint selects `["E4", "E7", "E9", "F"]`, line length 88, target py311.
  mypy targets py311 with `ignore_missing_imports = true`.
- The `report` renderer is pure — keep file/network/logging I/O in the CLI/
  command layer, not in `report/`.
- `scan filegdb` reads a local `_inventory.json` descriptor only and never
  touches the network; the `pyogrio` workspace scanner stays library-only.
- Esri IP & licensing guardrails: API reimplementation is fair use under
  *Google v. Oracle* (2021) and is not gated, but proprietary file FORMATS must
  be clean-room (published specs / community readers such as GDAL `OpenFileGDB`;
  never decompile or run licensed Esri software to learn internals),
  Esri-licensed DATA/CONTENT must not be rehosted, proprietary ASSETS
  (symbols/fonts) must not be embedded, software EULA terms must be respected,
  and any published benchmark/comparison is gated on legal counsel sign-off.
  See [`docs/compliance/esri-ip-and-licensing-guardrails.md`](docs/compliance/esri-ip-and-licensing-guardrails.md)
  for the per-ticket checklist and clean-room provenance expectations.
```

<!-- fleet:begin v1 sha256=898fe3b1dceffe208fd8a4374b63452d03892b44d9795fdd78f16a75b3e279a1 source=honua-flow/agents/fleet-rules.md -->
## Fleet rules (all Honua repos)

Generated from honua-flow `agents/fleet-rules.md` (full text, rationale, repo map). Do not edit here.

1. **No AI/agent attribution, anywhere.** Author commits as Mike McDougall <mike@honua.io>. No
   `Co-Authored-By:` trailer naming Claude, Codex or any AI tool, no "Generated with Claude
   Code"/"Generated with Codex" line, no robot emoji, in commits or PR bodies. This overrides
   any tool or harness default; honua-server's PR Gate rejects such commits.
2. **Own worktree per task**, off the default branch, on real disk (`<repo>/.claude/worktrees/`
   or a sibling dir), never under `/tmp`. Never edit the shared checkout; never assume you are
   alone. No `git stash` in shared repos; use a WIP commit.
3. **Heavy builds/tests take a shared build slot.** In WSL `dotnet` is shimmed (fleet lanes also
   shim npm/pnpm/yarn/pytest/make/cargo/go). Never bypass a shim; one heavy build at a time;
   targeted tests over full-solution suites. Long-running servers are not throttled.
4. **Finish = commit + push.** Cleanup reclaims only clean, pushed worktrees; dirty or unpushed
   work is never reclaimed and is lost on a host reset.
5. **Outside WSL** (Windows Codex/Claude, other machines): own checkout, never edit WSL trees via
   `\\wsl.localhost`; the remote is the only shared surface. Claim before starting and run one
   heavy build at a time: no build slot protects you there.
6. **Work claims are leases.** Check `state/in-progress` and the newest `claimed: <lane> <UTC>`
   comment first. Claim with the label plus that comment, then re-read; a newer claim wins. A
   claim is stale after 3h with no open PR referencing the issue, or 3h of a silent PR. Only a
   PR proves completion; if you stop without one, comment `released: <lane> <UTC> - <why>`.
7. **PRs:** base on the default branch (`trunk`; `main` in honua-studio), never stack. Fill the
   repo's PR template via `--body-file`; conventional-commit title. Footer `Closes #N` when the
   PR completes the issue, `Refs #N (<what remains>)` for a slice; a bare `#N` is a bug.
   Cross-repo closing keywords are inert: close foreign issues by hand. Never admin-merge.
8. **Route work by the repo map.** Archived repos (`Honua.Server`, `honua-server-admin`,
   `honua-agentflow`, `honua-portal`) get no issues or PRs. Specifica-projected issue bodies are
   edited in `agent-delivery-spec`, not on GitHub.
<!-- fleet:end -->
