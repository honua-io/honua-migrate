import path from "node:path";

import {
  type CodemodConstructorKind,
  type CodemodFileError,
  type CodemodFileResult,
  type EsriCompatCodemodResult,
  type MigrationTodo,
  SUPPORTED_ARCGIS_MODULE_KIND_BY_PATH,
  isKindSupportedForTarget,
  isSupportedArcGisBarrelModulePath,
  resolveArcGisBarrelImportKind,
} from "./codemod.js";
import {
  AMD_REQUIRE_IMPORT_CLAUSE,
  ARCGIS_IMPORT_CLAUSE,
  type ArcGisDependencyHit,
  type ArcGisDependencyManifest,
  type ArcGisImportHit,
  type ArcGisScanReport,
  scanArcGisUsage,
  summarizeArcGisScan,
} from "./scanner.js";
import {
  ARCGIS_WIDGET_DEPRECATION_RELEASE,
  ARCGIS_WIDGET_REMOVAL_RELEASE,
  type WidgetDispositionKind,
  getWidgetDisposition,
  widgetModulePathInfo,
} from "./widget-dispositions.js";

export interface ManualRewriteMetric {
  numerator: number;
  denominator: number;
  ratio: number;
  scope: string;
}

export interface ManualInterventionMetric {
  numerator: number;
  denominator: number;
  ratio: number;
  scope: string;
  manualCodemodCallSites: number;
  unhandledUsageHits: number;
}

export interface JsMigrationReport {
  rootDir: string;
  codemodTarget: "honua-compat" | "esri-leaflet" | "honua-maplibre";
  scanSummary: string;
  scanReport: ArcGisScanReport;
  codemodResult: EsriCompatCodemodResult;
  manualRewriteMetric: ManualRewriteMetric;
  manualInterventionMetric: ManualInterventionMetric;
  readiness: MigrationReadiness;
  usageInventory: ArcGisUsageInventory;
  gates: MigrationGateResult[];
  manualTodosByKind: Record<CodemodConstructorKind, number>;
  manualTodoReasons: MigrationReasonSummary[];
  unhandledArcGisModules: ArcGisModuleSummary[];
  manualTodos: MigrationTodo[];
  /** Per-file boundaries and diagnostics, and which conversion mode the result supports. */
  conversion: JsConversionPlan;
}

export interface MigrationReasonSummary {
  reason: string;
  count: number;
  kinds: CodemodConstructorKind[];
}

export interface ArcGisModuleSummary {
  modulePath: string;
  usageStyle: ArcGisUsageStyle;
  count: number;
}

export type ArcGisUsageStyle = "static-import" | "dynamic-import" | "require" | "amd-require" | "arcgis-import";

/**
 * `no-arcgis-usage` means the scan discovered zero ArcGIS module sites and zero
 * codemod-scoped call sites. No gate has a denominator then, so the report
 * never calls that state `ready`.
 */
export type MigrationReadiness = "ready" | "assisted" | "blocked" | "no-arcgis-usage";

/**
 * Runtime a widget usage site needs after the codemod: `honua` when the site is
 * in codemod scope for the target and rewrites onto a Honua compat widget,
 * otherwise the classic ArcGIS JS widget runtime, deprecated at 5.0, whose
 * widgets Esri plans to begin removing at 6.0.
 */
export type WidgetRuntime = "honua" | "arcgis-js";

export interface WidgetRuntimeRequirement {
  widget: string;
  supportModule: boolean;
  disposition: WidgetDispositionKind | "unknown" | "support-module";
  runtime: WidgetRuntime;
  sites: number;
}

/** Denominator-complete accounting of everything the scan discovered. */
export interface ArcGisUsageInventory {
  filesScanned: number;
  filesWithArcGisUsage: number;
  /** Every discovered ArcGIS module reference, whatever its loading style. */
  moduleSites: number;
  moduleSitesByStyle: Record<ArcGisUsageStyle, number>;
  /** Module sites inside codemod scope for the target. */
  handledModuleSites: number;
  /** Module sites the codemod leaves as written (`moduleSites - handledModuleSites`). */
  unsupportedModuleSites: number;
  codemodScopedCallSites: number;
  automaticCallSites: number;
  manualCallSites: number;
  widgetSites: number;
  honuaWidgetSites: number;
  arcgisRuntimeWidgetSites: number;
  widgetRuntimeRequirements: WidgetRuntimeRequirement[];
  dependencyManifests: ArcGisDependencyManifest[];
  /** ArcGIS JS runtime packages still declared; a full Honua conversion removes them. */
  residualArcGisDependencies: ArcGisDependencyHit[];
}

export interface MigrationGateResult {
  gate: "no-manual-todos" | "no-unhandled-modules" | "no-blocking-flags";
  passed: boolean;
  detail: string;
}

/**
 * How a migrated app relates to the ArcGIS JS runtime.
 *
 * - `keep-esri-client`: leave ArcGIS source as written and repoint the app's
 *   service URLs at Honua.
 * - `assisted-conversion`: apply the codemod where it rewrites safely and hold
 *   the rest for review; the app still depends on `@arcgis/core`.
 * - `complete-honua-conversion`: the migrated source has no ArcGIS import,
 *   manual call site or classic widget runtime requirement left.
 */
export type JsConversionMode = "keep-esri-client" | "assisted-conversion" | "complete-honua-conversion";

/**
 * What the codemod did to one file that uses ArcGIS:
 *
 * - `converted`: every module site rewritten, no manual call site left.
 * - `mixed`: some sites rewritten, others held for review.
 * - `kept`: nothing rewritten; the file stays on ArcGIS as written.
 * - `held`: the codemod could not read, parse or write the file and left it untouched.
 */
export type JsFileBoundary = "converted" | "mixed" | "kept" | "held";

export type JsFileDiagnosticCode =
  | "held-file"
  | "manual-call-site"
  | "import-left-in-place"
  | "module-loader-not-rewritten"
  | "widget-on-arcgis-runtime"
  | "unsupported-module";

/** One held site or file, with what to do about it. */
export interface JsFileDiagnostic {
  code: JsFileDiagnosticCode;
  /** Present for manual call sites. */
  line?: number;
  column?: number;
  /** Present for module sites the codemod left in place. */
  modulePath?: string;
  message: string;
  action: string;
}

export interface JsFileMigration {
  /** Path relative to the report root, POSIX separators. */
  file: string;
  boundary: JsFileBoundary;
  moduleSites: number;
  handledModuleSites: number;
  manualCallSites: number;
  diagnostics: JsFileDiagnostic[];
}

export interface JsConversionModeAssessment {
  mode: JsConversionMode;
  available: boolean;
  detail: string;
}

export interface JsConversionPlan {
  /** `null` when the scan discovered no ArcGIS usage: there is nothing to keep, repoint or convert. */
  recommendedMode: JsConversionMode | null;
  rationale: string;
  /** Every mode, in `keep-esri-client`, `assisted-conversion`, `complete-honua-conversion` order. */
  modes: JsConversionModeAssessment[];
  fileBoundaries: Record<JsFileBoundary, number>;
  /** Every file with ArcGIS module sites, manual call sites or a codemod error, sorted by path. */
  files: JsFileMigration[];
}

const BLOCKING_FLAGS = new Set(["scene-3d-detected", "advanced-widget-or-networking-detected"]);

export function buildJsMigrationReport(
  rootDir: string,
  codemodResult: EsriCompatCodemodResult,
  scanReport?: ArcGisScanReport,
): JsMigrationReport {
  const resolvedScan = scanReport ?? scanArcGisUsage(rootDir);
  const scanSummary = summarizeArcGisScan(resolvedScan);

  const denominator = codemodResult.metrics.totalCodemodScopedCallSites;
  const numerator = codemodResult.metrics.manualCallSites;
  const ratio = denominator === 0 ? 0 : numerator / denominator;
  const manualTodosByKind = summarizeManualTodosByKind(codemodResult.manualTodos);
  const manualTodoReasons = summarizeManualTodoReasons(codemodResult.manualTodos);
  const importHits = resolveImportHitDispositions(resolvedScan, codemodResult);
  const handledImportHits = importHits.handled;
  const unhandledArcGisModules = summarizeUnhandledModules(resolvedScan, handledImportHits);
  const unhandledUsageHits = unhandledArcGisModules.reduce((total, moduleItem) => total + moduleItem.count, 0);
  const interventionNumerator = numerator + unhandledUsageHits;
  const interventionDenominator = denominator + unhandledUsageHits;
  const interventionRatio = interventionDenominator === 0 ? 0 : interventionNumerator / interventionDenominator;
  const usageInventory = buildUsageInventory(resolvedScan, codemodResult, handledImportHits);
  const gates = buildMigrationGates(codemodResult, resolvedScan, unhandledArcGisModules);
  const readiness = determineReadiness(gates, usageInventory);
  const conversion = buildConversionPlan(resolvedScan, codemodResult, importHits, usageInventory, readiness);

  return {
    rootDir: codemodResult.rootDir,
    codemodTarget: codemodResult.target,
    scanSummary,
    scanReport: resolvedScan,
    codemodResult,
    manualRewriteMetric: {
      numerator,
      denominator,
      ratio,
      scope:
        "FeatureLayer/Graphic/Point/Polyline/Polygon/Extent/SpatialReference/Color/SimpleLineSymbol/SimpleMarkerSymbol/PictureMarkerSymbol/TextSymbol/LabelClass/SimpleFillSymbol/ClassBreaksRenderer/SimpleRenderer/UniqueValueRenderer/GraphicsLayer/GroupLayer/MapImageLayer/TileLayer/RouteLayer/RouteTask/Basemap/Map/MapView/SceneView/WebMap/LayerList/TableList/Feature/FeatureTemplates/FeatureForm/FeatureTable/FeatureSet/Legend/Popup/PopupTemplate/Swipe/Print/Home/BasemapToggle/Locate/ScaleBar/Search/BasemapLayerList/BasemapGallery/Expand/Compass/Bookmarks/Fullscreen/Zoom/Attribution/Sketch/Editor/Track/DistanceMeasurement2D/AreaMeasurement2D/Measurement/TimeSlider/Directions/CoordinateConversion/Query/OAuthInfo/IdentityManager/EsriRequest/EsriConfig/ReactiveUtils codemod-scoped usage in safe migration scope",
    },
    manualInterventionMetric: {
      numerator: interventionNumerator,
      denominator: interventionDenominator,
      ratio: interventionRatio,
      scope: "Codemod-scoped call sites plus unhandled ArcGIS module usage hits (static-import/dynamic-import/require)",
      manualCodemodCallSites: numerator,
      unhandledUsageHits,
    },
    readiness,
    usageInventory,
    gates,
    manualTodosByKind,
    manualTodoReasons,
    unhandledArcGisModules,
    manualTodos: codemodResult.manualTodos,
    conversion,
  };
}

function summarizeManualTodosByKind(todos: readonly MigrationTodo[]): Record<CodemodConstructorKind, number> {
  const summary: Record<CodemodConstructorKind, number> = {
    "feature-layer": 0,
    graphic: 0,
    "point-geometry": 0,
    "polyline-geometry": 0,
    "polygon-geometry": 0,
    "extent-geometry": 0,
    "spatial-reference": 0,
    color: 0,
    "simple-line-symbol": 0,
    "simple-marker-symbol": 0,
    "picture-marker-symbol": 0,
    "text-symbol": 0,
    "label-class": 0,
    "simple-fill-symbol": 0,
    "class-breaks-renderer": 0,
    "simple-renderer": 0,
    "unique-value-renderer": 0,
    "graphics-layer": 0,
    "group-layer": 0,
    "map-image-layer": 0,
    "tile-layer": 0,
    "route-layer": 0,
    "route-task": 0,
    basemap: 0,
    map: 0,
    "map-view": 0,
    "scene-view": 0,
    "web-map": 0,
    "layer-list": 0,
    "table-list-widget": 0,
    "feature-widget": 0,
    "feature-templates-widget": 0,
    "feature-form-widget": 0,
    "feature-table-widget": 0,
    "feature-set": 0,
    "legend-widget": 0,
    "popup-widget": 0,
    "popup-template": 0,
    "swipe-widget": 0,
    "print-widget": 0,
    "home-widget": 0,
    "basemap-toggle-widget": 0,
    "locate-widget": 0,
    "scale-bar-widget": 0,
    "search-widget": 0,
    "basemap-layer-list-widget": 0,
    "basemap-gallery-widget": 0,
    "expand-widget": 0,
    "compass-widget": 0,
    "bookmarks-widget": 0,
    "fullscreen-widget": 0,
    "zoom-widget": 0,
    "attribution-widget": 0,
    "sketch-widget": 0,
    "editor-widget": 0,
    "track-widget": 0,
    "distance-measurement-2d-widget": 0,
    "area-measurement-2d-widget": 0,
    "measurement-widget": 0,
    "time-slider-widget": 0,
    "directions-widget": 0,
    "coordinate-conversion-widget": 0,
    query: 0,
    "oauth-info": 0,
    "identity-manager": 0,
    "esri-request": 0,
    "esri-config": 0,
    "reactive-utils": 0,
    "feature-filter": 0,
    "vector-tile-layer": 0,
    "geojson-layer": 0,
    "wms-layer": 0,
    "wfs-layer": 0,
    "imagery-layer": 0,
    "geometry-engine": 0,
  };

  for (const todo of todos) {
    summary[todo.kind] += 1;
  }

  return summary;
}

function summarizeManualTodoReasons(todos: readonly MigrationTodo[]): MigrationReasonSummary[] {
  const reasons = new Map<string, { count: number; kinds: Set<CodemodConstructorKind> }>();

  for (const todo of todos) {
    let bucket = reasons.get(todo.reason);
    if (!bucket) {
      bucket = { count: 0, kinds: new Set<CodemodConstructorKind>() };
      reasons.set(todo.reason, bucket);
    }

    bucket.count += 1;
    bucket.kinds.add(todo.kind);
  }

  return Array.from(reasons.entries())
    .map(([reason, bucket]) => ({
      reason,
      count: bucket.count,
      kinds: Array.from(bucket.kinds).sort(),
    }))
    .sort((a, b) => (a.count === b.count ? a.reason.localeCompare(b.reason) : b.count - a.count));
}

function summarizeUnhandledModules(
  scanReport: ArcGisScanReport,
  handledImportHits: ReadonlySet<ArcGisImportHit>,
): ArcGisModuleSummary[] {
  const moduleCounts = new Map<string, number>();

  for (const hit of scanReport.imports) {
    if (handledImportHits.has(hit)) {
      continue;
    }

    const key = `${hit.modulePath}|${classifyUsageStyle(hit.importClause)}`;
    moduleCounts.set(key, (moduleCounts.get(key) ?? 0) + 1);
  }

  return Array.from(moduleCounts.entries())
    .map(([key, count]) => {
      const [modulePath, usageStyleText] = key.split("|", 2);
      return {
        modulePath,
        usageStyle: usageStyleText as ArcGisUsageStyle,
        count,
      };
    })
    .sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      if (a.modulePath !== b.modulePath) {
        return a.modulePath.localeCompare(b.modulePath);
      }
      return a.usageStyle.localeCompare(b.usageStyle);
    });
}

/**
 * Scan hits the codemod actually migrated. A hit must be in codemod scope for
 * the target and, when the codemod reports what it left behind, must not
 * survive in its output: scope alone would count `import type MapView from
 * "@arcgis/core/views/MapView"`, or a value import used only in type
 * positions, as handled although the migrated source still imports ArcGIS.
 */
function resolveImportHitDispositions(
  scanReport: ArcGisScanReport,
  codemodResult: EsriCompatCodemodResult,
): ImportHitDispositions {
  const inScope = scanReport.imports.filter((hit) => isImportHitHandledByCodemod(hit, codemodResult));
  const inScopeSet = new Set(inScope);
  const residual = codemodResult.residualArcGisModuleSites;
  if (!residual) {
    return { inScope: inScopeSet, handled: inScopeSet };
  }

  const residualCounts = new Map<string, number>();
  for (const site of residual) {
    const key = importSiteKey(site);
    residualCounts.set(key, (residualCounts.get(key) ?? 0) + 1);
  }
  // Out-of-scope hits account for their own surviving sites first, so a
  // residual site is never charged to an in-scope hit that was rewritten.
  for (const hit of scanReport.imports) {
    if (inScopeSet.has(hit)) {
      continue;
    }
    const key = importSiteKey(hit);
    const remaining = residualCounts.get(key) ?? 0;
    if (remaining > 0) {
      residualCounts.set(key, remaining - 1);
    }
  }

  const handled = new Set<ArcGisImportHit>();
  for (const hit of inScope) {
    const key = importSiteKey(hit);
    const remaining = residualCounts.get(key) ?? 0;
    if (remaining > 0) {
      residualCounts.set(key, remaining - 1);
      continue;
    }
    handled.add(hit);
  }
  return { inScope: inScopeSet, handled };
}

interface ImportHitDispositions {
  /** Hits whose module is in codemod scope for the target. */
  inScope: ReadonlySet<ArcGisImportHit>;
  /** In-scope hits the codemod removed from its output. */
  handled: ReadonlySet<ArcGisImportHit>;
}

function importSiteKey(hit: ArcGisImportHit): string {
  return `${path.resolve(hit.file)} ${hit.modulePath} ${classifyUsageStyle(hit.importClause)}`;
}

function isImportHitHandledByCodemod(
  hit: ArcGisScanReport["imports"][number],
  codemodResult: EsriCompatCodemodResult,
): boolean {
  const usageStyle = classifyUsageStyle(hit.importClause);
  if (usageStyle === "amd-require" || usageStyle === "arcgis-import") {
    // The codemod rewrites ESM and CommonJS sources; module-loader arrays and
    // `$arcgis.import(...)` calls stay as written, whatever module they name.
    return false;
  }

  const isReExport = hit.importClause.startsWith("export ");
  const isSideEffectImport = hit.importClause === "side-effect-import";
  const supportedKinds = resolveSupportedKindsForImportHit(hit);
  const hasSupportedKind = supportedKinds.length > 0;
  const moduleSupportedForTarget =
    !isSideEffectImport &&
    !isReExport &&
    hasSupportedKind &&
    supportedKinds.every((kind) => isKindSupportedForTarget(kind, codemodResult.target));
  const directSupportedKind = SUPPORTED_ARCGIS_MODULE_KIND_BY_PATH[hit.modulePath];
  const requireCoveredByCodemod =
    usageStyle === "require" &&
    moduleSupportedForTarget &&
    directSupportedKind !== undefined &&
    codemodResult.metrics.byKind[directSupportedKind].total > 0;
  return moduleSupportedForTarget && (usageStyle !== "require" || requireCoveredByCodemod);
}

const HONUA_WIDGET_DISPOSITIONS: ReadonlySet<WidgetDispositionKind> = new Set(["automated", "compat-shim"]);

function buildUsageInventory(
  scanReport: ArcGisScanReport,
  codemodResult: EsriCompatCodemodResult,
  handledImportHits: ReadonlySet<ArcGisImportHit>,
): ArcGisUsageInventory {
  const moduleSitesByStyle: Record<ArcGisUsageStyle, number> = {
    "static-import": 0,
    "dynamic-import": 0,
    require: 0,
    "amd-require": 0,
    "arcgis-import": 0,
  };
  const widgetRows = new Map<string, WidgetRuntimeRequirement>();
  let handledModuleSites = 0;

  for (const hit of scanReport.imports) {
    moduleSitesByStyle[classifyUsageStyle(hit.importClause)] += 1;
    const handled = handledImportHits.has(hit);
    if (handled) {
      handledModuleSites += 1;
    }

    const widgetInfo = widgetModulePathInfo(hit.modulePath);
    if (!widgetInfo) {
      continue;
    }
    const disposition = getWidgetDisposition(widgetInfo.widget)?.disposition;
    const runtime: WidgetRuntime =
      handled && !widgetInfo.supportModule && disposition !== undefined && HONUA_WIDGET_DISPOSITIONS.has(disposition)
        ? "honua"
        : "arcgis-js";
    const key = `${widgetInfo.widget}|${widgetInfo.supportModule}|${runtime}`;
    const row = widgetRows.get(key);
    if (row) {
      row.sites += 1;
    } else {
      widgetRows.set(key, {
        widget: widgetInfo.widget,
        supportModule: widgetInfo.supportModule,
        disposition: widgetInfo.supportModule ? "support-module" : (disposition ?? "unknown"),
        runtime,
        sites: 1,
      });
    }
  }

  const widgetRuntimeRequirements = Array.from(widgetRows.values()).sort(
    (a, b) =>
      a.widget.localeCompare(b.widget) ||
      Number(a.supportModule) - Number(b.supportModule) ||
      a.runtime.localeCompare(b.runtime),
  );
  const widgetSites = widgetRuntimeRequirements.reduce((total, row) => total + row.sites, 0);
  const honuaWidgetSites = widgetRuntimeRequirements
    .filter((row) => row.runtime === "honua")
    .reduce((total, row) => total + row.sites, 0);

  return {
    filesScanned: scanReport.filesScanned,
    filesWithArcGisUsage: scanReport.filesWithArcGisImports,
    moduleSites: scanReport.imports.length,
    moduleSitesByStyle,
    handledModuleSites,
    unsupportedModuleSites: scanReport.imports.length - handledModuleSites,
    codemodScopedCallSites: codemodResult.metrics.totalCodemodScopedCallSites,
    automaticCallSites: codemodResult.metrics.autoMigratedCallSites,
    manualCallSites: codemodResult.metrics.manualCallSites,
    widgetSites,
    honuaWidgetSites,
    arcgisRuntimeWidgetSites: widgetSites - honuaWidgetSites,
    widgetRuntimeRequirements,
    dependencyManifests: scanReport.dependencyManifests ?? [],
    residualArcGisDependencies: scanReport.arcgisDependencies ?? [],
  };
}

function resolveSupportedKindsForImportHit(hit: ArcGisScanReport["imports"][number]): CodemodConstructorKind[] {
  const directSupportedKind = SUPPORTED_ARCGIS_MODULE_KIND_BY_PATH[hit.modulePath];
  if (directSupportedKind !== undefined) {
    return [directSupportedKind];
  }
  if (!isSupportedArcGisBarrelModulePath(hit.modulePath)) {
    return [];
  }
  if (
    hit.importClause === "side-effect-import" ||
    hit.importClause === "import(...)" ||
    hit.importClause === "require(...)" ||
    hit.importClause.startsWith("*")
  ) {
    return [];
  }

  const importedNames = extractImportedNamesFromClause(hit.importClause);
  const kinds: CodemodConstructorKind[] = [];
  for (const importedName of importedNames) {
    const kind = resolveArcGisBarrelImportKind(hit.modulePath, importedName);
    if (!kind || kinds.includes(kind)) {
      continue;
    }
    kinds.push(kind);
  }
  return kinds;
}

/**
 * Return the text between the first `{` and the next `}` in `value`, or
 * `undefined` if no such pair exists.
 *
 * Equivalent to `value.match(/\{([^}]+)\}/)?.[1]` but avoids an unanchored
 * regex whose quantifier can be retried at every character position of an
 * attacker-influenced `importClause` (CodeQL: `js/polynomial-redos`, O(n^2)
 * on inputs with no closing `}`). `indexOf` scans forward only once per
 * call, so this stays O(n) regardless of input shape.
 */
function extractBracedContent(value: string): string | undefined {
  const openIndex = value.indexOf("{");
  if (openIndex < 0) {
    return undefined;
  }
  const closeIndex = value.indexOf("}", openIndex + 1);
  if (closeIndex < 0) {
    return undefined;
  }
  return value.slice(openIndex + 1, closeIndex);
}

function extractImportedNamesFromClause(importClause: string): string[] {
  const names: string[] = [];
  const namedContent = extractBracedContent(importClause);
  if (namedContent === undefined) {
    return names;
  }

  for (const token of namedContent.split(",")) {
    const value = token.trim();
    if (!value || value === "*") {
      continue;
    }

    const aliasMatch = value.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*$/);
    if (aliasMatch) {
      names.push(aliasMatch[1]);
      continue;
    }

    const directMatch = value.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (directMatch) {
      names.push(directMatch[1]);
    }
  }

  return names;
}

function classifyUsageStyle(importClause: string): ArcGisUsageStyle {
  if (importClause === "import(...)") {
    return "dynamic-import";
  }
  if (importClause === "require(...)") {
    return "require";
  }
  if (importClause === AMD_REQUIRE_IMPORT_CLAUSE) {
    return "amd-require";
  }
  if (importClause === ARCGIS_IMPORT_CLAUSE) {
    return "arcgis-import";
  }
  return "static-import";
}

function buildMigrationGates(
  codemodResult: EsriCompatCodemodResult,
  scanReport: ArcGisScanReport,
  unhandledModules: readonly ArcGisModuleSummary[],
): MigrationGateResult[] {
  const hasManualTodos = codemodResult.metrics.manualCallSites > 0;
  const blockingFlags = scanReport.flags.filter((flag) => BLOCKING_FLAGS.has(flag)).sort();
  let manualTodosDetail = "all codemod-scoped call sites auto-migrated";
  if (hasManualTodos) {
    manualTodosDetail = `${codemodResult.metrics.manualCallSites} manual codemod-scoped call sites remain`;
  } else if (codemodResult.metrics.totalCodemodScopedCallSites === 0) {
    manualTodosDetail = "no codemod-scoped call sites discovered";
  }
  let unhandledModulesDetail = "all discovered ArcGIS modules are in codemod scope";
  if (unhandledModules.length > 0) {
    unhandledModulesDetail = `${unhandledModules.length} ArcGIS modules remain outside codemod scope`;
  } else if (scanReport.imports.length === 0) {
    unhandledModulesDetail = "no ArcGIS module usage discovered";
  }

  return [
    {
      gate: "no-manual-todos",
      passed: !hasManualTodos,
      detail: manualTodosDetail,
    },
    {
      gate: "no-unhandled-modules",
      passed: unhandledModules.length === 0,
      detail: unhandledModulesDetail,
    },
    {
      gate: "no-blocking-flags",
      passed: blockingFlags.length === 0,
      detail:
        blockingFlags.length === 0
          ? "no blocking migration flags detected"
          : `blocking flags: ${blockingFlags.join(", ")}`,
    },
  ];
}

function determineReadiness(
  gates: readonly MigrationGateResult[],
  inventory: ArcGisUsageInventory,
): MigrationReadiness {
  if (inventory.moduleSites === 0 && inventory.codemodScopedCallSites === 0) {
    // Every gate passes vacuously on an empty scan; that is not a migration verdict.
    return "no-arcgis-usage";
  }

  const blockingGate = gates.find((gate) => gate.gate === "no-blocking-flags");
  if (blockingGate && !blockingGate.passed) {
    return "blocked";
  }

  const allPassed = gates.every((gate) => gate.passed);
  return allPassed ? "ready" : "assisted";
}

const NO_USAGE_MODE_DETAIL = "Not available: the scan discovered no ArcGIS usage.";

function buildConversionPlan(
  scanReport: ArcGisScanReport,
  codemodResult: EsriCompatCodemodResult,
  importHits: ImportHitDispositions,
  inventory: ArcGisUsageInventory,
  readiness: MigrationReadiness,
): JsConversionPlan {
  const files = buildFileMigrations(scanReport, codemodResult, importHits);
  const fileBoundaries: Record<JsFileBoundary, number> = { converted: 0, mixed: 0, kept: 0, held: 0 };
  for (const file of files) {
    fileBoundaries[file.boundary] += 1;
  }

  if (readiness === "no-arcgis-usage") {
    return {
      recommendedMode: null,
      rationale:
        "The scan discovered no ArcGIS module sites or codemod-scoped call sites; there is nothing to keep, repoint or convert.",
      modes: [
        { mode: "keep-esri-client", available: false, detail: NO_USAGE_MODE_DETAIL },
        { mode: "assisted-conversion", available: false, detail: NO_USAGE_MODE_DETAIL },
        { mode: "complete-honua-conversion", available: false, detail: NO_USAGE_MODE_DETAIL },
      ],
      fileBoundaries,
      files,
    };
  }

  const blockingFlags = scanReport.flags.filter((flag) => BLOCKING_FLAGS.has(flag)).sort();
  const rewrittenFiles = fileBoundaries.converted + fileBoundaries.mixed;

  const completeBlockers: string[] = [];
  if (inventory.unsupportedModuleSites > 0) {
    completeBlockers.push(`${countOf(inventory.unsupportedModuleSites, "ArcGIS module site")} left in place`);
  }
  if (inventory.manualCallSites > 0) {
    completeBlockers.push(`${countOf(inventory.manualCallSites, "manual call site")} to port`);
  }
  if (inventory.arcgisRuntimeWidgetSites > 0) {
    completeBlockers.push(
      `${countOf(inventory.arcgisRuntimeWidgetSites, "widget site")} on the classic ArcGIS widget runtime`,
    );
  }
  if (blockingFlags.length > 0) {
    completeBlockers.push(`blocking flags: ${blockingFlags.join(", ")}`);
  }
  if (fileBoundaries.held > 0) {
    completeBlockers.push(`${countOf(fileBoundaries.held, "file")} held on codemod errors`);
  }
  const completeAvailable = completeBlockers.length === 0;

  const assistedBlockers: string[] = [];
  if (blockingFlags.length > 0) {
    assistedBlockers.push(`blocking flags: ${blockingFlags.join(", ")}`);
  }
  if (rewrittenFiles === 0) {
    assistedBlockers.push("the codemod rewrites no file in this app");
  }
  if (completeAvailable) {
    assistedBlockers.push("nothing is held for review; the conversion is complete");
  }
  const assistedAvailable = assistedBlockers.length === 0;

  let keepDetail = `Leave the ArcGIS source as written (${countOf(inventory.moduleSites, "module site")}) and repoint the app's service URLs at Honua; \`honua-migrate services arcgis handoff\` records the target endpoint and layer ID mapping.`;
  if (inventory.widgetSites > 0) {
    keepDetail += ` Widget usage (${countOf(inventory.widgetSites, "site")}) stays on the classic widget runtime, deprecated at ${ARCGIS_WIDGET_DEPRECATION_RELEASE}; Esri plans to begin removing widgets at ${ARCGIS_WIDGET_REMOVAL_RELEASE}.`;
  }

  const assistedDetail = assistedAvailable
    ? `Rewrote ${rewrittenFiles} of ${countOf(files.length, "file")} with ArcGIS usage (${fileBoundaries.converted} converted, ${fileBoundaries.mixed} mixed; ${fileBoundaries.kept} kept, ${fileBoundaries.held} held). Held for review: ${completeBlockers.join("; ")}.`
    : `Not available: ${assistedBlockers.join("; ")}.`;

  let completeDetail = `Not available: ${completeBlockers.join("; ")}.`;
  if (completeAvailable) {
    completeDetail = "The migrated source imports nothing from ArcGIS and every call site migrated automatically.";
    const residualNames = [...new Set(inventory.residualArcGisDependencies.map((dependency) => dependency.name))];
    if (residualNames.length > 0) {
      completeDetail += ` Remove ${residualNames.sort().join(", ")} from package.json to drop the ArcGIS JS runtime.`;
    }
  }

  let recommendedMode: JsConversionMode;
  let rationale: string;
  if (blockingFlags.length > 0) {
    recommendedMode = "keep-esri-client";
    rationale = `Blocking flags (${blockingFlags.join(", ")}) are outside the 2D conversion path; keep the ArcGIS JS client and repoint its services at Honua.`;
  } else if (completeAvailable) {
    recommendedMode = "complete-honua-conversion";
    rationale = "Every ArcGIS module site was rewritten and every call site migrated automatically.";
  } else if (assistedAvailable) {
    recommendedMode = "assisted-conversion";
    rationale = `Rewrote ${rewrittenFiles} of ${countOf(files.length, "file")} with ArcGIS usage; the rest is held with per-file diagnostics.`;
  } else {
    recommendedMode = "keep-esri-client";
    rationale =
      "The codemod rewrites no file in this app; keep the ArcGIS JS client and repoint its services at Honua.";
  }

  return {
    recommendedMode,
    rationale,
    modes: [
      { mode: "keep-esri-client", available: true, detail: keepDetail },
      { mode: "assisted-conversion", available: assistedAvailable, detail: assistedDetail },
      { mode: "complete-honua-conversion", available: completeAvailable, detail: completeDetail },
    ],
    fileBoundaries,
    files,
  };
}

interface FileMigrationAccumulator {
  moduleSites: number;
  handledModuleSites: number;
  manualCallSites: number;
  siteDiagnostics: JsFileDiagnostic[];
  errors: CodemodFileError[];
}

function buildFileMigrations(
  scanReport: ArcGisScanReport,
  codemodResult: EsriCompatCodemodResult,
  importHits: ImportHitDispositions,
): JsFileMigration[] {
  const rootDir = path.resolve(codemodResult.rootDir);
  const byFile = new Map<string, FileMigrationAccumulator>();
  const entryFor = (file: string): FileMigrationAccumulator => {
    const key = path.resolve(file);
    let entry = byFile.get(key);
    if (!entry) {
      entry = { moduleSites: 0, handledModuleSites: 0, manualCallSites: 0, siteDiagnostics: [], errors: [] };
      byFile.set(key, entry);
    }
    return entry;
  };

  for (const hit of scanReport.imports) {
    const entry = entryFor(hit.file);
    entry.moduleSites += 1;
    if (importHits.handled.has(hit)) {
      entry.handledModuleSites += 1;
    } else {
      entry.siteDiagnostics.push(describeUnhandledModuleSite(hit, importHits.inScope.has(hit), codemodResult.target));
    }
  }
  for (const todo of codemodResult.manualTodos) {
    const entry = entryFor(todo.file);
    entry.manualCallSites += 1;
    entry.siteDiagnostics.push({
      code: "manual-call-site",
      line: todo.line,
      column: todo.column,
      message: todo.reason,
      action: `Port this ${todo.kind} call site by hand; --annotate-todos marks it in source.`,
    });
  }
  for (const error of codemodResult.errors ?? []) {
    entryFor(error.file).errors.push(error);
  }

  const rewrittenFiles = new Set(
    codemodResult.fileResults.filter(isRewrittenFile).map((fileResult) => path.resolve(fileResult.file)),
  );

  return Array.from(byFile.entries())
    .map(([absolutePath, entry]) => {
      const boundary = resolveFileBoundary(entry, rewrittenFiles.has(absolutePath));
      return {
        file: path.relative(rootDir, absolutePath).split(path.sep).join("/"),
        boundary,
        moduleSites: entry.moduleSites,
        handledModuleSites: entry.handledModuleSites,
        manualCallSites: entry.manualCallSites,
        // A held file was left untouched, so per-site verdicts about what the
        // codemod did would be fiction; the error is the diagnostic.
        diagnostics:
          boundary === "held"
            ? entry.errors.map((error) => describeHeldFile(error, entry.moduleSites))
            : entry.siteDiagnostics,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function isRewrittenFile(fileResult: CodemodFileResult): boolean {
  // TODO annotations alone change comments, not what the file runs on.
  return (
    fileResult.rewrittenImports > 0 ||
    fileResult.rewrittenConstructors > 0 ||
    fileResult.rewrittenDynamicImports > 0 ||
    fileResult.rewrittenEventNames > 0 ||
    fileResult.addedCompatImport ||
    fileResult.removedArcGisImports > 0
  );
}

function resolveFileBoundary(entry: FileMigrationAccumulator, rewritten: boolean): JsFileBoundary {
  if (entry.errors.length > 0) {
    return "held";
  }
  if (entry.handledModuleSites === entry.moduleSites && entry.manualCallSites === 0) {
    return "converted";
  }
  if (entry.handledModuleSites === 0 && !rewritten) {
    return "kept";
  }
  return "mixed";
}

function describeHeldFile(error: CodemodFileError, moduleSites: number): JsFileDiagnostic {
  const verb = error.stage === "transform" ? "parse or transform" : error.stage;
  return {
    code: "held-file",
    message: `The codemod could not ${verb} this file and left it unchanged: ${error.message}`,
    action: `Fix the ${error.stage} error and rerun the codemod; until then its ArcGIS module sites (${moduleSites}) count as unhandled.`,
  };
}

function describeUnhandledModuleSite(
  hit: ArcGisImportHit,
  inScope: boolean,
  target: EsriCompatCodemodResult["target"],
): JsFileDiagnostic {
  const modulePath = hit.modulePath;
  const usageStyle = classifyUsageStyle(hit.importClause);
  if (usageStyle === "amd-require" || usageStyle === "arcgis-import") {
    const loader = usageStyle === "amd-require" ? "an AMD require/define array" : "$arcgis.import(...)";
    return {
      code: "module-loader-not-rewritten",
      modulePath,
      message: `${modulePath} is loaded through ${loader}, which the codemod leaves as written.`,
      action:
        "Keep this file on the ArcGIS JS client, or rewrite the load as an @arcgis/core ESM import and rerun the codemod.",
    };
  }

  if (inScope) {
    return {
      code: "import-left-in-place",
      modulePath,
      message: `${modulePath} is in codemod scope, but the codemod left this import in place: it is type-only, used only in type positions, or still needed by a manual call site.`,
      action:
        "Port or retype the remaining uses against the migrated classes, then remove the import; until then the file still needs @arcgis/core.",
    };
  }

  const widgetInfo = widgetModulePathInfo(modulePath);
  if (widgetInfo) {
    const disposition = getWidgetDisposition(widgetInfo.widget);
    const subject = widgetInfo.supportModule
      ? `a ${widgetInfo.widget} support module`
      : `the ${widgetInfo.widget} widget`;
    return {
      code: "widget-on-arcgis-runtime",
      modulePath,
      message:
        `${modulePath} keeps ${subject} on the classic ArcGIS widget runtime, deprecated at ` +
        `${ARCGIS_WIDGET_DEPRECATION_RELEASE}; Esri plans to begin removing widgets at ${ARCGIS_WIDGET_REMOVAL_RELEASE}.`,
      action: disposition
        ? `Replace what it drives by hand or keep this file on the ArcGIS JS client. Honua disposition for ${widgetInfo.widget}: ${disposition.disposition} (${disposition.target}).`
        : `No Honua disposition is recorded for ${widgetInfo.widget}; port it by hand or keep this file on the ArcGIS JS client.`,
    };
  }

  let message = `${modulePath} has no ${target} mapping in codemod scope.`;
  if (hit.importClause === "side-effect-import") {
    message = `${modulePath} is a side-effect import, which the codemod does not rewrite.`;
  } else if (hit.importClause.startsWith("export ")) {
    message = `${modulePath} is re-exported, which the codemod does not rewrite.`;
  }
  return {
    code: "unsupported-module",
    modulePath,
    message,
    action: "Port its uses by hand, or keep this file on the ArcGIS JS client and repoint its services at Honua.",
  };
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
