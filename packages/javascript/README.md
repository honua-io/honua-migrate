# @honua/honua-migrate

JavaScript scanning, codemods, content migration, reconciliation, and reports
for moving ArcGIS applications and content to Honua.

Install the package and use the JavaScript-specific command:

```sh
npm install --save-dev @honua/honua-migrate
npx honua-js-migrate scan ./src
npx honua-js-migrate codemod ./src --write --report migration-report.json
```

The JavaScript package supports Node.js 20.19 and newer.

## Reading the migration report

The `codemod` report's `readiness` is one of:

- `ready`: every discovered ArcGIS module site is in codemod scope, and every
  codemod-scoped call site migrates automatically.
- `assisted`: manual call sites or ArcGIS modules outside codemod scope remain.
  `manualTodos` and `unhandledArcGisModules` list them.
- `blocked`: the scan found SceneView/3D or advanced networking usage that the
  2D migration path does not cover.
- `no-arcgis-usage`: the scan discovered no ArcGIS module sites and no
  codemod-scoped call sites. Every gate would pass on nothing, so this is never
  reported as `ready`. Check that the path points at the application source.

`usageInventory` carries the denominators behind that verdict:

- `moduleSites` counts every ArcGIS module reference. `moduleSitesByStyle`
  splits it into static and dynamic ESM imports, CommonJS `require`, AMD
  `require`/`define` arrays, `$arcgis.import` calls, and map components
  (`<arcgis-*>` elements, plus component API calls in a file that loads no
  ArcGIS module). `handledModuleSites` plus `unsupportedModuleSites` add up to
  it. The codemod rewrites `$arcgis.import` of a module it already knows, including inside an HTML script. AMD loads, unsupported `$arcgis.import` specifiers, and map components stay as written.
- `codemodScopedCallSites` is `automaticCallSites` plus `manualCallSites`.
- `widgetRuntimeRequirements` says, per widget, whether its sites move onto a
  Honua compat widget (`honua`) or still need the classic ArcGIS widget runtime
  (`arcgis-js`), whose widgets Esri plans to begin removing at 6.0.
- `residualArcGisDependencies` lists `@arcgis/*`, `arcgis-js-api`, and
  `esri-loader` entries still declared in `package.json`; a complete Honua
  conversion removes them. `dependencyManifests` names the manifests read,
  including the nearest ancestor manifest when you scan `./src`. A manifest
  with `parsed: false` has unknown dependencies, not zero.

## Choosing a conversion mode

`conversion.modes` assesses three paths, each with `available` and a `detail`
naming what stands in its way, and `conversion.recommendedMode` picks one:

- `keep-esri-client`: leave the ArcGIS source as written and repoint the app's
  service URLs at Honua; `honua-migrate services arcgis handoff` records the
  target endpoint and layer ID mapping. Recommended when the codemod rewrites
  no file, or when the scan is `blocked`, even if some files would convert.
- `assisted-conversion`: apply the codemod where it rewrites and work through
  what it held. The migrated app still needs `@arcgis/core`, a manual port, or
  the classic widget runtime until the held sites are done.
- `complete-honua-conversion`: the migrated source imports nothing from ArcGIS,
  no call site needs a manual port and no widget needs the classic runtime.
  Remove any `residualArcGisDependencies` to drop the ArcGIS JS runtime.

`recommendedMode` is `null` when the scan found no ArcGIS usage.

`conversion.files` lists every file with ArcGIS usage, a manual call site, or a
codemod error. Each file gets a `boundary`:

- `converted`: every module site rewritten, no manual call site left.
- `mixed`: some sites rewritten, the rest held.
- `kept`: nothing rewritten; `--write` leaves the file's bytes untouched.
- `held`: the codemod could not read, parse or write the file and left it
  untouched.

Files are the safe incremental boundary: kept and held files never change, so
a team can ship converted files first. Each held site carries a `code`, a
`message`, and an `action`:

| Code | Why the site is held |
| --- | --- |
| `manual-call-site` | A codemod-scoped call the codemod will not guess at; carries `line` and `column`. |
| `import-left-in-place` | The module is in codemod scope, but the import is type-only, used only in type positions, or still needed by a manual call site. |
| `module-loader-not-rewritten` | An AMD `require`/`define` array or a `$arcgis.import(...)` call. |
| `map-component-not-rewritten` | An `<arcgis-*>` element, or a component API call such as `queryRelatedFeatures` in a file that does not load an ArcGIS module. |
| `widget-on-arcgis-runtime` | A widget or widget support module, such as a view model, outside codemod scope; the action names its Honua disposition. |
| `unsupported-module` | No mapping for the target, a side-effect import, or a re-export. |
| `held-file` | A read, parse or write error; the file's module sites count as unhandled. |

The `codemod` command prints the same plan as `conversion=`,
`conversionModes:` and `fileDiagnostics:`.

## Running the reviewed migration pipeline

`honua-js-migrate migrate` takes one application through scan, reviewed
codemod, dependency and configuration changes, build, browser validation and a
residual-work report. It runs the same scanner, codemod and report as the
commands above.

```sh
npx honua-js-migrate migrate ./my-app --plan ./my-app-review
npx honua-js-migrate migrate ./my-app --apply <planDigest> --install \
  --build-script build --browser-script test:browser --report ./my-app-pipeline.json
```

1. **Plan.** The codemod runs on a throwaway copy. `--plan <dir>` writes
   `migration-plan.json` and `migration.patch`, a `git apply`-compatible diff
   of every source and `package.json` change, and the command prints a
   `planDigest`. The app is not changed. Keep the plan and report outside the
   application root.
2. **Review and apply.** `--apply` takes the digest you reviewed. It plans
   again and refuses, writing nothing, when the digests differ, which means the
   application tree, target, compat import path or engine changed since review.
3. **Dependency and configuration changes.** Only `assisted-conversion` and
   `complete-honua-conversion` change files; `keep-esri-client` changes none.
   For the `honua-compat` target the plan:
   - adds `@honua/sdk-esri-compat` and its peer `@honua/sdk`, at the ranges
     this package is tested against;
   - adds `@bufbuild/protobuf`, `@connectrpc/connect` and
     `@connectrpc/connect-web` as a temporary workaround. The compat package
     imports these optional gRPC peers, and bundlers such as Vite fail without
     them even in a REST-only app
     ([honua-sdk-js#1715](https://github.com/honua-io/honua-sdk-js/issues/1715)).
     The report lists them as workarounds to remove;
   - removes `@arcgis/*`, `arcgis-js-api` and `esri-loader` from `package.json`
     only for a complete Honua conversion. An assisted conversion keeps them
     and names the files that still need them.

   It does not rewrite build configuration. A root `vite.config.*`,
   `webpack.config.*`, `tsconfig*.json` or similar file that names the ArcGIS
   runtime is listed under `configReferences`. A missing or invalid
   `package.json`, a target other than `honua-compat`, and ArcGIS packages
   declared in an ancestor manifest are listed under `holds`.
4. **Install, build and browser validation** run the app's own npm scripts.
   `--install` runs `npm install`; `--build-script` and `--browser-script`
   name scripts in the app's `package.json`. A stage that was not requested is
   reported as `not-run`, never as passed.
5. **Residual-work report.** `verdict` is `browser-validated` only when the
   build and browser scripts both passed, and `unvalidated` when nothing
   failed but either did not run. `failed` and `refused` exit with code 1.
   `arcgisRuntime` comes from a scan after apply: the ArcGIS module sites and
   dependencies left, and widget sites still on the classic runtime.
   `residualWork` lists per-file diagnostics, kept and workaround
   dependencies, configuration references, holds and stages that did not
   pass, each with an action.

The package's tests run this path on `test/fixtures/js-migration-pipeline-app`.
The migrated app builds with Vite; in headless Chromium it queries a fixture
FeatureServer, shows the two trails the app's filter selects, and makes no
request outside the page's origin.

`--max-manual-ratio` and `--max-manual-intervention-ratio` fail when their
denominator is zero, and `widgets --gate` fails when no widget usage sites
exist, where `summary.automatedPct` is `null`.

## ArcGIS widget deprecation claims

`honua-js-migrate widgets ./src` inventories classic widget usage against the
[widget survival guide](docs/widget-survival-guide.md). Its claims are pinned,
not paraphrased:

- Every classic widget is deprecated as of ArcGIS Maps SDK for JavaScript 5.0
  (February 2026); 28 of them were already deprecated in 4.32 to 4.34. Existing
  widget-based apps keep working on 5.x.
- Esri plans to begin removing widgets at 6.0, as early as Q1 2027. Removal is
  staged: a widget stays until its component no longer wraps widget code. The
  reports describe deprecation and planned removal, not breakage today.
- The deprecated-widget inventory is the 59 top-level `widgets/*` modules whose
  class typings carry `@deprecated since <version>` in `@arcgis/core@5.0.19`.
  `5.1.24` ships the same top-level widget modules. The disposition data has
  exactly one row per inventory widget.

Re-derive the inventory from a newer tarball before changing the pin:

```sh
npm pack @arcgis/core@<version>
npm run inventory:arcgis-widgets -- arcgis-core-<version>.tgz --check
```

`--check` exits non-zero and prints the difference when the tarball's widget
set no longer matches `ARCGIS_WIDGET_INVENTORY_PIN`. After updating the pin
and rows, regenerate the guide with `npm run docs:widget-guide`.

The JavaScript executable is intentionally named `honua-js-migrate`; the
unqualified `honua-migrate` command belongs to the canonical Python CLI.
