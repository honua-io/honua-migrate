import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runEsriCompatCodemod } from "../src/migration/codemod.js";
import {
  type JsConversionMode,
  type JsFileMigration,
  type JsMigrationReport,
  buildJsMigrationReport,
} from "../src/migration/report.js";
import { scanArcGisUsage } from "../src/migration/scanner.js";
import { getWidgetDisposition } from "../src/migration/widget-dispositions.js";
import { getProjectRoot, withCliLock } from "./migration-cli-lock.js";
import { getPreparedMigrationCliPath } from "./prepared-sdk-artifacts.js";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "honua-conversion-"));
  tempDirs.push(root);
  return root;
}

function copyFixture(name: string): string {
  const app = path.join(tempRoot(), name);
  fs.cpSync(path.join(FIXTURES_ROOT, name), app, { recursive: true });
  return app;
}

function writeApp(files: Record<string, string>): string {
  const app = path.join(tempRoot(), "app");
  for (const [relativePath, text] of Object.entries(files)) {
    const fullPath = path.join(app, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, text);
  }
  return app;
}

function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.set(path.relative(root, fullPath).split(path.sep).join("/"), fs.readFileSync(fullPath, "utf8"));
      }
    }
  };
  walk(root);
  return files;
}

function migrate(app: string, write: boolean): JsMigrationReport {
  const scanReport = scanArcGisUsage(app);
  const codemodResult = runEsriCompatCodemod({
    rootDir: app,
    write,
    compatImportPath: "@honua/sdk-esri-compat",
    target: "honua-compat",
  });
  return buildJsMigrationReport(app, codemodResult, scanReport);
}

function summarizeFiles(report: JsMigrationReport): Record<string, unknown> {
  return Object.fromEntries(
    report.conversion.files.map((file: JsFileMigration) => [
      file.file,
      {
        boundary: file.boundary,
        moduleSites: file.moduleSites,
        handledModuleSites: file.handledModuleSites,
        manualCallSites: file.manualCallSites,
        codes: file.diagnostics.map((diagnostic) => diagnostic.code),
      },
    ]),
  );
}

function modeAvailability(report: JsMigrationReport): Record<JsConversionMode, boolean> {
  return Object.fromEntries(report.conversion.modes.map((mode) => [mode.mode, mode.available])) as Record<
    JsConversionMode,
    boolean
  >;
}

function modeDetail(report: JsMigrationReport, mode: JsConversionMode): string | undefined {
  return report.conversion.modes.find((assessment) => assessment.mode === mode)?.detail;
}

const MAP_ONLY_SOURCE =
  'import Map from "@arcgis/core/Map";\n\nexport const map = new Map({ basemap: "streets-vector" });\n';

// Hand-counted from fixtures/esri-widget-cliff-app (18 module sites in 4 files):
// - src/main.ts: Map, MapView, Legend, LayerList and Expand are rewritten;
//   SearchViewModel is a Search support module outside codemod scope.
// - src/editing.ts: the dynamic Print import is rewritten. Editor and
//   FeatureTable are in scope, but both also name the return type, so their
//   imports stay.
// - src/legacy-amd.js: five modules in AMD require/define arrays, left as written.
// - src/cdn-map-components.js: four `$arcgis.import` modules, left as written.
const WIDGET_CLIFF_FILES = {
  "src/cdn-map-components.js": {
    boundary: "kept",
    moduleSites: 4,
    handledModuleSites: 0,
    manualCallSites: 0,
    codes: Array(4).fill("module-loader-not-rewritten"),
  },
  "src/editing.ts": {
    boundary: "mixed",
    moduleSites: 3,
    handledModuleSites: 1,
    manualCallSites: 0,
    codes: ["import-left-in-place", "import-left-in-place"],
  },
  "src/legacy-amd.js": {
    boundary: "kept",
    moduleSites: 5,
    handledModuleSites: 0,
    manualCallSites: 0,
    codes: Array(5).fill("module-loader-not-rewritten"),
  },
  "src/main.ts": {
    boundary: "mixed",
    moduleSites: 6,
    handledModuleSites: 5,
    manualCallSites: 0,
    codes: ["widget-on-arcgis-runtime"],
  },
};

describe("JS conversion plan", () => {
  it.each([
    ["after writing", true],
    ["in a dry run", false],
  ])("holds unsupported sites per file with diagnostics and recommends assisted conversion (%s)", (_label, write) => {
    const app = copyFixture("esri-widget-cliff-app");
    const before = readTree(app);
    const report = migrate(app, write);
    const { conversion, usageInventory } = report;

    expect(summarizeFiles(report)).toEqual(WIDGET_CLIFF_FILES);
    expect(conversion.fileBoundaries).toEqual({ converted: 0, mixed: 2, kept: 2, held: 0 });
    expect(conversion.recommendedMode).toBe("assisted-conversion");
    expect(modeAvailability(report)).toEqual({
      "keep-esri-client": true,
      "assisted-conversion": true,
      "complete-honua-conversion": false,
    });

    // The per-file rows add up to the app-level denominators.
    const sum = (pick: (file: JsFileMigration) => number): number =>
      conversion.files.reduce((total, file) => total + pick(file), 0);
    expect(sum((file) => file.moduleSites)).toBe(usageInventory.moduleSites);
    expect(sum((file) => file.handledModuleSites)).toBe(usageInventory.handledModuleSites);
    expect(sum((file) => file.diagnostics.filter((diagnostic) => diagnostic.modulePath).length)).toBe(
      usageInventory.unsupportedModuleSites,
    );

    const heldSites = conversion.files.flatMap((file) =>
      file.diagnostics.map((diagnostic) => `${file.file} ${diagnostic.modulePath}`),
    );
    expect(heldSites.sort()).toEqual([
      "src/cdn-map-components.js @arcgis/core/widgets/Daylight.js",
      "src/cdn-map-components.js esri/layers/GraphicsLayer",
      "src/cdn-map-components.js esri/widgets/ElevationProfile",
      "src/cdn-map-components.js esri/widgets/Sketch",
      "src/editing.ts @arcgis/core/widgets/Editor",
      "src/editing.ts @arcgis/core/widgets/FeatureTable",
      "src/legacy-amd.js esri/Map",
      "src/legacy-amd.js esri/views/MapView",
      "src/legacy-amd.js esri/widgets/BasemapGallery",
      "src/legacy-amd.js esri/widgets/Directions",
      "src/legacy-amd.js esri/widgets/TimeSlider",
      "src/main.ts @arcgis/core/widgets/Search/SearchViewModel",
    ]);
    for (const diagnostic of conversion.files.flatMap((file) => file.diagnostics)) {
      expect(diagnostic.message).not.toBe("");
      expect(diagnostic.action).not.toBe("");
    }
    const searchViewModel = conversion.files.find((file) => file.file === "src/main.ts")?.diagnostics[0];
    expect(searchViewModel?.action).toContain(getWidgetDisposition("Search")?.target);

    expect(modeDetail(report, "complete-honua-conversion")).toBe(
      "Not available: 12 ArcGIS module sites left in place; 9 widget sites on the classic ArcGIS widget runtime.",
    );

    // Kept files, and every file in a dry run, are byte-identical afterwards.
    const after = readTree(app);
    for (const [file, expected] of Object.entries(WIDGET_CLIFF_FILES)) {
      if (!write || expected.boundary === "kept") {
        expect(after.get(file), file).toBe(before.get(file));
      } else {
        expect(after.get(file), file).not.toBe(before.get(file));
      }
    }
  });

  it("recommends keeping the Esri client when the codemod rewrites nothing", () => {
    const app = copyFixture("esri-assisted-side-effect-app");
    const before = readTree(app);
    const report = migrate(app, true);

    expect(report.readiness).toBe("assisted");
    expect(summarizeFiles(report)).toEqual({
      "src/main.ts": {
        boundary: "kept",
        moduleSites: 1,
        handledModuleSites: 0,
        manualCallSites: 0,
        codes: ["unsupported-module"],
      },
    });
    expect(report.conversion.recommendedMode).toBe("keep-esri-client");
    expect(modeAvailability(report)).toEqual({
      "keep-esri-client": true,
      "assisted-conversion": false,
      "complete-honua-conversion": false,
    });
    expect(modeDetail(report, "assisted-conversion")).toBe("Not available: the codemod rewrites no file in this app.");
    expect(readTree(app)).toEqual(before);
  });

  it("recommends keeping the Esri client for blocked apps even when every file converts", () => {
    // fixtures/esri-sample-app: four static imports in src/main.ts and a dynamic
    // SceneView import in src/lazy.ts, all rewritten; SceneView blocks the 2D path.
    const report = migrate(copyFixture("esri-sample-app"), false);

    expect(report.readiness).toBe("blocked");
    expect(summarizeFiles(report)).toEqual({
      "src/lazy.ts": { boundary: "converted", moduleSites: 1, handledModuleSites: 1, manualCallSites: 0, codes: [] },
      "src/main.ts": { boundary: "converted", moduleSites: 4, handledModuleSites: 4, manualCallSites: 0, codes: [] },
    });
    expect(report.conversion.recommendedMode).toBe("keep-esri-client");
    expect(report.conversion.rationale).toContain("scene-3d-detected");
    expect(modeAvailability(report)).toEqual({
      "keep-esri-client": true,
      "assisted-conversion": false,
      "complete-honua-conversion": false,
    });
    expect(modeDetail(report, "complete-honua-conversion")).toBe("Not available: blocking flags: scene-3d-detected.");
  });

  it("holds a file the codemod cannot parse byte-identical, with a held-file diagnostic", () => {
    const brokenSource =
      'import FeatureLayer from "@arcgis/core/layers/FeatureLayer";\n\n' +
      'export const layer = new FeatureLayer({ url: "https://example.test/rest/services/parcels/FeatureServer/0" });\n' +
      "export function unfinished( {\n";
    const app = writeApp({ "src/broken.ts": brokenSource, "src/ok.ts": MAP_ONLY_SOURCE });
    const report = migrate(app, true);

    expect(summarizeFiles(report)).toEqual({
      "src/broken.ts": {
        boundary: "held",
        moduleSites: 1,
        handledModuleSites: 0,
        manualCallSites: 0,
        codes: ["held-file"],
      },
      "src/ok.ts": { boundary: "converted", moduleSites: 1, handledModuleSites: 1, manualCallSites: 0, codes: [] },
    });
    expect(fs.readFileSync(path.join(app, "src/broken.ts"), "utf8")).toBe(brokenSource);
    expect(fs.readFileSync(path.join(app, "src/ok.ts"), "utf8")).not.toContain("@arcgis/core");

    const held = report.conversion.files.find((file) => file.file === "src/broken.ts")?.diagnostics[0];
    expect(held?.message).toContain("left it unchanged");
    expect(held?.action).toBe(
      "Fix the transform error and rerun the codemod; until then its ArcGIS module sites (1) count as unhandled.",
    );
    expect(report.conversion.recommendedMode).toBe("assisted-conversion");
    expect(modeDetail(report, "complete-honua-conversion")).toBe(
      "Not available: 1 ArcGIS module site left in place; 1 file held on codemod errors.",
    );
  });

  it("points manual call sites at their line and column", () => {
    // fixtures/esri-reactive-utils-app line 5: `const watchHandle = reactiveUtils.watch(`
    // with a multi-statement accessor; `reactiveUtils` starts at column 21.
    const report = migrate(copyFixture("esri-reactive-utils-app"), false);

    expect(summarizeFiles(report)).toEqual({
      "src/main.ts": {
        boundary: "mixed",
        moduleSites: 1,
        handledModuleSites: 1,
        manualCallSites: 1,
        codes: ["manual-call-site"],
      },
    });
    const manual = report.conversion.files[0]?.diagnostics[0];
    expect({ line: manual?.line, column: manual?.column }).toEqual({ line: 5, column: 21 });
    expect(manual?.message).toContain("reactiveUtils.watch");
    expect(report.conversion.recommendedMode).toBe("assisted-conversion");
    expect(modeDetail(report, "complete-honua-conversion")).toBe("Not available: 1 manual call site to port.");
  });

  it("recommends a complete conversion and names residual dependencies to remove", () => {
    const app = writeApp({
      "package.json": `${JSON.stringify({ name: "app", private: true, dependencies: { "@arcgis/core": "^5.0.19" } })}\n`,
      "src/ok.ts": MAP_ONLY_SOURCE,
    });
    const report = migrate(app, true);

    expect(report.readiness).toBe("ready");
    expect(report.conversion.recommendedMode).toBe("complete-honua-conversion");
    expect(modeAvailability(report)).toEqual({
      "keep-esri-client": true,
      "assisted-conversion": false,
      "complete-honua-conversion": true,
    });
    expect(modeDetail(report, "complete-honua-conversion")).toBe(
      "The migrated source imports nothing from ArcGIS and every call site migrated automatically. Remove @arcgis/core from package.json to drop the ArcGIS JS runtime.",
    );
    expect(modeDetail(report, "assisted-conversion")).toBe(
      "Not available: nothing is held for review; the conversion is complete.",
    );
  });

  it("prints the plan and per-file diagnostics from the codemod command", () => {
    const result = withCliLock(() =>
      spawnSync("node", [getPreparedMigrationCliPath(), "codemod", path.join(FIXTURES_ROOT, "esri-widget-cliff-app")], {
        cwd: getProjectRoot(),
        encoding: "utf8",
      }),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("writeMode=dry-run");
    expect(result.stdout).toContain("conversion=recommended:assisted-conversion,converted:0,mixed:2,kept:2,held:0\n");
    expect(result.stdout).toContain(
      "- complete-honua-conversion unavailable: Not available: 12 ArcGIS module sites left in place; 9 widget sites on the classic ArcGIS widget runtime.\n",
    );
    expect(result.stdout).toContain(
      [
        "- src/legacy-amd.js [kept] handled 0/5 module sites, 0 manual call sites",
        "  - module-loader-not-rewritten esri/Map: esri/Map is loaded through an AMD require/define array, which the codemod leaves as written. Action: Keep this file on the ArcGIS JS client, or rewrite the load as an @arcgis/core ESM import and rerun the codemod.",
      ].join("\n"),
    );
  }, 240_000);

  it("recommends no mode when the scan discovers no ArcGIS usage", () => {
    const report = migrate(writeApp({ "src/plain.ts": "export const answer = 42;\n" }), true);

    expect(report.readiness).toBe("no-arcgis-usage");
    expect(report.conversion.recommendedMode).toBeNull();
    expect(report.conversion.files).toEqual([]);
    expect(modeAvailability(report)).toEqual({
      "keep-esri-client": false,
      "assisted-conversion": false,
      "complete-honua-conversion": false,
    });
  });
});
