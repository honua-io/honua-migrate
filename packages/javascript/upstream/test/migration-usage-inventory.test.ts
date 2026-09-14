import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runEsriCompatCodemod } from "../src/migration/codemod.js";
import { evaluateMigrationGates } from "../src/migration/gating.js";
import { buildJsMigrationReport } from "../src/migration/report.js";
import { scanArcGisUsage } from "../src/migration/scanner.js";
import { buildWidgetReadinessReport, evaluateWidgetGate, scanWidgetUsage } from "../src/migration/widget-scanner.js";
import { getProjectRoot, withCliLock } from "./migration-cli-lock.js";
import { getPreparedMigrationCliPath } from "./prepared-sdk-artifacts.js";

const INVENTORY_FIXTURE_ROOT = path.join(import.meta.dirname, "fixtures", "esri-usage-inventory-app");

const tempDirs: string[] = [];

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-usage-inventory-"));
  tempDirs.push(dir);
  return dir;
}

function buildReport(rootDir: string) {
  const scanReport = scanArcGisUsage(rootDir);
  const codemodResult = runEsriCompatCodemod({ rootDir, write: false, annotateTodos: false, target: "honua-compat" });
  return buildJsMigrationReport(rootDir, codemodResult, scanReport);
}

function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  return withCliLock(() => {
    const result = spawnSync("node", [getPreparedMigrationCliPath(), ...args], {
      cwd: getProjectRoot(),
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Expected values below are counted by hand from the fixture sources, not
// captured from a run:
// - src/main.ts: 5 static imports. Map, FeatureLayer, MapView and Legend are in
//   codemod scope with one safe constructor each; SearchViewModel is a widget
//   support module the codemod does not rewrite.
// - src/legacy-amd.js: one AMD require array naming esri/Map, esri/views/MapView
//   and esri/widgets/LayerList.
// - src/cdn-loader.js: $arcgis.import of esri/widgets/Sketch and
//   @arcgis/core/layers/GraphicsLayer.js, plus a single-string
//   $arcgis.import("@arcgis/core/widgets/Expand.js") that must not also count
//   as a codemod-handled dynamic import().
// - package.json: @arcgis/core and esri-loader dependencies, an
//   @arcgis/map-components devDependency, and typescript (not ArcGIS).
describe("denominator-complete usage inventory", () => {
  it("counts every ESM, AMD, and $arcgis.import site in the mixed-loader fixture", () => {
    const report = buildReport(INVENTORY_FIXTURE_ROOT);

    const { widgetRuntimeRequirements, dependencyManifests, residualArcGisDependencies, ...counts } =
      report.usageInventory;
    expect(counts).toEqual({
      filesScanned: 3,
      filesWithArcGisUsage: 3,
      moduleSites: 11,
      moduleSitesByStyle: {
        "static-import": 5,
        "dynamic-import": 0,
        require: 0,
        "amd-require": 3,
        "arcgis-import": 3,
      },
      handledModuleSites: 4,
      unsupportedModuleSites: 7,
      codemodScopedCallSites: 4,
      automaticCallSites: 4,
      manualCallSites: 0,
      widgetSites: 5,
      honuaWidgetSites: 1,
      arcgisRuntimeWidgetSites: 4,
    });
    expect(widgetRuntimeRequirements).toEqual([
      { widget: "Expand", supportModule: false, disposition: "automated", runtime: "arcgis-js", sites: 1 },
      { widget: "LayerList", supportModule: false, disposition: "automated", runtime: "arcgis-js", sites: 1 },
      { widget: "Legend", supportModule: false, disposition: "automated", runtime: "honua", sites: 1 },
      { widget: "Search", supportModule: true, disposition: "support-module", runtime: "arcgis-js", sites: 1 },
      { widget: "Sketch", supportModule: false, disposition: "compat-shim", runtime: "arcgis-js", sites: 1 },
    ]);
    expect(dependencyManifests).toEqual([{ path: "package.json", parsed: true }]);
    expect(residualArcGisDependencies).toEqual([
      { manifest: "package.json", section: "dependencies", name: "@arcgis/core", version: "^4.33.0" },
      { manifest: "package.json", section: "dependencies", name: "esri-loader", version: "^3.7.0" },
      { manifest: "package.json", section: "devDependencies", name: "@arcgis/map-components", version: "^4.33.0" },
    ]);

    expect(report.unhandledArcGisModules).toEqual([
      { modulePath: "@arcgis/core/layers/GraphicsLayer.js", usageStyle: "arcgis-import", count: 1 },
      { modulePath: "@arcgis/core/widgets/Expand.js", usageStyle: "arcgis-import", count: 1 },
      { modulePath: "@arcgis/core/widgets/Search/SearchViewModel", usageStyle: "static-import", count: 1 },
      { modulePath: "esri/Map", usageStyle: "amd-require", count: 1 },
      { modulePath: "esri/views/MapView", usageStyle: "amd-require", count: 1 },
      { modulePath: "esri/widgets/LayerList", usageStyle: "amd-require", count: 1 },
      { modulePath: "esri/widgets/Sketch", usageStyle: "arcgis-import", count: 1 },
    ]);
    // The intervention metric and the inventory share one denominator.
    expect(report.manualInterventionMetric).toMatchObject({
      numerator: 7,
      denominator: 11,
      manualCodemodCallSites: 0,
      unhandledUsageHits: 7,
    });
    expect(report.manualRewriteMetric).toMatchObject({ numerator: 0, denominator: 4, ratio: 0 });

    expect(report.scanReport.flags).toEqual(["amd-modules-detected", "arcgis-import-detected"]);
    expect(report.readiness).toBe("assisted");
    expect(report.gates).toEqual([
      { gate: "no-manual-todos", passed: true, detail: "all codemod-scoped call sites auto-migrated" },
      { gate: "no-unhandled-modules", passed: false, detail: "7 ArcGIS modules remain outside codemod scope" },
      { gate: "no-blocking-flags", passed: true, detail: "no blocking migration flags detected" },
    ]);
  });

  it("calls an app with no discovered ArcGIS usage no-arcgis-usage, not ready, and still lists residual dependencies", () => {
    const projectRoot = makeTempProject();
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        name: "converted-app",
        private: true,
        dependencies: { "@arcgis/core": "4.33.0", "@honua/sdk": "0.1.2-beta.0" },
      }),
      "utf8",
    );
    const srcDir = path.join(projectRoot, "src");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, "app.ts"),
      "import { HonuaClient } from '@honua/sdk';\nexport const client = HonuaClient;\n",
      "utf8",
    );

    const report = buildReport(srcDir);
    expect(report.readiness).toBe("no-arcgis-usage");
    expect(report.usageInventory).toMatchObject({
      filesScanned: 1,
      filesWithArcGisUsage: 0,
      moduleSites: 0,
      codemodScopedCallSites: 0,
      widgetSites: 0,
      // The scan targets ./src, so the governing manifest is the ancestor one.
      dependencyManifests: [{ path: "../package.json", parsed: true }],
      residualArcGisDependencies: [
        { manifest: "../package.json", section: "dependencies", name: "@arcgis/core", version: "4.33.0" },
      ],
    });
    expect(report.gates.map((gate) => gate.detail)).toEqual([
      "no codemod-scoped call sites discovered",
      "no ArcGIS module usage discovered",
      "no blocking migration flags detected",
    ]);

    // Count gates stay truthful: there really is nothing manual or unhandled.
    expect(evaluateMigrationGates(report, { failOnManual: true, failOnUnhandled: true, failOnBlocked: true })).toEqual({
      failed: false,
      failures: [],
    });
    // Ratio gates have no denominator and must not pass vacuously.
    expect(
      evaluateMigrationGates(report, {
        failOnManual: false,
        failOnUnhandled: false,
        failOnBlocked: false,
        maxManualRatio: 0.5,
        maxManualInterventionRatio: 0.5,
      }),
    ).toEqual({
      failed: true,
      failures: [
        "manual rewrite ratio has no denominator (0 codemod-scoped call sites discovered)",
        "manual intervention ratio has no denominator (0 codemod-scoped call sites and 0 unhandled module sites discovered)",
      ],
    });

    const widgetReport = buildWidgetReadinessReport(scanWidgetUsage(srcDir));
    expect(widgetReport.summary.totalSites).toBe(0);
    expect(widgetReport.summary.automatedPct).toBeNull();
    expect(evaluateWidgetGate(widgetReport, 0).passed).toBe(false);
  });

  it("counts an AMD-only app as ArcGIS usage outside codemod scope instead of an empty, ready scan", () => {
    const root = makeTempProject();
    fs.writeFileSync(path.join(root, "package.json"), "{ not json", "utf8");
    fs.writeFileSync(
      path.join(root, "legacy.js"),
      'define("app/parcels", ["esri/layers/FeatureLayer", "dojo/dom"], (FeatureLayer) => FeatureLayer);\n',
      "utf8",
    );

    const scan = scanArcGisUsage(root);
    expect(scan.imports).toEqual([
      {
        file: path.join(root, "legacy.js"),
        modulePath: "esri/layers/FeatureLayer",
        importClause: "amd-require(...)",
        symbols: [],
      },
    ]);
    // An unparseable manifest means dependencies are unknown, not absent.
    expect(scan.dependencyManifests).toEqual([{ path: "package.json", parsed: false }]);
    expect(scan.arcgisDependencies).toEqual([]);

    const report = buildReport(root);
    expect(report.readiness).toBe("assisted");
    expect(report.unhandledArcGisModules).toEqual([
      { modulePath: "esri/layers/FeatureLayer", usageStyle: "amd-require", count: 1 },
    ]);
    expect(report.manualInterventionMetric).toMatchObject({ numerator: 1, denominator: 1, ratio: 1 });
  });

  it("prints the inventory and residual dependencies from the codemod command", () => {
    const result = runCli(["codemod", INVENTORY_FIXTURE_ROOT]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("writeMode=dry-run");
    expect(result.stdout).toContain("readiness=assisted");
    expect(result.stdout).toContain(
      "usageInventory=moduleSites:11,handled:4,unsupported:7,static-import:5,dynamic-import:0,require:0," +
        "amd-require:3,arcgis-import:3,callSites:4,automatic:4,manual:0,widgetSites:5,honuaWidgets:1," +
        "arcgisRuntimeWidgets:4,residualArcGisDependencies:3\n",
    );
    expect(result.stdout).toContain(
      [
        "residualArcGisDependencies:",
        "- package.json dependencies @arcgis/core@^4.33.0",
        "- package.json dependencies esri-loader@^3.7.0",
        "- package.json devDependencies @arcgis/map-components@^4.33.0",
      ].join("\n"),
    );
  }, 240_000);

  it("fails the widgets --gate with automatedPct=n/a when no widget usage exists", () => {
    const root = makeTempProject();
    fs.writeFileSync(path.join(root, "clean.ts"), "export const ok = true;\n", "utf8");

    const result = runCli(["widgets", root, "--gate", "0"]);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toContain("widgetGate=fail automatedPct=n/a\n");
    expect(result.stdout).toContain("- no classic ArcGIS widget usage sites were discovered in 1 scanned files");
  }, 240_000);
});
