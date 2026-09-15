---
type: reference
title: "The 2026.1 JavaScript migration cohort"
description: "The 2D FeatureLayer/MapView application shapes the 2026.1 ArcGIS JS migration is measured against, the verdict each gets, and what is not yet proven."
tags: [javascript, migration, arcgis]
---
# The 2026.1 JavaScript migration cohort

The `@honua/honua-migrate` JavaScript engine (scan, codemod, report) is
measured against a fixed set of application shapes for the 2026.1 release.
The cohort answers one question for a team moving off ArcGIS JS widgets: *is
an app like mine in scope, and what verdict does it get?*

Esri deprecated every classic ArcGIS JS widget as of 5.0 (some since 4.32).
Existing widget-based apps keep working on 5.x; Esri plans to begin removing
widgets at 6.0 (as early as Q1 2027). See the
[5.0 release notes](https://developers.arcgis.com/javascript/latest/v5-0/) and
the [components transition plan](https://developers.arcgis.com/javascript/latest/components-transition-plan/).

The source of truth is
[`js-migration-cohort-2026.1.json`](https://github.com/honua-io/honua-migrate/blob/trunk/packages/javascript/upstream/test/js-migration-cohort-2026.1.json).
[`migration-cohort-2026-1.test.ts`](https://github.com/honua-io/honua-migrate/blob/trunk/packages/javascript/upstream/test/migration-cohort-2026-1.test.ts)
fails when the cohort stops covering its requirements, when a member claims a
capability its source does not use, or when a member's verdict drifts from its
hand-counted expectation.

## Scope

- **In:** 4.x and 5.x ESM apps that render a `FeatureLayer` in a `MapView` and
  use a layer list, legend, search, popup, selection or measurement.
- **Out:** `SceneView` and every other 3D surface. AMD/Dojo loaders, bespoke
  widget subclasses and dynamic Portal content are 2026.2 breadth
  ([#144](https://github.com/honua-io/honua-migrate/issues/144)).

## Members

| Member | Fixture | API line | Usage pattern | Capabilities | Verdict | Recommended mode |
| --- | --- | --- | --- | --- | --- | --- |
| `typed-esm-5x` | `esri-cohort-typed-esm-app` | 5.x (`@arcgis/core ^5.0.19`) | TypeScript ESM, `.js` specifiers, two modules | layer list, legend, search, popup, selection, measurement | assisted | assisted conversion |
| `view-model-4x` | `esri-cohort-view-model-app` | 4.x (`@arcgis/core ~4.34.8`) | TypeScript ESM; widget view models drive a custom UI | layer list, legend, search, measurement | assisted | assisted conversion |
| `react-tsx` | `esri-react-map-view-app` | unpinned | React function component (`.tsx`) | layer list, legend, search, popup | ready | complete Honua conversion |
| `ops-center-esm-js` | `esri-real-sample-ops-center-app` | unpinned | JavaScript ESM, widget-heavy | layer list, legend, search, popup | ready | complete Honua conversion |
| `incident-command-esm-js` | `esri-real-sample-incident-command-app` | unpinned | JavaScript ESM, widget-heavy with editing | layer list, legend, search, popup, selection, measurement | ready | complete Honua conversion |
| `hit-test-selection` | `esri-hit-test-sample-app` | unpinned | TypeScript ESM | popup, selection | ready | complete Honua conversion |

Every member can also keep the ArcGIS JS client as written and repoint its
services at Honua. The report assesses all three modes and names what blocks
each one; see
[Choosing a conversion mode](https://github.com/honua-io/honua-migrate/blob/trunk/packages/javascript/README.md#choosing-a-conversion-mode).

"Unpinned" fixtures declare no `@arcgis/core` version; the two pinned members
carry the 4.x and 5.x claims.

## What each verdict leaves behind

- **`typed-esm-5x`**: 12 ArcGIS module sites; 8 are rewritten and 8 of 8
  constructor sites migrate automatically. `src/main.ts` converts;
  `src/selection.ts` is kept as written, with four `import-left-in-place`
  diagnostics for its type-only imports (`Graphic`, `Point`, `FeatureLayer`,
  `MapView`), and `@arcgis/core` is still a dependency. Retype that module
  against the compat classes before removing the package.
- **`view-model-4x`**: 7 module sites, 3 rewritten, so `src/main.ts` is mixed.
  Its four `widget-on-arcgis-runtime` diagnostics cover the widget view models
  (`LayerListViewModel`, `LegendViewModel`, `SearchViewModel`,
  `DistanceMeasurement2DViewModel`), which stay on the ArcGIS JS runtime. The
  custom UI they drive must be ported by hand.
- **`react-tsx`, `ops-center-esm-js`, `incident-command-esm-js`,
  `hit-test-selection`**: every ArcGIS import is rewritten; the migrated source
  imports nothing from `@arcgis/core`.

A module site counts as handled only when the codemod removed it from the
migrated source. An import whose module is in codemod scope but survives, such
as `import type MapView from "@arcgis/core/views/MapView"` or a value import
used only as a type, is reported as unhandled and holds the verdict at
assisted.

## Not yet proven by this cohort

- **Build and browser behavior.** A ready verdict is a statement about source,
  not runtime. Installed-package browser proof against a Honua service lives in
  [honua-sdk-js#1662](https://github.com/honua-io/honua-sdk-js/issues/1662);
  its driver currently runs the `esri-real-sample-*` and
  `esri-demo-feature-table-*` fixtures, not the two new cohort apps.
- **Dependency and configuration changes.** The codemod rewrites source only;
  `package.json` still declares `@arcgis/core` after migration, and the report
  lists it as a residual dependency.
- **Complete application examples and measured manual effort** across the
  cohort remain open under
  [#142](https://github.com/honua-io/honua-migrate/issues/142).
