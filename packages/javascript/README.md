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
  `require`/`define` arrays, and `$arcgis.import` calls, and
  `handledModuleSites` plus `unsupportedModuleSites` add up to it. The codemod
  leaves AMD and `$arcgis.import` loads as written.
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
| `widget-on-arcgis-runtime` | A widget or widget support module, such as a view model, outside codemod scope; the action names its Honua disposition. |
| `unsupported-module` | No mapping for the target, a side-effect import, or a re-export. |
| `held-file` | A read, parse or write error; the file's module sites count as unhandled. |

The `codemod` command prints the same plan as `conversion=`,
`conversionModes:` and `fileDiagnostics:`.

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
