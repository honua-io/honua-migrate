---
type: reference
title: "ArcGIS widget-removal survival guide"
description: "Every deprecated ArcGIS JS SDK widget, what replaces it in Honua, and whether the migration is automated, shimmed, hand-written or has no equivalent yet."
resource: "https://www.npmjs.com/package/@honua/honua-migrate"
tags: [migration, arcgis, widgets, reference, generated]
---
<!-- GENERATED FILE - DO NOT EDIT.
     Source of truth: upstream/src/migration/widget-dispositions.ts
     Regenerate with: npm run docs:widget-guide -->

# ArcGIS widget-removal survival guide

Every classic ArcGIS JS widget is deprecated as of 5.0 (some since 4.32), and existing widget-based apps keep working on 5.x. Esri plans to begin removing widgets at 6.0 (as early as Q1 2027), each once its component no longer wraps widget code.

This guide answers, for each deprecated widget (`esri/widgets/*` / `@arcgis/core/widgets/*`), what happens if you migrate to Honua/MapLibre instead of rewriting onto Esri's web components. Dispositions are deliberately honest — including "no equivalent" — in the spirit of the [migration punch list](https://github.com/honua-io/honua-sdk-js/blob/trunk/docs/migration-punch-list.md).

This document is generated from the versioned disposition data in [`upstream/src/migration/widget-dispositions.ts`](https://github.com/honua-io/honua-migrate/blob/javascript-v0.1.3-beta.0/packages/javascript/upstream/src/migration/widget-dispositions.ts) (v1.1.0); the `honua-js-migrate widgets` scanner consumes the same data, so the scanner report and this guide cannot drift apart.

## Pinned sources

- Deprecated-widget inventory: [`@arcgis/core@5.0.19`](https://www.npmjs.com/package/@arcgis/core/v/5.0.19), integrity `sha512-OciZxzB16sTxtyfESqjuTC6rkMpwcmAzx2iQip3r1NE0IW869Eo5beyonILcHGCx9werUUd/5UhgmOI9MlX4lw==`, derived 2026-09-14.
- Method: Top-level package/widgets/<Name>.js modules whose package/widgets/<Name>.d.ts class JSDoc carries `@deprecated since <version>`. That yields 59 widgets, one row each below.
- Deprecated since: 12 in 4.32, 9 in 4.33, 7 in 4.34, 31 in 5.0.
- Top-level modules left out: `FovOverlay` (untyped), `PanoramicVideoViewer` (untyped), `PanoramicViewer` (untyped), `Spinner` (untyped), `Widget` (not-deprecated).
- Lifecycle statement: <https://developers.arcgis.com/javascript/latest/v5-0/>, <https://developers.arcgis.com/javascript/latest/components-transition-plan/>.
- Re-derive the inventory with `npm run inventory:arcgis-widgets -- <tarball> --check`.

## Scan your app first

```bash
# Human-readable table (also: --json, --markdown, --gate <pct>, --report <file>)
npx honua-js-migrate widgets ./src
```

The report inventories every widget usage site (ESM imports, AMD `require([...])` arrays, and dynamic `$arcgis.import(...)` specifiers), joins each row to the disposition below, and emits an overall automated/assisted/manual split ahead of the removals planned from 6.0. `--gate <pct>` makes CI fail when the automated share drops below the threshold, or when no widget usage sites exist.

## Disposition taxonomy

- **Automated** (`automated`): The `honua-js-migrate` codemod deterministically rewrites the import and safe constructor call sites to a Honua compat shim from `@honua/sdk-esri-compat`. Unsafe option literals fall through to an annotated manual TODO.
- **Compat shim** (`compat-shim`): A Honua compat shim exists and the codemod rewrites to it, but the widget carries a large interaction surface. Treat the migration as assisted and verify app-specific behavior by hand.
- **App platform** (`app-platform`): A native Honua app-platform element ships for this capability. (Reserved: no widget currently carries this disposition in this data version.)
- **MapLibre plugin** (`maplibre-plugin`): The capability is served by a MapLibre control or community plugin wired up by hand. (Reserved: no widget currently carries this disposition; several `automated` rows note the MapLibre-native control underneath.)
- **Manual workaround** (`manual-workaround`): No drop-in replacement and no codemod rewrite. The row documents an explicit, honest workaround that is real app work you own.
- **No equivalent** (`no-equivalent`): No Honua or MapLibre surface reproduces the widget today. Apps that depend on it need a product decision, not a rewrite.

Readiness buckets: `automated` counts as automated; `compat-shim`, `app-platform`, and `maplibre-plugin` count as assisted; `manual-workaround` and `no-equivalent` count as manual.

A compat-backed row may also list a direct `@honua/app-platform` component. That component is the recommended destination for a deliberate UI rewrite; the disposition still describes what `honua-js-migrate` can automate today.

## Summary

| Disposition | Widgets |
| --- | --- |
| `automated` | 21 |
| `compat-shim` | 11 |
| `app-platform` | 0 |
| `maplibre-plugin` | 0 |
| `manual-workaround` | 11 |
| `no-equivalent` | 16 |
| **Total** | **59** |

## Widget dispositions

| Widget | ESM module | AMD module | Disposition | Target |
| --- | --- | --- | --- | --- |
| [AreaMeasurement2D](#areameasurement2d) | `@arcgis/core/widgets/AreaMeasurement2D` | `esri/widgets/AreaMeasurement2D` | `compat-shim` | AreaMeasurement2DCompat from @honua/sdk-esri-compat |
| [AreaMeasurement3D](#areameasurement3d) | `@arcgis/core/widgets/AreaMeasurement3D` | `esri/widgets/AreaMeasurement3D` | `no-equivalent` | None. Requires 3D scene area measurement. |
| [Attachments](#attachments) | `@arcgis/core/widgets/Attachments` | `esri/widgets/Attachments` | `manual-workaround` | No drop-in widget. List a feature's attachments with FeatureLayerCompat.queryAttachments and render the list in your own UI. |
| [Attribution](#attribution) | `@arcgis/core/widgets/Attribution` | `esri/widgets/Attribution` | `automated` | AttributionCompat from @honua/sdk-esri-compat (MapLibre AttributionControl underneath) |
| [BasemapGallery](#basemapgallery) | `@arcgis/core/widgets/BasemapGallery` | `esri/widgets/BasemapGallery` | `automated` | BasemapGalleryCompat from @honua/sdk-esri-compat |
| [BasemapLayerList](#basemaplayerlist) | `@arcgis/core/widgets/BasemapLayerList` | `esri/widgets/BasemapLayerList` | `automated` | BasemapLayerListCompat from @honua/sdk-esri-compat |
| [BasemapToggle](#basemaptoggle) | `@arcgis/core/widgets/BasemapToggle` | `esri/widgets/BasemapToggle` | `automated` | BasemapToggleCompat from @honua/sdk-esri-compat |
| [BatchAttributeForm](#batchattributeform) | `@arcgis/core/widgets/BatchAttributeForm` | `esri/widgets/BatchAttributeForm` | `manual-workaround` | No drop-in widget. Edit each selected feature with FeatureFormCompat and save the batch with FeatureLayerCompat.applyEdits. |
| [Bookmarks](#bookmarks) | `@arcgis/core/widgets/Bookmarks` | `esri/widgets/Bookmarks` | `automated` | BookmarksCompat from @honua/sdk-esri-compat |
| [BuildingExplorer](#buildingexplorer) | `@arcgis/core/widgets/BuildingExplorer` | `esri/widgets/BuildingExplorer` | `no-equivalent` | None. Requires a SceneView with building scene layers. |
| [CatalogLayerList](#cataloglayerlist) | `@arcgis/core/widgets/CatalogLayerList` | `esri/widgets/CatalogLayerList` | `no-equivalent` | None. Lists the footprints and dynamic group of an ArcGIS catalog layer, which Honua does not model. |
| [Compass](#compass) | `@arcgis/core/widgets/Compass` | `esri/widgets/Compass` | `automated` | CompassCompat from @honua/sdk-esri-compat (MapLibre NavigationControl covers the same gesture natively) |
| [CoordinateConversion](#coordinateconversion) | `@arcgis/core/widgets/CoordinateConversion` | `esri/widgets/CoordinateConversion` | `compat-shim` | CoordinateConversionCompat from @honua/sdk-esri-compat |
| [Daylight](#daylight) | `@arcgis/core/widgets/Daylight` | `esri/widgets/Daylight` | `no-equivalent` | None. Requires a 3D scene with sun/shadow simulation. |
| [DirectionalPad](#directionalpad) | `@arcgis/core/widgets/DirectionalPad` | `esri/widgets/DirectionalPad` | `manual-workaround` | No drop-in widget. Wire your own pan and rotate buttons to MapViewCompat.goTo. |
| [Directions](#directions) | `@arcgis/core/widgets/Directions` | `esri/widgets/Directions` | `compat-shim` | DirectionsCompat from @honua/sdk-esri-compat backed by HonuaRouteService (RouteTask parity) |
| [DirectLineMeasurement3D](#directlinemeasurement3d) | `@arcgis/core/widgets/DirectLineMeasurement3D` | `esri/widgets/DirectLineMeasurement3D` | `no-equivalent` | None. Requires 3D scene direct-line measurement. |
| [DistanceMeasurement2D](#distancemeasurement2d) | `@arcgis/core/widgets/DistanceMeasurement2D` | `esri/widgets/DistanceMeasurement2D` | `compat-shim` | DistanceMeasurement2DCompat from @honua/sdk-esri-compat |
| [Editor](#editor) | `@arcgis/core/widgets/Editor` | `esri/widgets/Editor` | `compat-shim` | EditorCompat from @honua/sdk-esri-compat |
| [ElevationProfile](#elevationprofile) | `@arcgis/core/widgets/ElevationProfile` | `esri/widgets/ElevationProfile` | `manual-workaround` | No drop-in widget. Sample the profile geometry yourself (e.g. @honua/sdk-js/geometry densify + an elevation/terrain source such as maplibre-gl queryTerrainElevation) and chart with your own charting library. |
| [Expand](#expand) | `@arcgis/core/widgets/Expand` | `esri/widgets/Expand` | `automated` | ExpandCompat from @honua/sdk-esri-compat |
| [Feature](#feature) | `@arcgis/core/widgets/Feature` | `esri/widgets/Feature` | `automated` | FeatureCompat from @honua/sdk-esri-compat |
| [FeatureForm](#featureform) | `@arcgis/core/widgets/FeatureForm` | `esri/widgets/FeatureForm` | `compat-shim` | FeatureFormCompat from @honua/sdk-esri-compat |
| [Features](#features) | `@arcgis/core/widgets/Features` | `esri/widgets/Features` | `manual-workaround` | No drop-in widget. Page through the selected features yourself and render each one with FeatureCompat. |
| [FeatureTable](#featuretable) | `@arcgis/core/widgets/FeatureTable` | `esri/widgets/FeatureTable` | `compat-shim` | FeatureTableCompat from @honua/sdk-esri-compat |
| [FeatureTemplates](#featuretemplates) | `@arcgis/core/widgets/FeatureTemplates` | `esri/widgets/FeatureTemplates` | `automated` | FeatureTemplatesCompat from @honua/sdk-esri-compat |
| [FloorFilter](#floorfilter) | `@arcgis/core/widgets/FloorFilter` | `esri/widgets/FloorFilter` | `no-equivalent` | None. Filters floor-aware maps by ArcGIS Indoors site, facility, and level, which Honua does not model. |
| [Fullscreen](#fullscreen) | `@arcgis/core/widgets/Fullscreen` | `esri/widgets/Fullscreen` | `automated` | FullscreenCompat from @honua/sdk-esri-compat (MapLibre FullscreenControl underneath) |
| [Histogram](#histogram) | `@arcgis/core/widgets/Histogram` | `esri/widgets/Histogram` | `manual-workaround` | No drop-in widget. Compute bins from your own feature query and draw them with your charting library. |
| [HistogramRangeSlider](#histogramrangeslider) | `@arcgis/core/widgets/HistogramRangeSlider` | `esri/widgets/HistogramRangeSlider` | `manual-workaround` | No drop-in widget. Pair your own histogram chart with a range input and apply the chosen range as a layer filter. |
| [Home](#home) | `@arcgis/core/widgets/Home` | `esri/widgets/Home` | `automated` | HomeCompat from @honua/sdk-esri-compat |
| [LayerList](#layerlist) | `@arcgis/core/widgets/LayerList` | `esri/widgets/LayerList` | `automated` | LayerListCompat from @honua/sdk-esri-compat<br>Direct app-platform component: [`<honua-layer-list>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/elements.ts) from `@honua/app-platform/web-components` |
| [Legend](#legend) | `@arcgis/core/widgets/Legend` | `esri/widgets/Legend` | `automated` | LegendCompat from @honua/sdk-esri-compat<br>Direct app-platform component: [`<honua-legend>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/elements.ts) from `@honua/app-platform/web-components` |
| [LineOfSight](#lineofsight) | `@arcgis/core/widgets/LineOfSight` | `esri/widgets/LineOfSight` | `no-equivalent` | None. Requires 3D scene geometry intersection analysis. |
| [Locate](#locate) | `@arcgis/core/widgets/Locate` | `esri/widgets/Locate` | `automated` | LocateCompat from @honua/sdk-esri-compat (MapLibre GeolocateControl covers the same behavior natively) |
| [Measurement](#measurement) | `@arcgis/core/widgets/Measurement` | `esri/widgets/Measurement` | `compat-shim` | MeasurementCompat from @honua/sdk-esri-compat (2D distance/area only)<br>Direct app-platform component: [`<honua-measurement>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/measurement.ts) from `@honua/app-platform/web-components` |
| [NavigationToggle](#navigationtoggle) | `@arcgis/core/widgets/NavigationToggle` | `esri/widgets/NavigationToggle` | `no-equivalent` | None. Toggles SceneView mouse navigation between pan and rotate; MapLibre 2D navigation has no such mode. |
| [OrientedImageryViewer](#orientedimageryviewer) | `@arcgis/core/widgets/OrientedImageryViewer` | `esri/widgets/OrientedImageryViewer` | `no-equivalent` | None. Browses images from an ArcGIS oriented imagery layer, which Honua does not serve. |
| [Popup](#popup) | `@arcgis/core/widgets/Popup` | `esri/widgets/Popup` | `automated` | PopupCompat from @honua/sdk-esri-compat |
| [Print](#print) | `@arcgis/core/widgets/Print` | `esri/widgets/Print` | `compat-shim` | PrintCompat from @honua/sdk-esri-compat |
| [ScaleBar](#scalebar) | `@arcgis/core/widgets/ScaleBar` | `esri/widgets/ScaleBar` | `automated` | ScaleBarCompat from @honua/sdk-esri-compat (MapLibre ScaleControl underneath) |
| [ScaleRangeSlider](#scalerangeslider) | `@arcgis/core/widgets/ScaleRangeSlider` | `esri/widgets/ScaleRangeSlider` | `manual-workaround` | No drop-in widget. Drive FeatureLayerCompat.setScaleRange from your own control. |
| [Search](#search) | `@arcgis/core/widgets/Search` | `esri/widgets/Search` | `automated` | SearchCompat from @honua/sdk-esri-compat backed by the Honua geocoding surface<br>Direct app-platform component: [`<honua-search>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/elements.ts) from `@honua/app-platform/web-components` |
| [ShadowCast](#shadowcast) | `@arcgis/core/widgets/ShadowCast` | `esri/widgets/ShadowCast` | `no-equivalent` | None. Requires a 3D scene with shadow accumulation. |
| [Sketch](#sketch) | `@arcgis/core/widgets/Sketch` | `esri/widgets/Sketch` | `compat-shim` | SketchCompat from @honua/sdk-esri-compat |
| [Slice](#slice) | `@arcgis/core/widgets/Slice` | `esri/widgets/Slice` | `no-equivalent` | None. Requires 3D scene slicing. |
| [Slider](#slider) | `@arcgis/core/widgets/Slider` | `esri/widgets/Slider` | `manual-workaround` | No drop-in widget. Use a native `<input type="range">` or your UI library's slider. |
| [Swipe](#swipe) | `@arcgis/core/widgets/Swipe` | `esri/widgets/Swipe` | `automated` | SwipeCompat from @honua/sdk-esri-compat |
| [TableList](#tablelist) | `@arcgis/core/widgets/TableList` | `esri/widgets/TableList` | `automated` | TableListCompat from @honua/sdk-esri-compat |
| [TimeSlider](#timeslider) | `@arcgis/core/widgets/TimeSlider` | `esri/widgets/TimeSlider` | `compat-shim` | TimeSliderCompat from @honua/sdk-esri-compat |
| [TimeZoneLabel](#timezonelabel) | `@arcgis/core/widgets/TimeZoneLabel` | `esri/widgets/TimeZoneLabel` | `manual-workaround` | No drop-in widget. Show the time zone yourself, e.g. from Intl.DateTimeFormat().resolvedOptions().timeZone. |
| [Track](#track) | `@arcgis/core/widgets/Track` | `esri/widgets/Track` | `automated` | TrackCompat from @honua/sdk-esri-compat |
| [UtilityNetworkAssociations](#utilitynetworkassociations) | `@arcgis/core/widgets/UtilityNetworkAssociations` | `esri/widgets/UtilityNetworkAssociations` | `no-equivalent` | None. Manages ArcGIS Utility Network associations. |
| [UtilityNetworkTrace](#utilitynetworktrace) | `@arcgis/core/widgets/UtilityNetworkTrace` | `esri/widgets/UtilityNetworkTrace` | `no-equivalent` | None. Runs ArcGIS Utility Network named trace configurations. |
| [UtilityNetworkValidateTopology](#utilitynetworkvalidatetopology) | `@arcgis/core/widgets/UtilityNetworkValidateTopology` | `esri/widgets/UtilityNetworkValidateTopology` | `no-equivalent` | None. Validates ArcGIS Utility Network dirty areas. |
| [ValuePicker](#valuepicker) | `@arcgis/core/widgets/ValuePicker` | `esri/widgets/ValuePicker` | `manual-workaround` | No drop-in widget. Build your own previous/play/next control; for stepping a time extent, TimeSliderCompat already covers time-aware layers. |
| [VideoPlayer](#videoplayer) | `@arcgis/core/widgets/VideoPlayer` | `esri/widgets/VideoPlayer` | `no-equivalent` | None. Plays an ArcGIS video layer with its map footprint, which Honua does not serve. |
| [Weather](#weather) | `@arcgis/core/widgets/Weather` | `esri/widgets/Weather` | `no-equivalent` | None. Requires a 3D scene atmosphere/weather renderer. |
| [Zoom](#zoom) | `@arcgis/core/widgets/Zoom` | `esri/widgets/Zoom` | `automated` | ZoomCompat from @honua/sdk-esri-compat (MapLibre NavigationControl underneath) |

## Per-widget details

### AreaMeasurement2D

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/AreaMeasurement2D`, `esri/widgets/AreaMeasurement2D`
- Target: AreaMeasurement2DCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/measurement-2d.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/measurement-2d.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS.

### AreaMeasurement3D

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/AreaMeasurement3D`, `esri/widgets/AreaMeasurement3D`
- Target: None. Requires 3D scene area measurement.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### Attachments

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Attachments`, `esri/widgets/Attachments`
- Target: No drop-in widget. List a feature's attachments with FeatureLayerCompat.queryAttachments and render the list in your own UI.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. Attachment upload, delete, and keyword filtering are app code you write against the service.

### Attribution

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Attribution`, `esri/widgets/Attribution`
- Target: AttributionCompat from @honua/sdk-esri-compat (MapLibre AttributionControl underneath)
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### BasemapGallery

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/BasemapGallery`, `esri/widgets/BasemapGallery`
- Target: BasemapGalleryCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/basemap-gallery.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/basemap-gallery.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### BasemapLayerList

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/BasemapLayerList`, `esri/widgets/BasemapLayerList`
- Target: BasemapLayerListCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/basemap-layer-list.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/basemap-layer-list.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### BasemapToggle

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/BasemapToggle`, `esri/widgets/BasemapToggle`
- Target: BasemapToggleCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### BatchAttributeForm

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/BatchAttributeForm`, `esri/widgets/BatchAttributeForm`
- Target: No drop-in widget. Edit each selected feature with FeatureFormCompat and save the batch with FeatureLayerCompat.applyEdits.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. Multi-feature field grouping, validation summaries, and partial-failure handling are yours to build.

### Bookmarks

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/Bookmarks`, `esri/widgets/Bookmarks`
- Target: BookmarksCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/bookmarks.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/bookmarks.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### BuildingExplorer

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/BuildingExplorer`, `esri/widgets/BuildingExplorer`
- Target: None. Requires a SceneView with building scene layers.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### CatalogLayerList

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/CatalogLayerList`, `esri/widgets/CatalogLayerList`
- Target: None. Lists the footprints and dynamic group of an ArcGIS catalog layer, which Honua does not model.
- Notes: The widget only works with an ArcGIS-specific layer or information model that Honua does not serve today, so there is nothing to point it at after migration. Apps that depend on it need a product decision, not a code rewrite.

### Compass

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Compass`, `esri/widgets/Compass`
- Target: CompassCompat from @honua/sdk-esri-compat (MapLibre NavigationControl covers the same gesture natively)
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### CoordinateConversion

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/CoordinateConversion`, `esri/widgets/CoordinateConversion`
- Target: CoordinateConversionCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/coordinate-conversion.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/coordinate-conversion.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Custom coordinate formats beyond the built-in set are not reproduced.

### Daylight

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/Daylight`, `esri/widgets/Daylight`
- Target: None. Requires a 3D scene with sun/shadow simulation.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### DirectionalPad

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/DirectionalPad`, `esri/widgets/DirectionalPad`
- Target: No drop-in widget. Wire your own pan and rotate buttons to MapViewCompat.goTo.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. The ArcGIS widget is MapView-only, so the workaround covers the same 2D surface.

### Directions

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Directions`, `esri/widgets/Directions`
- Target: DirectionsCompat from @honua/sdk-esri-compat backed by HonuaRouteService (RouteTask parity)
- Compat shim source: [`src/esri-compat/directions.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/directions.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Only RouteTask-backed routing is shimmed; service-area, closest-facility, and OD-cost-matrix flows remain unsupported (docs/migration-punch-list.md, parity gap 3).

### DirectLineMeasurement3D

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/DirectLineMeasurement3D`, `esri/widgets/DirectLineMeasurement3D`
- Target: None. Requires 3D scene direct-line measurement.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### DistanceMeasurement2D

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/DistanceMeasurement2D`, `esri/widgets/DistanceMeasurement2D`
- Target: DistanceMeasurement2DCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/measurement-2d.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/measurement-2d.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS.

### Editor

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Editor`, `esri/widgets/Editor`
- Target: EditorCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/editor.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/editor.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Attribute + geometry editing against feature services works; advanced form elements and utility-network editing do not.

### ElevationProfile

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/ElevationProfile`, `esri/widgets/ElevationProfile`
- Target: No drop-in widget. Sample the profile geometry yourself (e.g. @honua/sdk-js/geometry densify + an elevation/terrain source such as maplibre-gl queryTerrainElevation) and chart with your own charting library.
- Notes: There is no ElevationProfile shim and no automated rewrite. The workaround is honest but real work: profile sampling, unit handling, and chart UX are app code you own after migration.

### Expand

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/Expand`, `esri/widgets/Expand`
- Target: ExpandCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/expand.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/expand.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### Feature

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/Feature`, `esri/widgets/Feature`
- Target: FeatureCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/feature.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/feature.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### FeatureForm

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/FeatureForm`, `esri/widgets/FeatureForm`
- Target: FeatureFormCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/feature-form.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/feature-form.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Arcade-driven form expressions are not evaluated.

### Features

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/Features`, `esri/widgets/Features`
- Target: No drop-in widget. Page through the selected features yourself and render each one with FeatureCompat.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. Paging controls, selection sync with the view, and action menus are app code you own.

### FeatureTable

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/FeatureTable`, `esri/widgets/FeatureTable`
- Target: FeatureTableCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/feature-table.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/feature-table.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Related-records and popup interaction flows are exercised by the demo fixtures; column virtualization and attachment editing differ from ArcGIS.

### FeatureTemplates

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/FeatureTemplates`, `esri/widgets/FeatureTemplates`
- Target: FeatureTemplatesCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/feature-templates.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/feature-templates.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### FloorFilter

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/FloorFilter`, `esri/widgets/FloorFilter`
- Target: None. Filters floor-aware maps by ArcGIS Indoors site, facility, and level, which Honua does not model.
- Notes: The widget only works with an ArcGIS-specific layer or information model that Honua does not serve today, so there is nothing to point it at after migration. Apps that depend on it need a product decision, not a code rewrite.

### Fullscreen

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Fullscreen`, `esri/widgets/Fullscreen`
- Target: FullscreenCompat from @honua/sdk-esri-compat (MapLibre FullscreenControl underneath)
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### Histogram

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Histogram`, `esri/widgets/Histogram`
- Target: No drop-in widget. Compute bins from your own feature query and draw them with your charting library.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. ArcGIS smart-mapping statistics are not reproduced, so bin boundaries must be computed by the app.

### HistogramRangeSlider

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/HistogramRangeSlider`, `esri/widgets/HistogramRangeSlider`
- Target: No drop-in widget. Pair your own histogram chart with a range input and apply the chosen range as a layer filter.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. Smart-mapping statistics and the widget's filter-expression helpers are not reproduced.

### Home

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Home`, `esri/widgets/Home`
- Target: HomeCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### LayerList

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/LayerList`, `esri/widgets/LayerList`
- Target: LayerListCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/layer-list.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/layer-list.ts) in honua-sdk-js
- Direct app-platform component: [`<honua-layer-list>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/elements.ts) from `@honua/app-platform/web-components`
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

App-platform usage (the module import auto-registers the element):

```ts
import "@honua/app-platform/web-components";
```

```html
<honua-map id="map"></honua-map>
<honua-layer-list for="map"></honua-layer-list>
```

### Legend

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.34
- Modules: `@arcgis/core/widgets/Legend`, `esri/widgets/Legend`
- Target: LegendCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/legend.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/legend.ts) in honua-sdk-js
- Direct app-platform component: [`<honua-legend>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/elements.ts) from `@honua/app-platform/web-components`
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

App-platform usage (the module import auto-registers the element):

```ts
import "@honua/app-platform/web-components";
```

```html
<honua-map id="map"></honua-map>
<honua-legend for="map"></honua-legend>
```

### LineOfSight

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/LineOfSight`, `esri/widgets/LineOfSight`
- Target: None. Requires 3D scene geometry intersection analysis.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### Locate

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Locate`, `esri/widgets/Locate`
- Target: LocateCompat from @honua/sdk-esri-compat (MapLibre GeolocateControl covers the same behavior natively)
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### Measurement

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Measurement`, `esri/widgets/Measurement`
- Target: MeasurementCompat from @honua/sdk-esri-compat (2D distance/area only)
- Compat shim source: [`src/esri-compat/measurement.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/measurement.ts) in honua-sdk-js
- Direct app-platform component: [`<honua-measurement>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/measurement.ts) from `@honua/app-platform/web-components`
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. 3D measurement modes are not supported.

App-platform usage (the module import auto-registers the element):

```ts
import "@honua/app-platform/web-components";
```

```html
<honua-map id="map"></honua-map>
<honua-measurement for="map"></honua-measurement>
```

### NavigationToggle

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/NavigationToggle`, `esri/widgets/NavigationToggle`
- Target: None. Toggles SceneView mouse navigation between pan and rotate; MapLibre 2D navigation has no such mode.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### OrientedImageryViewer

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/OrientedImageryViewer`, `esri/widgets/OrientedImageryViewer`
- Target: None. Browses images from an ArcGIS oriented imagery layer, which Honua does not serve.
- Notes: The widget only works with an ArcGIS-specific layer or information model that Honua does not serve today, so there is nothing to point it at after migration. Apps that depend on it need a product decision, not a code rewrite.

### Popup

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Popup`, `esri/widgets/Popup`
- Target: PopupCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/popup.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/popup.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS. Popup actions and fieldInfos format callbacks migrate for the simple case only (docs/migration-punch-list.md, parity gap 5).

### Print

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/Print`, `esri/widgets/Print`
- Target: PrintCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/print.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/print.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Export goes through the Honua rendering pipeline, not an ArcGIS print service; custom print templates need re-authoring.

### ScaleBar

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/ScaleBar`, `esri/widgets/ScaleBar`
- Target: ScaleBarCompat from @honua/sdk-esri-compat (MapLibre ScaleControl underneath)
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### ScaleRangeSlider

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/ScaleRangeSlider`, `esri/widgets/ScaleRangeSlider`
- Target: No drop-in widget. Drive FeatureLayerCompat.setScaleRange from your own control.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. The widget's scale-preview thumbnails and region presets are not reproduced.

### Search

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/Search`, `esri/widgets/Search`
- Target: SearchCompat from @honua/sdk-esri-compat backed by the Honua geocoding surface
- Compat shim source: [`src/esri-compat/search.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/search.ts) in honua-sdk-js
- Direct app-platform component: [`<honua-search>`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/web-components/elements.ts) from `@honua/app-platform/web-components`
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS. Custom Locator sources are out of scope (Locator/Geoprocessor parity gap).

App-platform usage (the module import auto-registers the element):

```ts
import "@honua/app-platform/web-components";
```

```html
<honua-map id="map"></honua-map>
<honua-search for="map" source="incidents"></honua-search>
```

### ShadowCast

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/ShadowCast`, `esri/widgets/ShadowCast`
- Target: None. Requires a 3D scene with shadow accumulation.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### Sketch

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Sketch`, `esri/widgets/Sketch`
- Target: SketchCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/sketch.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/sketch.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Snapping and 3D sketch tools are not reproduced.

### Slice

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/Slice`, `esri/widgets/Slice`
- Target: None. Requires 3D scene slicing.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### Slider

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/Slider`, `esri/widgets/Slider`
- Target: No drop-in widget. Use a native `<input type="range">` or your UI library's slider.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. Tick configuration, thumb labels, and segment dragging are whatever your control provides.

### Swipe

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Swipe`, `esri/widgets/Swipe`
- Target: SwipeCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/swipe.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/swipe.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### TableList

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/TableList`, `esri/widgets/TableList`
- Target: TableListCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/table-list.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/table-list.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### TimeSlider

- Disposition: `compat-shim` (Compat shim)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/TimeSlider`, `esri/widgets/TimeSlider`
- Target: TimeSliderCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/time-slider.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/time-slider.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific behavior after migration. Rendering is not byte-identical to ArcGIS. Time-aware layer filtering works; stops derived from server time-info metadata should be verified per service.

### TimeZoneLabel

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/TimeZoneLabel`, `esri/widgets/TimeZoneLabel`
- Target: No drop-in widget. Show the time zone yourself, e.g. from Intl.DateTimeFormat().resolvedOptions().timeZone.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. The ArcGIS widget reads the MapView time zone; the app decides which time zone its dates use.

### Track

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Track`, `esri/widgets/Track`
- Target: TrackCompat from @honua/sdk-esri-compat
- Compat shim source: [`src/esri-compat/track.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/track.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

### UtilityNetworkAssociations

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/UtilityNetworkAssociations`, `esri/widgets/UtilityNetworkAssociations`
- Target: None. Manages ArcGIS Utility Network associations.
- Notes: Requires ArcGIS Utility Network services. Honua has no utility-network model, and utility-network editing is already outside the Editor shim. Apps that depend on it need a product decision, not a code rewrite.

### UtilityNetworkTrace

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/UtilityNetworkTrace`, `esri/widgets/UtilityNetworkTrace`
- Target: None. Runs ArcGIS Utility Network named trace configurations.
- Notes: Requires ArcGIS Utility Network services. Honua has no utility-network model, and utility-network editing is already outside the Editor shim. Apps that depend on it need a product decision, not a code rewrite.

### UtilityNetworkValidateTopology

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/UtilityNetworkValidateTopology`, `esri/widgets/UtilityNetworkValidateTopology`
- Target: None. Validates ArcGIS Utility Network dirty areas.
- Notes: Requires ArcGIS Utility Network services. Honua has no utility-network model, and utility-network editing is already outside the Editor shim. Apps that depend on it need a product decision, not a code rewrite.

### ValuePicker

- Disposition: `manual-workaround` (Manual workaround)
- Deprecated since: ArcGIS JS 5.0
- Modules: `@arcgis/core/widgets/ValuePicker`, `esri/widgets/ValuePicker`
- Target: No drop-in widget. Build your own previous/play/next control; for stepping a time extent, TimeSliderCompat already covers time-aware layers.
- Notes: There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual. Collection, label, and combobox value sources are app code you own.

### VideoPlayer

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/VideoPlayer`, `esri/widgets/VideoPlayer`
- Target: None. Plays an ArcGIS video layer with its map footprint, which Honua does not serve.
- Notes: The widget only works with an ArcGIS-specific layer or information model that Honua does not serve today, so there is nothing to point it at after migration. Apps that depend on it need a product decision, not a code rewrite.

### Weather

- Disposition: `no-equivalent` (No equivalent)
- Deprecated since: ArcGIS JS 4.33
- Modules: `@arcgis/core/widgets/Weather`, `esri/widgets/Weather`
- Target: None. Requires a 3D scene atmosphere/weather renderer.
- Notes: SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that depend on it need a product decision, not a code rewrite.

### Zoom

- Disposition: `automated` (Automated)
- Deprecated since: ArcGIS JS 4.32
- Modules: `@arcgis/core/widgets/Zoom`, `esri/widgets/Zoom`
- Target: ZoomCompat from @honua/sdk-esri-compat (MapLibre NavigationControl underneath)
- Compat shim source: [`src/esri-compat/controls.ts`](https://github.com/honua-io/honua-sdk-js/blob/trunk/src/esri-compat/controls.ts) in honua-sdk-js
- Notes: The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.

## Out of scope

These surfaces are intentionally **not** covered by the dispositions above:

- **SceneView / 3D rendering.** Honua's `SceneViewCompat` shares 2D `MapView` behavior; WebGL/CesiumJS scene parity is not implemented ([punch list, parity gaps 1-2](https://github.com/honua-io/honua-sdk-js/blob/trunk/docs/migration-punch-list.md)). The 3D widgets above are therefore `no-equivalent` rather than shimmed.
- **Geoprocessor / NetworkAnalyst beyond RouteTask.** Service-area, closest-facility, OD-cost-matrix, and general geoprocessing have no Honua widget equivalent; the scanner's `advanced-widget-or-networking-detected` flag calls these out separately ([punch list, parity gap 3](https://github.com/honua-io/honua-sdk-js/blob/trunk/docs/migration-punch-list.md)).

## Related reading

- [Migration punch list](https://github.com/honua-io/honua-sdk-js/blob/trunk/docs/migration-punch-list.md) — the honest parity/codemod accounting.
- [Reading the migration report](../README.md#reading-the-migration-report) — readiness and denominators.
