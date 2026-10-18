# Verify a migrated app against imported services

The existing migration pipeline can run an app's own browser script. That alone
does not establish that the app used imported data: a synthetic service or a
retained Esri endpoint can still make its UI look correct. The independent
`packages/javascript/upstream/scripts/verify-imported-app.mjs` observer checks
the app's requests and visible behavior against a frozen authored baseline.

This is a bounded browser observation, not a second importer or a release gate.
The existing published-.NET import producer and release consumer still own
import fidelity and candidate acceptance. A passing browser observation always
contains `qualification: false`. It does not certify a source build, a published
SDK package, a fresh conversion, native clients, or the entire import matrix.

## Prepare the existing import and app

1. Freeze the original app's source SHA and behavior checklist before conversion.
   Preserve every admitted behavior, including paging, selection, widgets and
   errors in the app's existing driver. The helper currently measures successful
   FeatureServer queries and visible DOM assertions; auth-denial or non-query
   behavior requires the existing app-specific driver and cannot be credited by
   omitting it from this helper's scope.
2. Use the existing reviewed import workflow and published SDK producer in
   `honua-release/certification/installed-clients/produce_import_fidelity.py`.
   Retain its complete `honua.dotnet-import-fidelity-receipt/v1` JSON. The helper
   requires an unambiguous `provenance.imports` mapping for the selected baseline
   service case, real PostGIS count parity, and executed non-stale
   `all_fields_diff`, `core_query_parity` and `geometry_parity` cells.
   Other cells are neither waived nor certified by this scoped prerequisite.
3. Configure the converted app through its supported configuration to use that
   mapping's exact target service and layer. Independently install and build it
   through the existing migration pipeline. Start its normal app server. The
   observer does not rewrite the app, replace requests, supply fixture responses
   or start an alternate backend.
4. Bind the reviewed browser input to the exact import receipt bytes and server
   source/image identity. Keep the original behavior baseline unchanged when
   binding a new imported endpoint. Only use run-owned targets and public test
   data; credentials never belong in these input or output files.

The input shape is `honua.imported-app-browser-input/v1`:

| Field | Meaning |
| --- | --- |
| `appId`, `originalSourceSha` | Admitted app and full original source SHA. |
| `baselineDigest` | SHA-256 of canonical `{appId, originalSourceSha, steps}`; object keys sorted, arrays preserved, UTF-8 JSON without whitespace. The exported `baselineDigest()` function computes this. Freeze it before the migrated run. |
| `importReceiptDigest` | `sha256:` plus SHA-256 of the complete retained import receipt bytes. |
| `server` | Exact `{sourceSha, image}` from the import producer; the image must include its immutable digest. |
| `serviceCase` | Existing producer baseline service case with the source-to-target mapping. |
| `appUrl` | Running app URL without credentials, query or fragment. HTTPS, or loopback HTTP. |
| `timeoutMs` | Per-operation timeout, 100–30,000 ms. There are at most 50 steps. |
| `steps` | Nonempty, uniquely named behavior steps, described below. |

Each step has `id`, `actions`, `assertions` and `queries`. The first step loads
the app; subsequent steps act on the same page. Actions use `type` (`click`,
`fill`, `selectOption`), a CSS `selector`, and `value` for fill/select. Assertions
use a unique visible CSS `selector` and exact `text`. Every step must also observe
at least one query sent by the app itself. A query declares its exact relevant
request `parameters` (including WHERE, paging and ordering parameters where
applicable) and an independently authored `expected` response projection with
`features` and `exceededTransferLimit`. Each expected feature contains all
declared attributes and geometry; add the expected `spatialReference` and other
envelope fields used by the app. Values and geometry compare exactly; only feature
order is ignored. Empty filtered pages are allowed, but duplicate, extra, missing
or altered features are not.

The helper allows the exact imported layer metadata/query endpoint and static
resources from the app's origin. It refuses other operational endpoints, external
assets, ArcGIS runtime paths and WebSockets, and blocks service workers. This
restricted profile does not silently allow public Esri basemaps. Apps requiring
such resources need an explicitly scoped driver extension before this observer
can test them. Inline bundled code is not an independently verified dependency
inventory; retain the existing installed-package/build checks for that purpose.

## Execute and retain the observation

Use the dependency installation and Chromium installation already provided by
the JavaScript migration CI workflow, or run under the shared local build
reservation. Pin the final input file's hash before starting the browser:

```sh
node packages/javascript/upstream/scripts/verify-imported-app.mjs \
  "$BROWSER_INPUT" "$IMPORT_RECEIPT" "$REVIEWED_INPUT_SHA256" "$BROWSER_OUTPUT"
```

The output path must not exist. Exit zero means all declared browser steps passed;
it is not a release qualification verdict. Failed steps stop subsequent steps,
which remain `not-run` in the denominator. The observation retains browser
version, source/image/import/baseline bindings, per-query body digests and row
counts, and the visible-step outcomes. It does not write request query strings,
credentials, returned records, console messages or raw exceptions. The app's
existing driver remains responsible for its separately scoped trace, screenshot,
performance, auth and error scenarios.

## False-success controls and remaining work

`npm run test:imported-app` runs Chromium against deliberately synthetic harness
fixtures. Controls reject a lying UI with no query, attribute/geometry loss,
extra records, an error envelope with plausible rows, incorrect visible state,
backend fallback and ArcGIS runtime requests. They also reject changed baseline,
server or import identity and unexecuted or ambiguous import mappings.
These controls prove the observer; they never stand in for a live migration.

This contributes to [migrate #152](https://github.com/honua-io/honua-migrate/issues/152)
and the [release coverage audit](https://github.com/honua-io/honua-release/issues/652).
Fresh admitted-app execution, the remaining complete behavior checklist,
published-package verification and release evidence joins still require their
own receipts. The existing exploratory/post-cut disposition and deferred
third-app expansion remain unchanged.
