import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HONUA_COMPAT_BUNDLER_WORKAROUND_DEPENDENCIES,
  HONUA_COMPAT_RUNTIME_DEPENDENCIES,
  type JsDependencyChange,
  type JsMigrationPipelineReport,
  type JsMigrationPlan,
  SDK_JS_OPTIONAL_GRPC_PEERS_ISSUE,
  applyJsMigration,
  createUnifiedDiff,
  planJsMigration,
} from "../src/migration/pipeline.js";
import { getProjectRoot, withCliLock } from "./migration-cli-lock.js";
import { getPreparedMigrationCliPath } from "./prepared-sdk-artifacts.js";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures");
const PACKAGE_ROOT = path.resolve(getProjectRoot(), "..");
const PIPELINE_FIXTURE = "js-migration-pipeline-app";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "honua-pipeline-"));
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

/** Every file except node_modules and dist, as text. */
function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        files[path.relative(root, fullPath).split(path.sep).join("/")] = fs.readFileSync(fullPath, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

function summarizeChanges(changes: readonly JsDependencyChange[]): Array<[string, string, string, string, boolean]> {
  return changes.map((change) => [
    change.action,
    change.section,
    change.name,
    change.version,
    change.workaround === SDK_JS_OPTIONAL_GRPC_PEERS_ISSUE,
  ]);
}

function stageStatuses(report: JsMigrationPipelineReport): Array<[string, string]> {
  return report.stages.map((stage) => [stage.stage, stage.status]);
}

function gitApply(root: string, patch: string): ReturnType<typeof spawnSync> {
  const patchFile = path.join(tempRoot(), "review.patch");
  fs.writeFileSync(patchFile, patch);
  return spawnSync("git", ["apply", "--verbose", patchFile], { cwd: root, encoding: "utf8" });
}

function runCli(args: readonly string[]): ReturnType<typeof spawnSync> {
  return withCliLock(() =>
    spawnSync("node", [getPreparedMigrationCliPath(), ...args], { cwd: getProjectRoot(), encoding: "utf8" }),
  );
}

// The five packages a honua-compat migration adds to an app that declares none of them.
const COMPAT_ADDITIONS: Array<[string, string, string, string, boolean]> = [
  ["add", "dependencies", "@honua/sdk", "^0.1.2-beta.0", false],
  ["add", "dependencies", "@honua/sdk-esri-compat", "^0.1.2-beta.0", false],
  ["add", "dependencies", "@bufbuild/protobuf", "^2.15.0", true],
  ["add", "dependencies", "@connectrpc/connect", "^2.2.0", true],
  ["add", "dependencies", "@connectrpc/connect-web", "^2.2.0", true],
];

const MAP_ONLY_SOURCE =
  'import Map from "@arcgis/core/Map";\n\nexport const map = new Map({ basemap: "streets-vector" });\n';

describe("JS migration pipeline", () => {
  it("plans the runtime ranges this package is built and browser-tested against", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    for (const [name, range] of Object.entries(HONUA_COMPAT_RUNTIME_DEPENDENCIES)) {
      expect(manifest.dependencies[name], name).toBe(range);
    }
    for (const [name, range] of Object.entries(HONUA_COMPAT_BUNDLER_WORKAROUND_DEPENDENCIES)) {
      expect(manifest.devDependencies[name], name).toBe(range);
    }
  });

  it("writes unified diffs with context, separate hunks, missing newlines and new files", () => {
    expect(createUnifiedDiff("src/x.ts", "a\nb\nc\nd\ne\nf\ng\nh\n", "a\nb\nc\nD\ne\nf\ng\nh\ni\n")).toBe(
      [
        "diff --git a/src/x.ts b/src/x.ts",
        "--- a/src/x.ts",
        "+++ b/src/x.ts",
        "@@ -1,8 +1,9 @@",
        " a",
        " b",
        " c",
        "-d",
        "+D",
        " e",
        " f",
        " g",
        " h",
        "+i",
        "",
      ].join("\n"),
    );

    const twelve = Array.from({ length: 12 }, (_, index) => String(index + 1));
    const edited = twelve.map((line) => (line === "2" ? "two" : line === "11" ? "eleven" : line));
    expect(createUnifiedDiff("n.txt", `${twelve.join("\n")}\n`, `${edited.join("\n")}\n`)).toBe(
      [
        "diff --git a/n.txt b/n.txt",
        "--- a/n.txt",
        "+++ b/n.txt",
        "@@ -1,5 +1,5 @@",
        " 1",
        "-2",
        "+two",
        " 3",
        " 4",
        " 5",
        "@@ -8,5 +8,5 @@",
        " 8",
        " 9",
        " 10",
        "-11",
        "+eleven",
        " 12",
        "",
      ].join("\n"),
    );

    expect(createUnifiedDiff("x", "x", "x\n")).toBe(
      [
        "diff --git a/x b/x",
        "--- a/x",
        "+++ b/x",
        "@@ -1,1 +1,1 @@",
        "-x",
        "\\ No newline at end of file",
        "+x",
        "",
      ].join("\n"),
    );
    expect(createUnifiedDiff("new.ts", undefined, "a\n")).toBe(
      [
        "diff --git a/new.ts b/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.ts",
        "@@ -0,0 +1,1 @@",
        "+a",
        "",
      ].join("\n"),
    );
    expect(createUnifiedDiff("same.ts", "a\n", "a\n")).toBe("");
  });

  it("plans a complete conversion as a reviewable patch without touching the app", () => {
    const app = copyFixture(PIPELINE_FIXTURE);
    const before = readTree(app);

    const plan = planJsMigration({ appRoot: app });

    expect(readTree(app)).toEqual(before);
    expect(planJsMigration({ appRoot: app }).planDigest).toBe(plan.planDigest);
    expect(plan.mode).toBe("complete-honua-conversion");
    // browser-check.mjs, index.html, package.json, src/main.ts
    expect(plan.filesHashed).toBe(4);
    expect(plan.sourceChanges.map((change) => change.file)).toEqual(["src/main.ts"]);
    expect(plan.manifest).toEqual({ path: "package.json", changed: true });
    // The fixture declares @arcgis/core ^4.34.8 in dependencies and none of the Honua packages.
    expect(summarizeChanges(plan.dependencyChanges)).toEqual([
      ...COMPAT_ADDITIONS,
      ["remove", "dependencies", "@arcgis/core", "^4.34.8", false],
    ]);
    expect(plan.configReferences).toEqual([]);
    expect(plan.holds).toEqual([]);

    const reviewCopy = copyFixture(PIPELINE_FIXTURE);
    const applied = gitApply(reviewCopy, plan.patch);
    expect(applied.status, `${applied.stdout}${applied.stderr}`).toBe(0);
    expect(readTree(reviewCopy)["src/main.ts"]).not.toContain("@arcgis/");
    expect(JSON.parse(readTree(reviewCopy)["package.json"])).toEqual({
      name: "js-migration-pipeline-app",
      private: true,
      type: "module",
      scripts: {
        build: "vite build",
        "test:browser": "node browser-check.mjs",
      },
      dependencies: {
        "@bufbuild/protobuf": "^2.15.0",
        "@connectrpc/connect": "^2.2.0",
        "@connectrpc/connect-web": "^2.2.0",
        "@honua/sdk": "^0.1.2-beta.0",
        "@honua/sdk-esri-compat": "^0.1.2-beta.0",
      },
      devDependencies: {
        "playwright-core": "1.58.2",
        vite: "8.1.5",
      },
    });
  });

  it("plans, applies, installs, builds and validates the migrated app in Chromium through the CLI", () => {
    // The app lives in the OS temp directory, so `npm install` resolves the
    // planned dependencies from the registry, never from this repository's
    // node_modules: the build only passes if the planned dependency set is enough.
    const app = copyFixture(PIPELINE_FIXTURE);
    const workDir = tempRoot();
    const planDir = path.join(workDir, "plan");
    const reportPath = path.join(workDir, "pipeline-report.json");

    const planRun = runCli(["migrate", app, "--plan", planDir]);
    expect(planRun.status, `${planRun.stdout}${planRun.stderr}`).toBe(0);
    const plan = JSON.parse(fs.readFileSync(path.join(planDir, "migration-plan.json"), "utf8")) as JsMigrationPlan;
    expect(planRun.stdout).toContain(`planDigest=${plan.planDigest}\n`);
    expect(planRun.stdout).toContain("mode=complete-honua-conversion\n");
    expect(fs.readFileSync(path.join(planDir, "migration.patch"), "utf8")).toBe(plan.patch);

    const reviewCopy = copyFixture(PIPELINE_FIXTURE);
    expect(gitApply(reviewCopy, plan.patch).status).toBe(0);

    const applyRun = runCli([
      "migrate",
      app,
      "--apply",
      plan.planDigest,
      "--install",
      "--build-script",
      "build",
      "--browser-script",
      "test:browser",
      "--report",
      reportPath,
    ]);
    expect(applyRun.status, `${applyRun.stdout}${applyRun.stderr}`).toBe(0);
    expect(applyRun.stdout).toContain("verdict=browser-validated\n");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as JsMigrationPipelineReport;
    expect(stageStatuses(report)).toEqual([
      ["review", "passed"],
      ["codemod", "passed"],
      ["dependencies", "passed"],
      ["install", "passed"],
      ["build", "passed"],
      ["browser", "passed"],
    ]);
    expect(report.verdict).toBe("browser-validated");
    expect(report.arcgisRuntime).toEqual({
      moduleSites: 0,
      dependencies: [],
      widgetSitesOnArcGisRuntime: 0,
      required: false,
    });
    // What apply wrote is exactly what the reviewed patch describes; npm install added only its lock file.
    const { "package-lock.json": lockFile, ...appliedTree } = readTree(app);
    expect(lockFile).toBeDefined();
    expect(appliedTree).toEqual(readTree(reviewCopy));
    expect(report.residualWork.map((item) => [item.source, item.message.split(" ")[0]])).toEqual([
      ["workaround", "@bufbuild/protobuf@^2.15.0"],
      ["workaround", "@connectrpc/connect@^2.2.0"],
      ["workaround", "@connectrpc/connect-web@^2.2.0"],
    ]);

    // Observed in Chromium. Expected by hand from the fixture server: three
    // trails, of which Backbone Trail and Mishe Mokwa have DIFFICULTY 'easy'.
    const observations = JSON.parse(fs.readFileSync(path.join(app, "dist", "browser-observations.json"), "utf8")) as {
      observed: Record<string, string>;
      pageErrors: string[];
      offOrigin: string[];
      requests: string[];
    };
    expect(observations.observed).toEqual({ count: "2", view: "viewDiv", text: "Backbone Trail, Mishe Mokwa" });
    expect(observations.pageErrors).toEqual([]);
    expect(observations.offOrigin).toEqual([]);
    const queries = observations.requests
      .map((request) => new URL(request.split(" ")[1], "http://fixture.test"))
      .filter((url) => url.pathname === "/rest/services/trails/FeatureServer/0/query");
    expect(queries.map((url) => url.searchParams.get("where"))).toEqual(["DIFFICULTY = 'easy'"]);
  }, 300_000);

  it("refuses a digest the current tree no longer produces and writes nothing", () => {
    const app = copyFixture(PIPELINE_FIXTURE);
    const plan = planJsMigration({ appRoot: app });
    fs.appendFileSync(path.join(app, "src", "main.ts"), "// edited after review\n");
    const before = readTree(app);

    const report = applyJsMigration({ appRoot: app, approvedDigest: plan.planDigest, buildScript: "build" });

    expect(report.verdict).toBe("refused");
    expect(report.planDigest).not.toBe(plan.planDigest);
    expect(stageStatuses(report)).toEqual([
      ["review", "refused"],
      ["codemod", "not-run"],
      ["dependencies", "not-run"],
      ["install", "not-run"],
      ["build", "not-run"],
      ["browser", "not-run"],
    ]);
    expect(readTree(app)).toEqual(before);
    // Nothing was written: the fixture's three ArcGIS imports and its @arcgis/core dependency remain.
    expect(report.arcgisRuntime).toEqual({
      moduleSites: 3,
      dependencies: ["@arcgis/core"],
      widgetSitesOnArcGisRuntime: 0,
      required: true,
    });
  });

  it("reports a failing browser script as failed and a missing build script as failed", () => {
    const failingBrowser = writeApp({
      "package.json": `${JSON.stringify({ private: true, scripts: { "test:browser": 'node -e "process.exit(3)"' } }, null, 2)}\n`,
      "src/main.ts": MAP_ONLY_SOURCE,
    });
    const plan = planJsMigration({ appRoot: failingBrowser });

    const report = applyJsMigration({
      appRoot: failingBrowser,
      approvedDigest: plan.planDigest,
      browserScript: "test:browser",
    });

    expect(report.verdict).toBe("failed");
    expect(stageStatuses(report)).toEqual([
      ["review", "passed"],
      ["codemod", "passed"],
      ["dependencies", "passed"],
      ["install", "not-run"],
      ["build", "not-run"],
      ["browser", "failed"],
    ]);
    expect(report.stages[5]).toMatchObject({ command: ["npm", "run", "test:browser"], exitCode: 3 });

    const missingBuild = writeApp({ "package.json": '{ "private": true }\n', "src/main.ts": MAP_ONLY_SOURCE });
    const missingPlan = planJsMigration({ appRoot: missingBuild });
    const missingReport = applyJsMigration({
      appRoot: missingBuild,
      approvedDigest: missingPlan.planDigest,
      buildScript: "build",
      browserScript: "test:browser",
    });
    expect(missingReport.verdict).toBe("failed");
    expect(missingReport.stages.slice(4)).toEqual([
      { stage: "build", status: "failed", detail: 'package.json at the application root declares no "build" script.' },
      { stage: "browser", status: "not-run", detail: "Not run: the build failed." },
    ]);
  });

  it("keeps an assisted conversion's ArcGIS dependency and reports what still needs it", () => {
    const app = copyFixture("esri-cohort-typed-esm-app");
    const selectionBefore = fs.readFileSync(path.join(app, "src", "selection.ts"), "utf8");
    const plan = planJsMigration({ appRoot: app });

    expect(plan.mode).toBe("assisted-conversion");
    expect(plan.sourceChanges.map((change) => change.file)).toEqual(["src/main.ts"]);
    expect(summarizeChanges(plan.dependencyChanges)).toEqual([
      ...COMPAT_ADDITIONS,
      ["keep", "dependencies", "@arcgis/core", "^5.0.19", false],
    ]);
    expect(plan.dependencyChanges[5].reason).toBe(
      "Assisted conversion: src/selection.ts still needs the ArcGIS JS runtime.",
    );

    const report = applyJsMigration({ appRoot: app, approvedDigest: plan.planDigest });

    expect(report.verdict).toBe("unvalidated");
    expect(fs.readFileSync(path.join(app, "src", "selection.ts"), "utf8")).toBe(selectionBefore);
    // selection.ts keeps its four type-only imports (Graphic, Point, FeatureLayer, MapView).
    expect(report.arcgisRuntime).toEqual({
      moduleSites: 4,
      dependencies: ["@arcgis/core"],
      widgetSitesOnArcGisRuntime: 0,
      required: true,
    });
    expect(report.residualWork.map((item) => [item.source, item.file ?? null, item.code ?? null])).toEqual([
      ["file-diagnostic", "src/selection.ts", "import-left-in-place"],
      ["file-diagnostic", "src/selection.ts", "import-left-in-place"],
      ["file-diagnostic", "src/selection.ts", "import-left-in-place"],
      ["file-diagnostic", "src/selection.ts", "import-left-in-place"],
      ["workaround", "package.json", null],
      ["workaround", "package.json", null],
      ["workaround", "package.json", null],
      ["dependency", "package.json", null],
      ["stage", null, null],
      ["stage", null, null],
      ["stage", null, null],
    ]);
  });

  it("changes nothing when it recommends keeping the ArcGIS client", () => {
    const app = writeApp({
      "package.json": `${JSON.stringify({ private: true, dependencies: { "@arcgis/core": "^4.34.8" } }, null, 2)}\n`,
      "src/main.ts": [
        'import Map from "@arcgis/core/Map";',
        'import SceneView from "@arcgis/core/views/SceneView";',
        "",
        'export const view = new SceneView({ map: new Map({ basemap: "satellite" }), container: "viewDiv" });',
        "",
      ].join("\n"),
    });
    const before = readTree(app);
    const plan = planJsMigration({ appRoot: app });

    expect(plan.mode).toBe("keep-esri-client");
    expect(plan.sourceChanges).toEqual([]);
    expect(plan.patch).toBe("");
    expect(summarizeChanges(plan.dependencyChanges)).toEqual([
      ["keep", "dependencies", "@arcgis/core", "^4.34.8", false],
    ]);

    const report = applyJsMigration({ appRoot: app, approvedDigest: plan.planDigest });

    expect(readTree(app)).toEqual(before);
    expect(stageStatuses(report).slice(0, 3)).toEqual([
      ["review", "passed"],
      ["codemod", "not-run"],
      ["dependencies", "not-run"],
    ]);
    expect(report.residualWork.map((item) => item.source)).toEqual(["mode", "dependency"]);
    expect(report.arcgisRuntime.required).toBe(true);
  });

  it("holds configuration and manifests it does not rewrite", () => {
    const app = writeApp({
      "vite.config.ts": [
        'import { defineConfig } from "vite";',
        "",
        "export default defineConfig({",
        '  optimizeDeps: { exclude: ["@arcgis/core"] },',
        "});",
        "",
      ].join("\n"),
      "src/main.ts": MAP_ONLY_SOURCE,
    });

    const plan = planJsMigration({ appRoot: app });

    expect(plan.mode).toBe("complete-honua-conversion");
    expect(plan.manifest).toBeNull();
    expect(plan.dependencyChanges).toEqual([]);
    expect(plan.configReferences).toEqual([
      {
        file: "vite.config.ts",
        line: 4,
        text: 'optimizeDeps: { exclude: ["@arcgis/core"] },',
        action:
          "This configuration names the ArcGIS JS runtime and the plan does not rewrite it; update or remove the entry by hand once no source imports ArcGIS.",
      },
    ]);
    expect(plan.holds).toEqual([
      {
        stage: "dependencies",
        message: "There is no package.json at the application root, so no dependency changes were planned.",
        action:
          "Declare @honua/sdk, @honua/sdk-esri-compat, @bufbuild/protobuf, @connectrpc/connect, @connectrpc/connect-web in the manifest that builds this app.",
      },
    ]);

    const report = applyJsMigration({ appRoot: app, approvedDigest: plan.planDigest });
    expect(report.stages[2]).toEqual({
      stage: "dependencies",
      status: "not-run",
      detail: "Not run: There is no package.json at the application root, so no dependency changes were planned.",
    });
    expect(report.residualWork.map((item) => item.source)).toEqual([
      "config-reference",
      "hold",
      "stage",
      "stage",
      "stage",
      "stage",
    ]);
  });

  it("refuses plan and report paths inside the application root", () => {
    const app = copyFixture(PIPELINE_FIXTURE);
    const before = readTree(app);

    const result = runCli(["migrate", app, "--plan", path.join(app, "review")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "migrateError=Write the plan and report outside the application root; files inside it change the reviewed tree.",
    );
    expect(readTree(app)).toEqual(before);
  });
});
