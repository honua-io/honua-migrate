import path from "node:path";

import {
  type CodemodConstructorKind,
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
import { type WidgetDispositionKind, getWidgetDisposition, widgetModulePathInfo } from "./widget-dispositions.js";

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
  const handledImportHits = resolveHandledImportHits(resolvedScan, codemodResult);
  const unhandledArcGisModules = summarizeUnhandledModules(resolvedScan, handledImportHits);
  const unhandledUsageHits = unhandledArcGisModules.reduce((total, moduleItem) => total + moduleItem.count, 0);
  const interventionNumerator = numerator + unhandledUsageHits;
  const interventionDenominator = denominator + unhandledUsageHits;
  const interventionRatio = interventionDenominator === 0 ? 0 : interventionNumerator / interventionDenominator;
  const usageInventory = buildUsageInventory(resolvedScan, codemodResult, handledImportHits);
  const gates = buildMigrationGates(codemodResult, resolvedScan, unhandledArcGisModules);
  const readiness = determineReadiness(gates, usageInventory);

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
function resolveHandledImportHits(
  scanReport: ArcGisScanReport,
  codemodResult: EsriCompatCodemodResult,
): ReadonlySet<ArcGisImportHit> {
  const inScope = scanReport.imports.filter((hit) => isImportHitHandledByCodemod(hit, codemodResult));
  const residual = codemodResult.residualArcGisModuleSites;
  if (!residual) {
    return new Set(inScope);
  }

  const residualCounts = new Map<string, number>();
  for (const site of residual) {
    const key = importSiteKey(site);
    residualCounts.set(key, (residualCounts.get(key) ?? 0) + 1);
  }
  // Out-of-scope hits account for their own surviving sites first, so a
  // residual site is never charged to an in-scope hit that was rewritten.
  const inScopeSet = new Set(inScope);
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
  return handled;
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
