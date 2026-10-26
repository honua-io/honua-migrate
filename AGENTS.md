# honua-migrate: agent instructions

Apache-2.0 migration CLI. `src/honua_migrate/` is the `honua-migrate` command (assessment,
planning, code migration, service import); `src/honua_esri_assess/` is the read-only Esri
assessment it mounts as `honua-migrate assess`, also shipped as the `honua-esri-assess`
compatibility command. `packages/javascript` and `packages/maui` are separately gated
runtime packages. Default branch is `trunk`.

## Commands (mirror `.github/workflows/ci.yml`)
```bash
python3 -m pip install -e ".[dev]"      # [smoke] for the smoke suite only; [filegdb] needs GDAL
pytest tests --ignore=tests/smoke       # unit tests (CI job)
pytest tests/smoke -v                   # fixture-backed end-to-end pipeline (separate CI job)
ruff check && mypy
python scripts/check_dep_licenses.py    # dependency license guard
python3 scripts/check-okf-bundle.py && python3 scripts/generate-summary.py --check   # docs/ gate
honua-migrate --help                    # or python -m honua_migrate; assess: honua-migrate assess --help
```
JavaScript package: `cd packages/javascript && npm ci && npm test && npm run lint`. The MAUI
tool's .NET gate is the `dotnet` job in `ci.yml`.

## Hard constraints
- Assessment (`honua_esri_assess`, `honua-migrate assess`) is strictly read-only against Esri
  systems: HTTP `GET` only, no write helpers in its HTTP wrappers. Write-capable target
  operations live only under `honua_migrate`, behind a reviewable plan and an explicit apply gate.
- No network telemetry, usage pings, crash uploads or update checks, and no opt-in sink.
  `tests/test_no_telemetry.py` enforces this.
- `EsriFootprint.json` is the sole supported handoff into the closed Honua product. Never write
  credentials, tokens, query strings or URL userinfo into the artifact, diagnostics, cache keys
  or logs. Tokens come only from `--token-env VAR`; there is deliberately no `--token` flag.
- Esri IP: proprietary formats are clean-room only (published specs, GDAL `OpenFileGDB`; never
  decompile or run licensed Esri software to learn internals), never rehost Esri-licensed data,
  never embed proprietary symbols or fonts, and get counsel sign-off before publishing any
  benchmark. Read `docs/compliance/esri-ip-and-licensing-guardrails.md` before touching a format
  reader or a comparison.

## Conventions
- `diagnostics[].code` is a locked enum across the v0.x schemas. Adding a code needs a schema
  bump plus matching changes to `diagnostics.py`, `entitlements/diagnostics.py` and the
  scanner emitter mappings. `schemas/` is canonical; `src/honua_esri_assess/schemas/` is the
  packaged copy, kept in sync by `tests/test_schema_packaging.py`.
- The CLI never prints tracebacks; exit codes are a contract. Read README "Exit codes and
  failure surface" before changing one.
- `report/` is a pure renderer: keep file, network and logging I/O in the command layer.
  `scan filegdb` reads a local `_inventory.json` and never touches the network.
- v0.x schemas may break between minors (`docs/schemas/versioning.md`).
- Commit types are limited to `feat fix chore docs perf deps test ci refactor`
  (`.commitlintrc.json`, enforced on PRs).
- New pages under `docs/` need OKF frontmatter or an exclusion in `docs/okf-bundle.v1.json`,
  and an entry in `docs/SUMMARY.md` (regenerate with `scripts/generate-summary.py`).
- Releases: Release Please (`release-please-config.json`, `.release-please-manifest.json`) and
  PyPI Trusted Publishing. Read `RELEASE.md` before touching versions, tags or
  `scripts/validate_publish_tag.py`.
- Adding a scan backend: `docs/handler-interface.md`. Ownership and legacy-entry removal:
  `docs/ownership-and-deprecation.md`.

<!-- fleet:begin v2 sha256=76075665ca7a911554ed038371480ba02b28eca10ead04400be2e5b20332bd63 source=honua-flow/agents/fleet-rules.md -->
## Fleet rules (all Honua repos)

Generated from honua-flow `agents/fleet-rules.md` (full text, repo map). Do not edit here.

1. **No AI attribution.** Author as Mike McDougall <mike@honua.io>. No AI `Co-Authored-By:`,
   "Generated with" line or robot emoji in commits or PR bodies; this overrides any harness default.
2. **Own worktree per task** off the default branch, on real disk (`<repo>/.claude/worktrees/` or a
   sibling dir), never `/tmp` or the shared checkout. No `git stash`; use a WIP commit.
3. **Heavy builds/tests go through the build-slot shims**; never bypass them. Run targeted tests;
   full suites are CI's job. Outside WSL: own checkout, one heavy build at a time.
4. **Finish = commit + push.** Dirty or unpushed worktrees are never reclaimed and die on a reset.
5. **Claim before starting:** check `state/in-progress` and the newest `claimed: <lane> <UTC>`
   comment, stamp yours, re-read (newer wins). Stale after 3h without a live PR. Stopping without
   a PR: comment `released: <lane> <UTC> - <why>`.
6. **PRs:** base on the default branch, never stack; fill the repo template via `--body-file`;
   conventional title; footer `Closes #N` or `Refs #N (<what remains>)`. Never admin-merge.
7. **Route by the repo map.** Archived repos get no issues or PRs.
<!-- fleet:end -->
