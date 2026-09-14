# Exploratory customer onboarding

Owner: [honua-migrate #152](https://github.com/honua-io/honua-migrate/issues/152).
The four-app cohort and release requirements live in [canonical Specifica](https://github.com/honua-io/agent-delivery-spec/pull/50).
This directory starts the learning loop; it is not a complete E2E qualification harness.
See [the first-run report](run-001.md), [pinned inputs and outcomes](run-001.json)
and [measured command stages](run-001-metrics.json).

The latest [run-004 report](run-004.md) records fresh Editor/helicopter imports,
dimensional, calendar-date and feature-type fixes, browser observations and remaining service gaps.
The first-run sections below describe their historical environment and limitations.

## Backend reuse

Keep two independently labelled backend modes:

- `fresh-import`: new run-owned database/configuration, service import and reconciliation.
- `snapshot-restore`: isolated writable restore of a previously reconciled database and Honua configuration. Record the snapshot identity and restore time; do not count this as fresh-import evidence.

Fresh agent conversion starts from original source in either backend mode. Previous converted solutions belong only to deterministic replay. Save failed attempts, not just the best result.

A local database dump and private configuration/cache checkpoint now support
recovery and continued exploration. Snapshot restore and attachment completeness
still require qualification before this becomes an admitted backend baseline.

A future snapshot manifest must bind source inventory/data profile, imported ID mapping, database/PostGIS schema version, server image digest, importer version, configuration and style digests, authorization scope and fidelity receipt. Invalidate incompatible snapshots, keep periodic fresh imports, and separate import, restore and app conversion costs. Editing attempts each receive an isolated writable restore. Restore SQL/configuration together; include attachment/object-store assets when present. Credentials, private signing keys and encryption key material remain outside portable snapshots and must be re-provisioned consistently with encrypted configuration. Do not share a mutable target across editing attempts.

## Local stack

`compose.yml` binds Honua only to loopback port 18613 and uses a separate Compose project. It does not publish PostgreSQL or Redis ports. The server image is pinned; resolve and record PostgreSQL/Redis image digests before qualification. Create `.local/stack.env` with unique `ONBOARDING_DB_PASSWORD`, `ONBOARDING_ADMIN_PASSWORD` (at least 32 characters with upper/lower/digit/symbol), `ONBOARDING_MASTER_KEY`, `ONBOARDING_SALT` and optional `ONBOARDING_PORT`. Follow server documentation for valid encryption-key formats. All local state is ignored by git.

```powershell
docker compose --project-name honua-onboarding-20260913 --env-file experiments/onboarding/.local/stack.env -f experiments/onboarding/compose.yml up -d
```

Validate health, authentication and the `import.geoservices` entitlement before applying plans. The tested server gates service import on Enterprise. A valid Pro license is insufficient. `compose.licensed.yml` optionally mounts a local test license and its public verification key; it never mounts the signing key. The first run used the publisher's documented license-mint tool with a fresh key trusted only by this local server and a seven-day test license. This is publisher testing, not a substitute for a supported customer evaluation flow. Never change other agents' containers or trust stores.

Use `honua-migrate services arcgis plan` to create reviewable plans, then `apply --yes` within the authorized isolated target. Pass credentials through environment variables, never command arguments. Persist returned job IDs and GET-poll existing jobs; do not requeue because a response is slow. First-run evidence shows numeric terminal statuses are not yet recognized by the CLI.

## Native finder slice

`finder-slice/` is newly authored exploratory code informed by the pinned Esri finder workflow. Original Apache-2.0 source remains in ignored local storage; no Esri code, data capture or licensed basemap is redistributed here. The slice exercises SDK `connect`, `Source.queryAll`, `mountSource`, list search, cluster filtering and selection. It is a reduced UI and cannot establish original-app parity. Map rendering remains an unresolved local harness boundary; use the SDK's supported scaffold/runtime configuration in the next attempt.

With the SDK built and its dependencies installed, and the first run's venue service present:

```powershell
$env:HONUA_EXPERIMENT_SDK_DIR = 'C:/path/to/built/honua-sdk-js'
node experiments/onboarding/finder-slice/serve.mjs
```

Open `http://127.0.0.1:18614`. This intentionally consumes workspace SDK artifacts, not an independently installed registry package. The loopback Vite server proxies only the run's venue FeatureServer route and holds the local credential on the server. Never deploy this development proxy. Final qualification requires a clean installed-package app and scoped customer authentication. Current target IDs are first-run artifacts; a fresh run must derive its own binding.

## Command receipts

```powershell
python experiments/onboarding/record.py --run run-002 --stage scan --timeout 120 -- node path/to/canonical/cli.js scan path/to/original/source
python experiments/onboarding/record.py --run run-002 --stage app-build --backend-mode snapshot-restore --snapshot sha256-reviewed-snapshot -- npm.cmd run build
python -m unittest discover -s experiments/onboarding -p test_record.py
```

The recorder writes unique local receipts and redacted logs with wall time, exit status, hashes and backend mode. A passed command is not a passed conversion or successful import. Model cost/tokens are null when unavailable. It stops the command's process tree on timeout; five focused tests cover redaction, failure preservation, Unicode output on legacy Windows consoles, nested-process timeout and required snapshot identity. It does not implement scheduling, isolated agent launch, snapshot capture/restore, reconciliation or browser acceptance. The first install exposed a Windows child-process timeout leak; the fixed recorder was tested afterward and the original failed receipt remains intact.
