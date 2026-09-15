import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runEsriCompatCodemod } from "../src/migration/codemod.js";
import { buildJsMigrationReport } from "../src/migration/report.js";
import { findArcGisModuleSites, scanArcGisUsage } from "../src/migration/scanner.js";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures");
const COHORT_PATH = path.join(import.meta.dirname, "js-migration-cohort-2026.1.json");
const COHORT_DOC_PATH = path.join(import.meta.dirname, "..", "..", "..", "..", "docs", "js-migration-cohort-2026.1.md");
const TYPE_ONLY_FIXTURE_ROOT = path.join(FIXTURES_ROOT, "esri-type-only-imports-app");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

type Capability = "layer-list" | "legend" | "search" | "popup" | "selection" | "measurement";
type UsagePattern = "esm-typescript" | "esm-javascript" | "framework" | "widget-view-model";

interface CohortMember {
  id: string;
  fixture: string;
  apiLine: "4.x" | "5.x" | "unpinned";
  usagePatterns: UsagePattern[];
  capabilities: Capability[];
  expected: {
    readiness: string;
    moduleSites: number;
    handledModuleSites: number;
    automaticCallSites: number;
    manualCallSites: number;
    arcgisRuntimeWidgetSites: number;
    unhandledModules: string[];
    residualArcGisDependencies: string[];
  };
  residualWork: string;
}

interface Cohort {
  schemaVersion: string;
  release: string;
  scope: { views: string[]; layers: string[] };
  codemodTarget: "honua-compat";
  requiredApiLines: string[];
  requiredCapabilities: Capability[];
  requiredUsagePatterns: UsagePattern[];
  members: CohortMember[];
}

const cohort = JSON.parse(fs.readFileSync(COHORT_PATH, "utf8")) as Cohort;

// Source evidence for a claimed capability. A member may only claim what its
// fixture source visibly uses; the regexes run over the fixture, not the report.
const WIDGET_MODULE = (names: string): RegExp =>
  new RegExp(`["']@arcgis/core/widgets/(?:${names})(?:/\\w+ViewModel)?(?:\\.js)?["']`);
const CAPABILITY_EVIDENCE: Record<Capability, RegExp[]> = {
  "layer-list": [WIDGET_MODULE("LayerList")],
  legend: [WIDGET_MODULE("Legend")],
  search: [WIDGET_MODULE("Search")],
  measurement: [WIDGET_MODULE("DistanceMeasurement2D|AreaMeasurement2D|Measurement")],
  popup: [WIDGET_MODULE("Popup"), /["']@arcgis\/core\/PopupTemplate(?:\.js)?["']/, /\.popup\.open\(/, /\.openPopup\(/],
  selection: [/\.hitTest\(/, /\.highlight\(/, /\.highlightIds\b/, /\.queryFeatures\(/],
};
const STATIC_ARCGIS_IMPORT = /^import\s[^;]*?from\s+["']@arcgis\/core\//m;

interface FixtureSource {
  relativePath: string;
  text: string;
}

function readFixtureSources(root: string): FixtureSource[] {
  const sources: FixtureSource[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(fullPath);
        }
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        sources.push({ relativePath: path.relative(root, fullPath), text: fs.readFileSync(fullPath, "utf8") });
      }
    }
  };
  walk(root);
  return sources;
}

function detectUsagePatterns(sources: readonly FixtureSource[]): Set<UsagePattern> {
  const patterns = new Set<UsagePattern>();
  for (const { relativePath, text } of sources) {
    const extension = path.extname(relativePath);
    if (STATIC_ARCGIS_IMPORT.test(text)) {
      patterns.add(extension === ".ts" || extension === ".tsx" ? "esm-typescript" : "esm-javascript");
    }
    if ((extension === ".tsx" || extension === ".jsx") && /from\s+["'](?:react|preact|vue|svelte)["']/.test(text)) {
      patterns.add("framework");
    }
    if (/["']@arcgis\/core\/widgets\/(\w+)\/\1ViewModel(?:\.js)?["']/.test(text)) {
      patterns.add("widget-view-model");
    }
  }
  return patterns;
}

const tempDirs: string[] = [];

function migrateCopy(fixtureRoot: string, write: boolean) {
  const workingCopy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "honua-cohort-")), path.basename(fixtureRoot));
  tempDirs.push(path.dirname(workingCopy));
  fs.cpSync(fixtureRoot, workingCopy, { recursive: true });
  const scanReport = scanArcGisUsage(workingCopy);
  const codemodResult = runEsriCompatCodemod({
    rootDir: workingCopy,
    write,
    compatImportPath: "@honua/sdk-esri-compat",
    target: cohort.codemodTarget,
  });
  const report = buildJsMigrationReport(workingCopy, codemodResult, scanReport);
  return { workingCopy, scanReport, codemodResult, report };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("2026.1 JavaScript migration cohort", () => {
  it("covers every required API line, capability and usage pattern", () => {
    expect(cohort.schemaVersion).toBe("honua.js-migration-cohort.v1");
    expect(cohort.release).toBe("2026.1");
    expect(new Set(cohort.members.map((member) => member.id)).size).toBe(cohort.members.length);

    const apiLines = new Set(cohort.members.map((member) => member.apiLine));
    const capabilities = new Set(cohort.members.flatMap((member) => member.capabilities));
    const patterns = new Set(cohort.members.flatMap((member) => member.usagePatterns));
    for (const apiLine of cohort.requiredApiLines) {
      expect(apiLines, `no member pins ${apiLine}`).toContain(apiLine);
    }
    for (const capability of cohort.requiredCapabilities) {
      expect(capabilities, `no member exercises ${capability}`).toContain(capability);
    }
    for (const pattern of cohort.requiredUsagePatterns) {
      expect(patterns, `no member uses ${pattern}`).toContain(pattern);
    }
  });

  it("names every member in the published cohort page", () => {
    const doc = fs.readFileSync(COHORT_DOC_PATH, "utf8");
    for (const member of cohort.members) {
      expect(doc, member.id).toContain(`\`${member.id}\``);
      expect(doc, member.fixture).toContain(member.fixture);
    }
  });

  describe.each(cohort.members.map((member) => [member.id, member] as const))("%s", (_id, member) => {
    const fixtureRoot = path.join(FIXTURES_ROOT, member.fixture);

    it("is a 2D FeatureLayer/MapView app whose source shows every claimed capability and pattern", () => {
      const sources = readFixtureSources(fixtureRoot);
      const allText = sources.map((source) => source.text).join("\n");
      for (const modulePath of [...cohort.scope.views, ...cohort.scope.layers]) {
        expect(allText, modulePath).toMatch(new RegExp(`["']${modulePath}(?:\\.js)?["']`));
      }
      expect(allText).not.toMatch(/SceneView|WebScene|["']@arcgis\/core\/views\/3d\//);

      for (const capability of member.capabilities) {
        const evidence = CAPABILITY_EVIDENCE[capability];
        expect(
          evidence.some((pattern) => pattern.test(allText)),
          `${member.fixture} claims ${capability} without source evidence`,
        ).toBe(true);
      }
      const detected = detectUsagePatterns(sources);
      for (const pattern of member.usagePatterns) {
        expect(detected, `${member.fixture} claims ${pattern}`).toContain(pattern);
      }
    });

    it("pins the API line it claims", () => {
      const manifestPath = path.join(fixtureRoot, "package.json");
      if (member.apiLine === "unpinned") {
        return;
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const range = manifest.dependencies?.["@arcgis/core"] ?? "";
      expect(range.match(/(\d+)\./)?.[1], `@arcgis/core range ${range}`).toBe(member.apiLine.split(".")[0]);
    });

    it("migrates to the hand-counted verdict", () => {
      const { workingCopy, scanReport, codemodResult, report } = migrateCopy(fixtureRoot, true);
      const inventory = report.usageInventory;

      expect(scanReport.flags).not.toContain("scene-3d-detected");
      expect(report.readiness).toBe(member.expected.readiness);
      expect({
        moduleSites: inventory.moduleSites,
        handledModuleSites: inventory.handledModuleSites,
        automaticCallSites: inventory.automaticCallSites,
        manualCallSites: inventory.manualCallSites,
        arcgisRuntimeWidgetSites: inventory.arcgisRuntimeWidgetSites,
      }).toEqual({
        moduleSites: member.expected.moduleSites,
        handledModuleSites: member.expected.handledModuleSites,
        automaticCallSites: member.expected.automaticCallSites,
        manualCallSites: member.expected.manualCallSites,
        arcgisRuntimeWidgetSites: member.expected.arcgisRuntimeWidgetSites,
      });
      expect(report.unhandledArcGisModules.map((item) => item.modulePath).sort()).toEqual(
        [...member.expected.unhandledModules].sort(),
      );
      expect(inventory.residualArcGisDependencies.map((dependency) => dependency.name).sort()).toEqual(
        [...member.expected.residualArcGisDependencies].sort(),
      );

      // The verdict must match the migrated bytes: whatever still imports ArcGIS
      // after the codemod is exactly what the report lists as unhandled.
      const survivingModules = readFixtureSources(workingCopy)
        .flatMap((source) => findArcGisModuleSites(source.text, source.relativePath))
        .map((site) => site.modulePath);
      expect([...new Set(survivingModules)].sort()).toEqual([...member.expected.unhandledModules].sort());
      expect(codemodResult.residualArcGisModuleSites?.length).toBe(survivingModules.length);
    });
  });
});

// Hand-counted from fixtures/esri-type-only-imports-app (6 static imports):
// - a-type-default.ts: `import type FeatureLayer`, used only as a type. Left in place.
// - b-value-as-type.ts: value `import FeatureLayer`, used only as a type; no
//   constructor to rewrite, so the import is left in place.
// - c-inline-type.ts: `import { type default as MapView }` (left in place) and
//   `import Map` with one `new Map(...)` (rewritten to MapCompat).
// - d-mixed.ts: `import type MapView` (left in place) and `import FeatureLayer`
//   with one `new FeatureLayer(...)` (rewritten to FeatureLayerCompat).
// Every module is in codemod scope, so scope alone would call all 6 handled.
describe("imports the codemod leaves in place", () => {
  const expectedSurvivors = [
    "a-type-default.ts:@arcgis/core/layers/FeatureLayer",
    "b-value-as-type.ts:@arcgis/core/layers/FeatureLayer",
    "c-inline-type.ts:@arcgis/core/views/MapView",
    "d-mixed.ts:@arcgis/core/views/MapView",
  ];

  it.each([
    ["after writing", true],
    ["in a dry run", false],
  ])("are unhandled even when their module is in codemod scope (%s)", (_label, write) => {
    const { codemodResult, report } = migrateCopy(TYPE_ONLY_FIXTURE_ROOT, write);
    const inventory = report.usageInventory;

    expect(codemodResult.filesChanged).toBe(2);
    expect({
      moduleSites: inventory.moduleSites,
      handledModuleSites: inventory.handledModuleSites,
      unsupportedModuleSites: inventory.unsupportedModuleSites,
      codemodScopedCallSites: inventory.codemodScopedCallSites,
      automaticCallSites: inventory.automaticCallSites,
    }).toEqual({
      moduleSites: 6,
      handledModuleSites: 2,
      unsupportedModuleSites: 4,
      codemodScopedCallSites: 2,
      automaticCallSites: 2,
    });
    expect(report.unhandledArcGisModules).toEqual([
      { modulePath: "@arcgis/core/layers/FeatureLayer", usageStyle: "static-import", count: 2 },
      { modulePath: "@arcgis/core/views/MapView", usageStyle: "static-import", count: 2 },
    ]);
    expect(report.gates.find((gate) => gate.gate === "no-unhandled-modules")?.passed).toBe(false);
    expect(report.readiness).toBe("assisted");
    expect(
      (codemodResult.residualArcGisModuleSites ?? [])
        .map((site) => `${path.basename(site.file)}:${site.modulePath}`)
        .sort(),
    ).toEqual(expectedSurvivors);
  });

  it("does not record the `type` modifier as an imported symbol", () => {
    const scanReport = scanArcGisUsage(TYPE_ONLY_FIXTURE_ROOT);
    const symbolsByFile = scanReport.imports.map(
      (hit) => `${path.basename(hit.file)}:${hit.modulePath}:${hit.symbols.join(",")}`,
    );

    expect(symbolsByFile.sort()).toEqual([
      "a-type-default.ts:@arcgis/core/layers/FeatureLayer:FeatureLayer",
      "b-value-as-type.ts:@arcgis/core/layers/FeatureLayer:FeatureLayer",
      "c-inline-type.ts:@arcgis/core/Map:Map",
      "c-inline-type.ts:@arcgis/core/views/MapView:MapView",
      "d-mixed.ts:@arcgis/core/layers/FeatureLayer:FeatureLayer",
      "d-mixed.ts:@arcgis/core/views/MapView:MapView",
    ]);
    expect(scanReport.symbolUsageCounts).not.toHaveProperty("type");
  });
});
