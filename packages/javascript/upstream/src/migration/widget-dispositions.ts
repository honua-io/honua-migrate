/**
 * Shared widget-disposition data for the Esri Widget Cliff workstream.
 *
 * Every classic ArcGIS JS widget (`esri/widgets/*` / `@arcgis/core/widgets/*`)
 * is deprecated as of ArcGIS Maps SDK for JavaScript 5.0. Existing widget apps
 * keep working; Esri plans to begin removing widgets at 6.0 ("as early as
 * Q1 2027"), each once its component no longer wraps widget code. This module
 * is the single source of truth consumed by both the generated survival guide
 * (`docs/widget-survival-guide.md`, via
 * `upstream/scripts/generate-widget-survival-guide.mjs`) and the widget-usage
 * scanner (`src/migration/widget-scanner.ts`). Drift between the guide and this
 * data fails `npm test`.
 *
 * Dispositions are grounded in what actually ships today:
 * - `automated` / `compat-shim` entries are backed by real shims in
 *   `@honua/sdk-esri-compat` and codemod rewrite specs in
 *   `src/migration/codemod.ts::SUPPORTED_ARCGIS_MODULE_KIND_BY_PATH`.
 * - Gaps follow the honest accounting in the honua-sdk-js migration punch list
 *   (scene/3D widgets have no equivalent; visual parity is not byte-identical).
 * - The row set is exactly the pinned deprecated-widget inventory below.
 */

/** Version of this disposition dataset. Bump when rows or taxonomy change. */
export const WIDGET_DISPOSITION_DATA_VERSION = "1.1.0";

/** ArcGIS Maps SDK for JavaScript release that deprecated every classic widget (February 2026). */
export const ARCGIS_WIDGET_DEPRECATION_RELEASE = "5.0";

/**
 * ArcGIS release at which Esri plans to *begin* removing classic widgets. Removal is staged: a
 * widget stays until its component no longer wraps widget code, so 6.0 is not a single cutoff.
 */
export const ARCGIS_WIDGET_REMOVAL_RELEASE = "6.0";

/** Esri's stated timeframe for the first widget removals. */
export const ARCGIS_WIDGET_REMOVAL_TIMEFRAME = "as early as Q1 2027";

/**
 * The precise lifecycle claim every report and the guide make. It deliberately does not say that
 * widget apps already stopped working, or that every widget disappears at once.
 */
export const ARCGIS_WIDGET_LIFECYCLE_STATEMENT = [
  `Every classic ArcGIS JS widget is deprecated as of ${ARCGIS_WIDGET_DEPRECATION_RELEASE} (some since 4.32),`,
  `and existing widget-based apps keep working on ${ARCGIS_WIDGET_DEPRECATION_RELEASE.split(".")[0]}.x.`,
  `Esri plans to begin removing widgets at ${ARCGIS_WIDGET_REMOVAL_RELEASE} (${ARCGIS_WIDGET_REMOVAL_TIMEFRAME}),`,
  "each once its component no longer wraps widget code.",
].join(" ");

export interface ArcGisWidgetInventoryExclusion {
  /** Top-level `widgets/*` module name shipped in the pinned package. */
  module: string;
  reason: "not-deprecated" | "untyped";
}

export interface ArcGisWidgetInventoryPin {
  package: "@arcgis/core";
  version: string;
  /** npm `dist.integrity` of the pinned tarball. */
  integrity: string;
  /** Date the pin was derived and the lifecycle sources were read. */
  retrieved: string;
  /** How `widgets` is derived from the tarball; `upstream/scripts/arcgis-widget-inventory.mjs` re-derives it. */
  method: string;
  /** Esri pages the lifecycle statement quotes. */
  lifecycleSources: readonly string[];
  /** ArcGIS release named by each deprecated widget's class-level `@deprecated since` tag. */
  deprecatedSince: Readonly<Record<string, string>>;
  /** Deprecated top-level widget modules, sorted (the keys of `deprecatedSince`). */
  widgets: readonly string[];
  /** Top-level modules the method leaves out, with the reason. */
  excludedModules: readonly ArcGisWidgetInventoryExclusion[];
}

const ARCGIS_WIDGET_DEPRECATED_SINCE: Readonly<Record<string, string>> = {
  AreaMeasurement2D: "5.0",
  AreaMeasurement3D: "4.33",
  Attachments: "5.0",
  Attribution: "5.0",
  BasemapGallery: "4.32",
  BasemapLayerList: "5.0",
  BasemapToggle: "4.32",
  BatchAttributeForm: "5.0",
  Bookmarks: "4.34",
  BuildingExplorer: "5.0",
  CatalogLayerList: "5.0",
  Compass: "4.32",
  CoordinateConversion: "4.34",
  Daylight: "4.34",
  DirectLineMeasurement3D: "4.33",
  DirectionalPad: "4.32",
  Directions: "5.0",
  DistanceMeasurement2D: "5.0",
  Editor: "5.0",
  ElevationProfile: "5.0",
  Expand: "4.34",
  Feature: "4.34",
  FeatureForm: "5.0",
  FeatureTable: "5.0",
  FeatureTemplates: "5.0",
  Features: "4.34",
  FloorFilter: "5.0",
  Fullscreen: "4.32",
  Histogram: "5.0",
  HistogramRangeSlider: "5.0",
  Home: "4.32",
  LayerList: "5.0",
  Legend: "4.34",
  LineOfSight: "4.33",
  Locate: "4.32",
  Measurement: "5.0",
  NavigationToggle: "4.32",
  OrientedImageryViewer: "5.0",
  Popup: "5.0",
  Print: "4.33",
  ScaleBar: "4.32",
  ScaleRangeSlider: "5.0",
  Search: "4.33",
  ShadowCast: "5.0",
  Sketch: "5.0",
  Slice: "4.33",
  Slider: "5.0",
  Swipe: "4.32",
  TableList: "5.0",
  TimeSlider: "5.0",
  TimeZoneLabel: "4.33",
  Track: "4.32",
  UtilityNetworkAssociations: "5.0",
  UtilityNetworkTrace: "5.0",
  UtilityNetworkValidateTopology: "5.0",
  ValuePicker: "5.0",
  VideoPlayer: "4.33",
  Weather: "4.33",
  Zoom: "4.32",
};

/**
 * Pinned deprecated-widget inventory. Re-derive it from a newer `@arcgis/core` tarball with
 * `npm run inventory:arcgis-widgets -- <tarball>` and update the rows together with the pin.
 * `@arcgis/core@5.1.24` ships the same top-level widget set (checked 2026-09-14).
 */
export const ARCGIS_WIDGET_INVENTORY_PIN: ArcGisWidgetInventoryPin = {
  package: "@arcgis/core",
  version: "5.0.19",
  integrity: "sha512-OciZxzB16sTxtyfESqjuTC6rkMpwcmAzx2iQip3r1NE0IW869Eo5beyonILcHGCx9werUUd/5UhgmOI9MlX4lw==",
  retrieved: "2026-09-14",
  method:
    "Top-level package/widgets/<Name>.js modules whose package/widgets/<Name>.d.ts class JSDoc carries " +
    "`@deprecated since <version>`.",
  lifecycleSources: [
    "https://developers.arcgis.com/javascript/latest/v5-0/",
    "https://developers.arcgis.com/javascript/latest/components-transition-plan/",
  ],
  deprecatedSince: ARCGIS_WIDGET_DEPRECATED_SINCE,
  widgets: Object.keys(ARCGIS_WIDGET_DEPRECATED_SINCE).sort(),
  excludedModules: [
    { module: "FovOverlay", reason: "untyped" },
    { module: "PanoramicVideoViewer", reason: "untyped" },
    { module: "PanoramicViewer", reason: "untyped" },
    { module: "Spinner", reason: "untyped" },
    { module: "Widget", reason: "not-deprecated" },
  ],
};

/** Pinned source for the deprecated-widget inventory: the exact published `@arcgis/core` release. */
export const ARCGIS_WIDGET_INVENTORY_SOURCE = `https://www.npmjs.com/package/${ARCGIS_WIDGET_INVENTORY_PIN.package}/v/${ARCGIS_WIDGET_INVENTORY_PIN.version}`;

export type WidgetDispositionKind =
  | "automated"
  | "compat-shim"
  | "app-platform"
  | "maplibre-plugin"
  | "manual-workaround"
  | "no-equivalent";

export const WIDGET_DISPOSITION_KINDS: readonly WidgetDispositionKind[] = [
  "automated",
  "compat-shim",
  "app-platform",
  "maplibre-plugin",
  "manual-workaround",
  "no-equivalent",
];

/** Migration-effort bucket used by the scanner readiness report. */
export type WidgetMigrationBucket = "automated" | "assisted" | "manual";

/** Internal documentation metadata rendered by the survival-guide generator. */
interface WidgetAppPlatformComponent {
  /** Published module that registers the custom element. */
  moduleSpecifier: "@honua/app-platform/web-components";
  /** Custom-element tag name, e.g. `honua-legend`. */
  tagName: `honua-${string}`;
  /** Repo-relative source file implementing the custom element. */
  source: string;
  /** Copyable markup for the generated survival guide. */
  usageHtml: string;
}

export interface WidgetDisposition {
  /** Widget class name, e.g. `Legend`. */
  widget: string;
  /** ESM module specifiers (`@arcgis/core/widgets/*`, without `.js`). */
  esmModules: readonly string[];
  /** Classic AMD module specifiers (`esri/widgets/*`). */
  amdModules: readonly string[];
  /** Exactly one disposition from the fixed taxonomy. */
  disposition: WidgetDispositionKind;
  /** Honua API/component target, or explicit workaround text. */
  target: string;
  /** Honest caveats; never "TBD". */
  notes: string;
  /** Repo-relative path to the compat shim source, when one exists. */
  shimSource?: string;
}

interface WidgetDispositionData extends WidgetDisposition {
  /** Direct app-platform component for teams replacing the widget instead of retaining the compat shim. */
  appPlatformComponent?: WidgetAppPlatformComponent;
}

function widgetEntry(
  widget: string,
  disposition: WidgetDispositionKind,
  target: string,
  notes: string,
  shimSource?: string,
  appPlatformComponent?: WidgetAppPlatformComponent,
): WidgetDispositionData {
  return {
    widget,
    esmModules: [`@arcgis/core/widgets/${widget}`],
    amdModules: [`esri/widgets/${widget}`],
    disposition,
    target,
    notes,
    ...(shimSource ? { shimSource } : {}),
    ...(appPlatformComponent ? { appPlatformComponent } : {}),
  };
}

function appPlatformComponent(
  tagName: `honua-${string}`,
  source: string,
  usageHtml: string,
): WidgetAppPlatformComponent {
  return {
    moduleSpecifier: "@honua/app-platform/web-components",
    tagName,
    source,
    usageHtml,
  };
}

const AUTOMATED_NOTE =
  "The honua-migrate codemod rewrites the import and safe constructor call sites deterministically; " +
  "unsafe option literals fall through to an annotated manual TODO. Rendering goes through the Honua " +
  "widget host, so CSS selectors and DOM structure are not byte-identical to ArcGIS.";

const COMPAT_SHIM_NOTE =
  "The honua-migrate codemod rewrites the import and safe constructor call sites, but the shim covers " +
  "the core workflow rather than the full ArcGIS surface — plan hands-on verification of app-specific " +
  "behavior after migration. Rendering is not byte-identical to ArcGIS.";

const SCENE_3D_NOTE =
  "SceneView/3D widget. Honua's SceneViewCompat is 2D-behavior only and no Honua or MapLibre " +
  "surface reproduces this widget today (see docs/migration-punch-list.md, parity gap 1). Apps that " +
  "depend on it need a product decision, not a code rewrite.";

const NO_REWRITE_NOTE =
  "There is no shim and no codemod rewrite for this widget, so the scanner counts its sites as manual.";

const ARCGIS_LAYER_TYPE_NOTE =
  "The widget only works with an ArcGIS-specific layer or information model that Honua does not serve today, " +
  "so there is nothing to point it at after migration. Apps that depend on it need a product decision, not a " +
  "code rewrite.";

const UTILITY_NETWORK_NOTE =
  "Requires ArcGIS Utility Network services. Honua has no utility-network model, and utility-network editing " +
  "is already outside the Editor shim. Apps that depend on it need a product decision, not a code rewrite.";

/**
 * Documentation source rows consumed by the repository guide generator.
 * This symbol is intentionally not re-exported from the public migration
 * entrypoint; scanner consumers receive the projected rows below.
 *
 * @internal
 */
export const WIDGET_DISPOSITION_DOCUMENTATION: readonly WidgetDispositionData[] = [
  // --- automated: deterministic codemod rewrite onto a compat shim ---
  widgetEntry(
    "Attribution",
    "automated",
    "AttributionCompat from @honua/sdk-esri-compat (MapLibre AttributionControl underneath)",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "BasemapGallery",
    "automated",
    "BasemapGalleryCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/basemap-gallery.ts",
  ),
  widgetEntry(
    "BasemapLayerList",
    "automated",
    "BasemapLayerListCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/basemap-layer-list.ts",
  ),
  widgetEntry(
    "BasemapToggle",
    "automated",
    "BasemapToggleCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "Bookmarks",
    "automated",
    "BookmarksCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/bookmarks.ts",
  ),
  widgetEntry(
    "Compass",
    "automated",
    "CompassCompat from @honua/sdk-esri-compat (MapLibre NavigationControl covers the same gesture natively)",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "Expand",
    "automated",
    "ExpandCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/expand.ts",
  ),
  widgetEntry(
    "Feature",
    "automated",
    "FeatureCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/feature.ts",
  ),
  widgetEntry(
    "FeatureTemplates",
    "automated",
    "FeatureTemplatesCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/feature-templates.ts",
  ),
  widgetEntry(
    "Fullscreen",
    "automated",
    "FullscreenCompat from @honua/sdk-esri-compat (MapLibre FullscreenControl underneath)",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "Home",
    "automated",
    "HomeCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "LayerList",
    "automated",
    "LayerListCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/layer-list.ts",
    appPlatformComponent(
      "honua-layer-list",
      "src/web-components/elements.ts",
      '<honua-map id="map"></honua-map>\n<honua-layer-list for="map"></honua-layer-list>',
    ),
  ),
  widgetEntry(
    "Legend",
    "automated",
    "LegendCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/legend.ts",
    appPlatformComponent(
      "honua-legend",
      "src/web-components/elements.ts",
      '<honua-map id="map"></honua-map>\n<honua-legend for="map"></honua-legend>',
    ),
  ),
  widgetEntry(
    "Locate",
    "automated",
    "LocateCompat from @honua/sdk-esri-compat (MapLibre GeolocateControl covers the same behavior natively)",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "Popup",
    "automated",
    "PopupCompat from @honua/sdk-esri-compat",
    [
      AUTOMATED_NOTE,
      "Popup actions and fieldInfos format callbacks migrate for the simple case only",
      "(docs/migration-punch-list.md, parity gap 5).",
    ].join(" "),
    "src/esri-compat/popup.ts",
  ),
  widgetEntry(
    "ScaleBar",
    "automated",
    "ScaleBarCompat from @honua/sdk-esri-compat (MapLibre ScaleControl underneath)",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  widgetEntry(
    "Search",
    "automated",
    "SearchCompat from @honua/sdk-esri-compat backed by the Honua geocoding surface",
    `${AUTOMATED_NOTE} Custom Locator sources are out of scope (Locator/Geoprocessor parity gap).`,
    "src/esri-compat/search.ts",
    appPlatformComponent(
      "honua-search",
      "src/web-components/elements.ts",
      '<honua-map id="map"></honua-map>\n<honua-search for="map" source="incidents"></honua-search>',
    ),
  ),
  widgetEntry(
    "Swipe",
    "automated",
    "SwipeCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/swipe.ts",
  ),
  widgetEntry(
    "TableList",
    "automated",
    "TableListCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/table-list.ts",
  ),
  widgetEntry(
    "Track",
    "automated",
    "TrackCompat from @honua/sdk-esri-compat",
    AUTOMATED_NOTE,
    "src/esri-compat/track.ts",
  ),
  widgetEntry(
    "Zoom",
    "automated",
    "ZoomCompat from @honua/sdk-esri-compat (MapLibre NavigationControl underneath)",
    AUTOMATED_NOTE,
    "src/esri-compat/controls.ts",
  ),
  // --- compat-shim: shim exists and the codemod rewrites to it, but the
  // widget carries a large interaction surface; expect hands-on verification ---
  widgetEntry(
    "AreaMeasurement2D",
    "compat-shim",
    "AreaMeasurement2DCompat from @honua/sdk-esri-compat",
    COMPAT_SHIM_NOTE,
    "src/esri-compat/measurement-2d.ts",
  ),
  widgetEntry(
    "CoordinateConversion",
    "compat-shim",
    "CoordinateConversionCompat from @honua/sdk-esri-compat",
    `${COMPAT_SHIM_NOTE} Custom coordinate formats beyond the built-in set are not reproduced.`,
    "src/esri-compat/coordinate-conversion.ts",
  ),
  widgetEntry(
    "Directions",
    "compat-shim",
    "DirectionsCompat from @honua/sdk-esri-compat backed by HonuaRouteService (RouteTask parity)",
    [
      COMPAT_SHIM_NOTE,
      "Only RouteTask-backed routing is shimmed; service-area, closest-facility, and OD-cost-matrix flows",
      "remain unsupported (docs/migration-punch-list.md, parity gap 3).",
    ].join(" "),
    "src/esri-compat/directions.ts",
  ),
  widgetEntry(
    "DistanceMeasurement2D",
    "compat-shim",
    "DistanceMeasurement2DCompat from @honua/sdk-esri-compat",
    COMPAT_SHIM_NOTE,
    "src/esri-compat/measurement-2d.ts",
  ),
  widgetEntry(
    "Editor",
    "compat-shim",
    "EditorCompat from @honua/sdk-esri-compat",
    [
      COMPAT_SHIM_NOTE,
      "Attribute + geometry editing against feature services works; advanced form elements and",
      "utility-network editing do not.",
    ].join(" "),
    "src/esri-compat/editor.ts",
  ),
  widgetEntry(
    "FeatureForm",
    "compat-shim",
    "FeatureFormCompat from @honua/sdk-esri-compat",
    `${COMPAT_SHIM_NOTE} Arcade-driven form expressions are not evaluated.`,
    "src/esri-compat/feature-form.ts",
  ),
  widgetEntry(
    "FeatureTable",
    "compat-shim",
    "FeatureTableCompat from @honua/sdk-esri-compat",
    [
      COMPAT_SHIM_NOTE,
      "Related-records and popup interaction flows are exercised by the demo fixtures; column",
      "virtualization and attachment editing differ from ArcGIS.",
    ].join(" "),
    "src/esri-compat/feature-table.ts",
  ),
  widgetEntry(
    "Measurement",
    "compat-shim",
    "MeasurementCompat from @honua/sdk-esri-compat (2D distance/area only)",
    `${COMPAT_SHIM_NOTE} 3D measurement modes are not supported.`,
    "src/esri-compat/measurement.ts",
    appPlatformComponent(
      "honua-measurement",
      "src/web-components/measurement.ts",
      '<honua-map id="map"></honua-map>\n<honua-measurement for="map"></honua-measurement>',
    ),
  ),
  widgetEntry(
    "Print",
    "compat-shim",
    "PrintCompat from @honua/sdk-esri-compat",
    [
      COMPAT_SHIM_NOTE,
      "Export goes through the Honua rendering pipeline, not an ArcGIS print service; custom print",
      "templates need re-authoring.",
    ].join(" "),
    "src/esri-compat/print.ts",
  ),
  widgetEntry(
    "Sketch",
    "compat-shim",
    "SketchCompat from @honua/sdk-esri-compat",
    `${COMPAT_SHIM_NOTE} Snapping and 3D sketch tools are not reproduced.`,
    "src/esri-compat/sketch.ts",
  ),
  widgetEntry(
    "TimeSlider",
    "compat-shim",
    "TimeSliderCompat from @honua/sdk-esri-compat",
    [
      COMPAT_SHIM_NOTE,
      "Time-aware layer filtering works; stops derived from server time-info metadata should be",
      "verified per service.",
    ].join(" "),
    "src/esri-compat/time-slider.ts",
  ),
  // --- manual-workaround ---
  widgetEntry(
    "ElevationProfile",
    "manual-workaround",
    "No drop-in widget. Sample the profile geometry yourself (e.g. @honua/sdk-js/geometry densify + an " +
      "elevation/terrain source such as maplibre-gl queryTerrainElevation) and chart with your own charting library.",
    "There is no ElevationProfile shim and no automated rewrite. The workaround is honest but real work: " +
      "profile sampling, unit handling, and chart UX are app code you own after migration.",
  ),
  widgetEntry(
    "Attachments",
    "manual-workaround",
    "No drop-in widget. List a feature's attachments with FeatureLayerCompat.queryAttachments and render the " +
      "list in your own UI.",
    `${NO_REWRITE_NOTE} Attachment upload, delete, and keyword filtering are app code you write against the service.`,
  ),
  widgetEntry(
    "BatchAttributeForm",
    "manual-workaround",
    "No drop-in widget. Edit each selected feature with FeatureFormCompat and save the batch with " +
      "FeatureLayerCompat.applyEdits.",
    `${NO_REWRITE_NOTE} Multi-feature field grouping, validation summaries, and partial-failure handling are yours to build.`,
  ),
  widgetEntry(
    "DirectionalPad",
    "manual-workaround",
    "No drop-in widget. Wire your own pan and rotate buttons to MapViewCompat.goTo.",
    `${NO_REWRITE_NOTE} The ArcGIS widget is MapView-only, so the workaround covers the same 2D surface.`,
  ),
  widgetEntry(
    "Features",
    "manual-workaround",
    "No drop-in widget. Page through the selected features yourself and render each one with FeatureCompat.",
    `${NO_REWRITE_NOTE} Paging controls, selection sync with the view, and action menus are app code you own.`,
  ),
  widgetEntry(
    "Histogram",
    "manual-workaround",
    "No drop-in widget. Compute bins from your own feature query and draw them with your charting library.",
    `${NO_REWRITE_NOTE} ArcGIS smart-mapping statistics are not reproduced, so bin boundaries must be computed by the app.`,
  ),
  widgetEntry(
    "HistogramRangeSlider",
    "manual-workaround",
    "No drop-in widget. Pair your own histogram chart with a range input and apply the chosen range as a layer filter.",
    `${NO_REWRITE_NOTE} Smart-mapping statistics and the widget's filter-expression helpers are not reproduced.`,
  ),
  widgetEntry(
    "ScaleRangeSlider",
    "manual-workaround",
    "No drop-in widget. Drive FeatureLayerCompat.setScaleRange from your own control.",
    `${NO_REWRITE_NOTE} The widget's scale-preview thumbnails and region presets are not reproduced.`,
  ),
  widgetEntry(
    "Slider",
    "manual-workaround",
    'No drop-in widget. Use a native `<input type="range">` or your UI library\'s slider.',
    `${NO_REWRITE_NOTE} Tick configuration, thumb labels, and segment dragging are whatever your control provides.`,
  ),
  widgetEntry(
    "TimeZoneLabel",
    "manual-workaround",
    "No drop-in widget. Show the time zone yourself, e.g. from Intl.DateTimeFormat().resolvedOptions().timeZone.",
    `${NO_REWRITE_NOTE} The ArcGIS widget reads the MapView time zone; the app decides which time zone its dates use.`,
  ),
  widgetEntry(
    "ValuePicker",
    "manual-workaround",
    "No drop-in widget. Build your own previous/play/next control; for stepping a time extent, TimeSliderCompat " +
      "already covers time-aware layers.",
    `${NO_REWRITE_NOTE} Collection, label, and combobox value sources are app code you own.`,
  ),
  // --- no-equivalent: SceneView/3D analysis widgets ---
  widgetEntry("Daylight", "no-equivalent", "None. Requires a 3D scene with sun/shadow simulation.", SCENE_3D_NOTE),
  widgetEntry("LineOfSight", "no-equivalent", "None. Requires 3D scene geometry intersection analysis.", SCENE_3D_NOTE),
  widgetEntry("ShadowCast", "no-equivalent", "None. Requires a 3D scene with shadow accumulation.", SCENE_3D_NOTE),
  widgetEntry("Slice", "no-equivalent", "None. Requires 3D scene slicing.", SCENE_3D_NOTE),
  widgetEntry("Weather", "no-equivalent", "None. Requires a 3D scene atmosphere/weather renderer.", SCENE_3D_NOTE),
  widgetEntry("AreaMeasurement3D", "no-equivalent", "None. Requires 3D scene area measurement.", SCENE_3D_NOTE),
  widgetEntry(
    "BuildingExplorer",
    "no-equivalent",
    "None. Requires a SceneView with building scene layers.",
    SCENE_3D_NOTE,
  ),
  widgetEntry(
    "DirectLineMeasurement3D",
    "no-equivalent",
    "None. Requires 3D scene direct-line measurement.",
    SCENE_3D_NOTE,
  ),
  widgetEntry(
    "NavigationToggle",
    "no-equivalent",
    "None. Toggles SceneView mouse navigation between pan and rotate; MapLibre 2D navigation has no such mode.",
    SCENE_3D_NOTE,
  ),
  widgetEntry(
    "CatalogLayerList",
    "no-equivalent",
    "None. Lists the footprints and dynamic group of an ArcGIS catalog layer, which Honua does not model.",
    ARCGIS_LAYER_TYPE_NOTE,
  ),
  widgetEntry(
    "FloorFilter",
    "no-equivalent",
    "None. Filters floor-aware maps by ArcGIS Indoors site, facility, and level, which Honua does not model.",
    ARCGIS_LAYER_TYPE_NOTE,
  ),
  widgetEntry(
    "OrientedImageryViewer",
    "no-equivalent",
    "None. Browses images from an ArcGIS oriented imagery layer, which Honua does not serve.",
    ARCGIS_LAYER_TYPE_NOTE,
  ),
  widgetEntry(
    "VideoPlayer",
    "no-equivalent",
    "None. Plays an ArcGIS video layer with its map footprint, which Honua does not serve.",
    ARCGIS_LAYER_TYPE_NOTE,
  ),
  widgetEntry(
    "UtilityNetworkAssociations",
    "no-equivalent",
    "None. Manages ArcGIS Utility Network associations.",
    UTILITY_NETWORK_NOTE,
  ),
  widgetEntry(
    "UtilityNetworkTrace",
    "no-equivalent",
    "None. Runs ArcGIS Utility Network named trace configurations.",
    UTILITY_NETWORK_NOTE,
  ),
  widgetEntry(
    "UtilityNetworkValidateTopology",
    "no-equivalent",
    "None. Validates ArcGIS Utility Network dirty areas.",
    UTILITY_NETWORK_NOTE,
  ),
];

function publicWidgetDisposition(entry: WidgetDispositionData): WidgetDisposition {
  return {
    widget: entry.widget,
    esmModules: entry.esmModules,
    amdModules: entry.amdModules,
    disposition: entry.disposition,
    target: entry.target,
    notes: entry.notes,
    ...(entry.shimSource ? { shimSource: entry.shimSource } : {}),
  };
}

/** Public scanner data with documentation-only component metadata projected out at runtime. */
export const WIDGET_DISPOSITIONS: readonly WidgetDisposition[] =
  WIDGET_DISPOSITION_DOCUMENTATION.map(publicWidgetDisposition);

const DISPOSITION_BUCKET: Readonly<Record<WidgetDispositionKind, WidgetMigrationBucket>> = {
  automated: "automated",
  "compat-shim": "assisted",
  "app-platform": "assisted",
  "maplibre-plugin": "assisted",
  "manual-workaround": "manual",
  "no-equivalent": "manual",
};

export function widgetMigrationBucket(disposition: WidgetDispositionKind): WidgetMigrationBucket {
  return DISPOSITION_BUCKET[disposition];
}

const DISPOSITIONS_BY_WIDGET: ReadonlyMap<string, WidgetDisposition> = new Map(
  WIDGET_DISPOSITIONS.map((entry) => [entry.widget, entry]),
);

export function getWidgetDisposition(widget: string): WidgetDisposition | undefined {
  return DISPOSITIONS_BY_WIDGET.get(widget);
}

/**
 * GitHub-style anchor for a widget's `### <Widget>` heading in the generated
 * survival guide. Shared by the guide generator and the scanner report so the
 * per-widget report rows deep-link into the guide.
 */
export function widgetSurvivalGuideAnchor(widget: string): string {
  return widget.toLowerCase();
}

/** Repo-relative path of the generated survival guide. */
export const WIDGET_SURVIVAL_GUIDE_PATH = "docs/widget-survival-guide.md";

/**
 * Extracts the widget name from a module specifier when it addresses a classic
 * widget module (`@arcgis/core/widgets/*` or `esri/widgets/*`), including
 * support modules such as `@arcgis/core/widgets/Search/SearchViewModel`.
 */
export function widgetNameFromModulePath(modulePath: string): string | undefined {
  return widgetModulePathInfo(modulePath)?.widget;
}

export interface WidgetModulePathInfo {
  widget: string;
  /**
   * True when the specifier addresses a widget *support* module (for example
   * `@arcgis/core/widgets/Search/SearchViewModel`) rather than the widget
   * module itself. The codemod only rewrites the exact widget module, so
   * support-module usage must not inherit the widget's disposition.
   */
  supportModule: boolean;
}

export function widgetModulePathInfo(modulePath: string): WidgetModulePathInfo | undefined {
  const normalized = modulePath.endsWith(".js") ? modulePath.slice(0, -3) : modulePath;
  let rest: string | undefined;
  if (normalized.startsWith("@arcgis/core/widgets/")) {
    rest = normalized.slice("@arcgis/core/widgets/".length);
  } else if (normalized.startsWith("esri/widgets/")) {
    rest = normalized.slice("esri/widgets/".length);
  }
  if (!rest) {
    return undefined;
  }
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  const widget = segments[0];
  if (!widget) {
    return undefined;
  }
  return { widget, supportModule: segments.length > 1 };
}
