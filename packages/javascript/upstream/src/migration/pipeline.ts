import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { type CodemodTarget, runEsriCompatCodemod } from "./codemod.js";
import { writeOutputFilesAtomically } from "./output-writer.js";
import { type JsConversionMode, type JsMigrationReport, buildJsMigrationReport } from "./report.js";
import { type ArcGisDependencySection, scanArcGisUsage } from "./scanner.js";

/**
 * The reviewed migration pipeline for one ArcGIS JS application:
 *
 * 1. scan and plan: the scanner, codemod and report run unchanged; the codemod
 *    writes into a throwaway copy, so the plan carries the exact source patch
 *    and `package.json` change without touching the app;
 * 2. review: the plan has a digest over every input and output, and apply
 *    refuses any digest but the one a fresh plan produces;
 * 3. apply the source and dependency changes;
 * 4. install, build and browser validation through the app's own npm scripts;
 * 5. a residual-work report that says which stages ran and what is left.
 *
 * It adds no transforms of its own.
 */

export const JS_MIGRATION_PLAN_SCHEMA_VERSION = "honua.js-migration-plan.v1";
export const JS_MIGRATION_PIPELINE_REPORT_SCHEMA_VERSION = "honua.js-migration-pipeline.v1";

const DEFAULT_COMPAT_IMPORT_PATH = "@honua/sdk-esri-compat";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const MANIFEST = "package.json";
const DEPENDENCY_SECTIONS: readonly ArcGisDependencySection[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const DEFAULT_SCRIPT_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL_LINES = 40;
const OUTPUT_TAIL_CHARS = 4000;
const NPM_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

/** Packages the honua-compat output imports, at the ranges this engine is built and tested against. */
export const HONUA_COMPAT_RUNTIME_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@honua/sdk": "^0.1.2-beta.0",
  "@honua/sdk-esri-compat": "^0.1.2-beta.0",
};

export const SDK_JS_OPTIONAL_GRPC_PEERS_ISSUE = "https://github.com/honua-io/honua-sdk-js/issues/1715";

/**
 * Optional gRPC peers of `@honua/sdk` that `@honua/sdk-esri-compat` imports from
 * its client (`core/client.js`, `core/grpc-adapter.js`). Bundlers such as Vite
 * fail to resolve those imports when the packages are absent, even in a
 * REST-only app, so a honua-compat migration adds them until
 * honua-sdk-js#1715 ships.
 */
export const HONUA_COMPAT_BUNDLER_WORKAROUND_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@bufbuild/protobuf": "^2.15.0",
  "@connectrpc/connect": "^2.2.0",
  "@connectrpc/connect-web": "^2.2.0",
};

const CONFIG_FILE_NAME =
  /^(?:(?:vite|vitest|webpack|rollup|rspack|rsbuild|esbuild|next|nuxt|astro|svelte|babel|jest)\.config\.[cm]?[jt]s|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|angular\.json|\.babelrc(?:\.json)?)$/;
const ARCGIS_RUNTIME_REFERENCE = /@arcgis\/|arcgis-js-api|esri-loader/;

export type JsDependencyChangeAction = "add" | "remove" | "keep";

export interface JsDependencyChange {
  action: JsDependencyChangeAction;
  section: ArcGisDependencySection;
  name: string;
  version: string;
  reason: string;
  /** Present when the change works around a published-package defect; the issue whose fix removes the need. */
  workaround?: string;
}

/** A line in a build or compiler configuration file that names the ArcGIS JS runtime. */
export interface JsConfigReference {
  file: string;
  line: number;
  text: string;
  action: string;
}

export interface JsSourceChange {
  /** Path relative to the application root, POSIX separators. */
  file: string;
  beforeSha256: string;
  afterSha256: string;
}

/** Something the plan could not change safely, with what to do instead. */
export interface JsPlanHold {
  stage: "dependencies";
  message: string;
  action: string;
}

export interface JsMigrationPlan {
  schemaVersion: typeof JS_MIGRATION_PLAN_SCHEMA_VERSION;
  appRoot: string;
  target: CodemodTarget;
  compatImportPath: string;
  /** SHA-256 over the hashed input tree, the planned outputs and the dependency changes. */
  planDigest: string;
  /** `conversion.recommendedMode` of the report; only the two conversion modes change files. */
  mode: JsConversionMode | null;
  rationale: string;
  /** Files under the application root, excluding node_modules, dist and .git. */
  filesHashed: number;
  sourceChanges: JsSourceChange[];
  /** `package.json` at the application root, or `null` when there is none. */
  manifest: { path: string; changed: boolean } | null;
  dependencyChanges: JsDependencyChange[];
  configReferences: JsConfigReference[];
  holds: JsPlanHold[];
  report: JsMigrationReport;
  /** Unified diff of every planned file change, source and `package.json`. */
  patch: string;
}

export interface JsMigrationPlanOptions {
  appRoot: string;
  target?: CodemodTarget;
  compatImportPath?: string;
}

export interface JsMigrationApplyOptions extends JsMigrationPlanOptions {
  /** The `planDigest` of the reviewed plan. */
  approvedDigest: string;
  /** Run `npm install` in the application root after the dependency changes. */
  install?: boolean;
  /** npm script that builds the app, such as `build`. */
  buildScript?: string;
  /** npm script that validates the built app in a browser. */
  browserScript?: string;
  scriptTimeoutMs?: number;
}

export type JsPipelineStageName = "review" | "codemod" | "dependencies" | "install" | "build" | "browser";

/** `not-run` is never a pass: the stage did not happen and the report says why. */
export type JsPipelineStageStatus = "passed" | "failed" | "refused" | "not-run";

export interface JsPipelineStage {
  stage: JsPipelineStageName;
  status: JsPipelineStageStatus;
  detail: string;
  command?: string[];
  exitCode?: number | null;
  durationMs?: number;
  /** Last lines of the command's stdout followed by stderr. */
  outputTail?: string;
}

/**
 * - `refused`: the approved digest does not match; nothing was written.
 * - `failed`: a stage ran and failed.
 * - `browser-validated`: the app built and its browser validation passed.
 * - `unvalidated`: nothing failed, but the build or browser validation did not run.
 */
export type JsPipelineVerdict = "refused" | "failed" | "browser-validated" | "unvalidated";

export type JsResidualWorkSource =
  | "mode"
  | "file-diagnostic"
  | "dependency"
  | "workaround"
  | "config-reference"
  | "hold"
  | "stage";

export interface JsResidualWorkItem {
  source: JsResidualWorkSource;
  file?: string;
  code?: string;
  message: string;
  action: string;
}

export interface JsMigrationPipelineReport {
  schemaVersion: typeof JS_MIGRATION_PIPELINE_REPORT_SCHEMA_VERSION;
  appRoot: string;
  planDigest: string;
  approvedDigest: string;
  mode: JsConversionMode | null;
  verdict: JsPipelineVerdict;
  stages: JsPipelineStage[];
  /** What still ties the app to the ArcGIS JS runtime, from a scan after the pipeline ran. */
  arcgisRuntime: {
    moduleSites: number;
    dependencies: string[];
    widgetSitesOnArcGisRuntime: number;
    required: boolean;
  };
  residualWork: JsResidualWorkItem[];
}

interface PreparedJsMigration {
  plan: JsMigrationPlan;
  snapshot: ReadonlyMap<string, Buffer>;
  outputs: ReadonlyMap<string, Buffer>;
}

export function planJsMigration(options: JsMigrationPlanOptions): JsMigrationPlan {
  return prepareJsMigration(options).plan;
}

export function applyJsMigration(options: JsMigrationApplyOptions): JsMigrationPipelineReport {
  const { plan, snapshot, outputs } = prepareJsMigration(options);
  const stages: JsPipelineStage[] = [];
  const converts = isConversionMode(plan.mode);

  if (options.approvedDigest !== plan.planDigest) {
    stages.push({
      stage: "review",
      status: "refused",
      detail:
        "The approved digest does not match a fresh plan: the application tree, target, compat import path or engine changed since review. Nothing was written.",
    });
    for (const stage of ["codemod", "dependencies", "install", "build", "browser"] as const) {
      stages.push({ stage, status: "not-run", detail: "Not run: the plan was refused." });
    }
    return finishPipelineReport(plan, options.approvedDigest, stages, false);
  }

  stages.push({
    stage: "review",
    status: "passed",
    detail: `The approved digest matches a fresh plan of ${plan.filesHashed} files.`,
  });

  if (outputs.size > 0) {
    writeOutputFilesAtomically(
      [...outputs].map(([file, contents]) => ({ path: path.join(plan.appRoot, ...file.split("/")), contents })),
      true,
    );
  }

  stages.push(codemodStage(plan, snapshot, outputs));
  stages.push(dependencyStage(plan));

  const timeoutMs = options.scriptTimeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS;
  if (options.install) {
    stages.push(runNpm("install", ["install", "--no-audit", "--no-fund"], plan.appRoot, timeoutMs));
  } else {
    stages.push({
      stage: "install",
      status: "not-run",
      detail: "Not run: --install was not given; install the updated dependencies before building.",
    });
  }

  const build = options.buildScript
    ? runAppScript("build", options.buildScript, plan.appRoot, timeoutMs)
    : ({
        stage: "build",
        status: "not-run",
        detail: "Not run: no build script was named (--build-script), so the migrated app was not built.",
      } satisfies JsPipelineStage);
  stages.push(build);

  if (!options.browserScript) {
    stages.push({
      stage: "browser",
      status: "not-run",
      detail:
        "Not run: no browser validation script was named (--browser-script), so the migrated app was not validated in a browser.",
    });
  } else if (build.status === "failed") {
    stages.push({ stage: "browser", status: "not-run", detail: "Not run: the build failed." });
  } else {
    stages.push(runAppScript("browser", options.browserScript, plan.appRoot, timeoutMs));
  }

  return finishPipelineReport(plan, options.approvedDigest, stages, converts);
}

function prepareJsMigration(options: JsMigrationPlanOptions): PreparedJsMigration {
  const appRoot = path.resolve(options.appRoot);
  if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) {
    throw new Error("The application root must be an existing directory.");
  }
  const target = options.target ?? "honua-compat";
  const compatImportPath = options.compatImportPath ?? DEFAULT_COMPAT_IMPORT_PATH;

  const snapshot = readAppTree(appRoot);
  const scanReport = scanArcGisUsage(appRoot);
  const codemodResult = runEsriCompatCodemod({ rootDir: appRoot, write: false, compatImportPath, target });
  const report = buildJsMigrationReport(appRoot, codemodResult, scanReport);
  const mode = report.conversion.recommendedMode;
  const converts = isConversionMode(mode);

  const outputs = new Map<string, Buffer>();
  if (converts) {
    for (const [file, contents] of runCodemodOnCopy(snapshot, compatImportPath, target)) {
      const before = snapshot.get(file);
      if (!before || !before.equals(contents)) {
        outputs.set(file, contents);
      }
    }
  }
  const sourceChanges = [...outputs].map(([file, contents]) => ({
    file,
    beforeSha256: sha256(snapshot.get(file) ?? Buffer.alloc(0)),
    afterSha256: sha256(contents),
  }));

  const holds: JsPlanHold[] = [];
  const dependencyChanges: JsDependencyChange[] = [];
  let manifest: JsMigrationPlan["manifest"] = null;
  const manifestBytes = snapshot.get(MANIFEST);
  if (!manifestBytes) {
    if (converts) {
      holds.push({
        stage: "dependencies",
        message: "There is no package.json at the application root, so no dependency changes were planned.",
        action: `Declare ${Object.keys(requiredDependencies(target)).join(", ")} in the manifest that builds this app.`,
      });
    }
  } else {
    const manifestText = manifestBytes.toString("utf8");
    const parsed = parseManifest(manifestText);
    if (!parsed) {
      holds.push({
        stage: "dependencies",
        message: "package.json at the application root is not a JSON object, so no dependency changes were planned.",
        action: "Fix package.json and plan again.",
      });
      manifest = { path: MANIFEST, changed: false };
    } else {
      dependencyChanges.push(...planDependencyChanges(parsed.value, report, mode, target, holds));
      const rendered = renderManifest(parsed, manifestText, dependencyChanges);
      if (rendered !== manifestText) {
        outputs.set(MANIFEST, Buffer.from(rendered, "utf8"));
      }
      manifest = { path: MANIFEST, changed: rendered !== manifestText };
    }
  }

  const configReferences = converts ? findConfigReferences(snapshot) : [];
  const orderedOutputs = new Map([...outputs].sort(([a], [b]) => compareText(a, b)));
  const patch = [...orderedOutputs]
    .map(([file, contents]) => createUnifiedDiff(file, snapshot.get(file)?.toString("utf8"), contents.toString("utf8")))
    .join("");
  const planDigest = sha256(
    JSON.stringify({
      schemaVersion: JS_MIGRATION_PLAN_SCHEMA_VERSION,
      target,
      compatImportPath,
      inputs: [...snapshot].map(([file, contents]) => [file, sha256(contents)]),
      outputs: [...orderedOutputs].map(([file, contents]) => [file, sha256(contents)]),
      dependencyChanges,
    }),
  );

  return {
    plan: {
      schemaVersion: JS_MIGRATION_PLAN_SCHEMA_VERSION,
      appRoot,
      target,
      compatImportPath,
      planDigest,
      mode,
      rationale: report.conversion.rationale,
      filesHashed: snapshot.size,
      sourceChanges: sourceChanges.sort((a, b) => compareText(a.file, b.file)),
      manifest,
      dependencyChanges,
      configReferences,
      holds,
      report,
      patch,
    },
    snapshot,
    outputs: orderedOutputs,
  };
}

function isConversionMode(mode: JsConversionMode | null): boolean {
  return mode === "assisted-conversion" || mode === "complete-honua-conversion";
}

/** Every file under `root` except node_modules, dist and .git, keyed by POSIX relative path in sorted order. */
function readAppTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        files.set(path.relative(root, fullPath).split(path.sep).join("/"), fs.readFileSync(fullPath));
      }
    }
  };
  walk(root);
  return new Map([...files].sort(([a], [b]) => compareText(a, b)));
}

function runCodemodOnCopy(
  snapshot: ReadonlyMap<string, Buffer>,
  compatImportPath: string,
  target: CodemodTarget,
): Map<string, Buffer> {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "honua-js-migration-plan-"));
  try {
    for (const [file, contents] of snapshot) {
      const fullPath = path.join(stage, ...file.split("/"));
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, contents);
    }
    runEsriCompatCodemod({ rootDir: stage, write: true, compatImportPath, target });
    return readAppTree(stage);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function requiredDependencies(target: CodemodTarget): Record<string, string> {
  return target === "honua-compat"
    ? { ...HONUA_COMPAT_RUNTIME_DEPENDENCIES, ...HONUA_COMPAT_BUNDLER_WORKAROUND_DEPENDENCIES }
    : {};
}

type ManifestObject = Record<string, unknown>;

interface ParsedManifest {
  value: ManifestObject;
  indent: string;
  newline: string;
  trailingNewline: boolean;
}

function parseManifest(text: string): ParsedManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return {
    value: value as ManifestObject,
    indent: /^([ \t]+)"/m.exec(text)?.[1] ?? "  ",
    newline: text.includes("\r\n") ? "\r\n" : "\n",
    trailingNewline: /\r?\n$/.test(text),
  };
}

function objectField(manifest: ManifestObject, key: string): Record<string, unknown> {
  const value = manifest[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function dependencySection(manifest: ManifestObject, section: ArcGisDependencySection): Record<string, string> {
  return objectField(manifest, section) as Record<string, string>;
}

function planDependencyChanges(
  manifest: ManifestObject,
  report: JsMigrationReport,
  mode: JsConversionMode | null,
  target: CodemodTarget,
  holds: JsPlanHold[],
): JsDependencyChange[] {
  if (mode === null) {
    return [];
  }
  const changes: JsDependencyChange[] = [];
  const arcgisDependencies = report.usageInventory.residualArcGisDependencies;
  const rootDependencies = arcgisDependencies.filter((dependency) => dependency.manifest === MANIFEST);

  if (mode === "keep-esri-client") {
    for (const dependency of rootDependencies) {
      changes.push({
        action: "keep",
        section: dependency.section,
        name: dependency.name,
        version: dependency.version,
        reason: "The app keeps the ArcGIS JS client; repoint its services at Honua instead of converting it.",
      });
    }
    return changes;
  }

  if (target === "honua-compat") {
    const declared = (name: string): boolean =>
      DEPENDENCY_SECTIONS.some((section) => dependencySection(manifest, section)[name] !== undefined);
    for (const [name, version] of Object.entries(HONUA_COMPAT_RUNTIME_DEPENDENCIES)) {
      if (!declared(name)) {
        changes.push({
          action: "add",
          section: "dependencies",
          name,
          version,
          reason:
            name === DEFAULT_COMPAT_IMPORT_PATH
              ? "The migrated source imports @honua/sdk-esri-compat."
              : "@honua/sdk-esri-compat requires @honua/sdk as a peer dependency.",
        });
      }
    }
    for (const [name, version] of Object.entries(HONUA_COMPAT_BUNDLER_WORKAROUND_DEPENDENCIES)) {
      if (!declared(name)) {
        changes.push({
          action: "add",
          section: "dependencies",
          name,
          version,
          reason:
            "@honua/sdk-esri-compat imports this optional @honua/sdk peer from its client, and bundlers fail to resolve it when it is absent, even in a REST-only app.",
          workaround: SDK_JS_OPTIONAL_GRPC_PEERS_ISSUE,
        });
      }
    }
  } else {
    holds.push({
      stage: "dependencies",
      message: `Dependency changes are planned for the honua-compat target only; ${target} output needs its runtime packages declared by hand.`,
      action: "Declare the packages the migrated imports name, then build the app.",
    });
  }

  const filesOnArcGis = report.conversion.files
    .filter((file) => file.boundary !== "converted")
    .map((file) => file.file);
  for (const dependency of rootDependencies) {
    if (mode === "complete-honua-conversion") {
      changes.push({
        action: "remove",
        section: dependency.section,
        name: dependency.name,
        version: dependency.version,
        reason: "The migrated source imports nothing from ArcGIS, so the app no longer needs the ArcGIS JS runtime.",
      });
    } else {
      changes.push({
        action: "keep",
        section: dependency.section,
        name: dependency.name,
        version: dependency.version,
        reason: `Assisted conversion: ${filesOnArcGis.join(", ")} still ${filesOnArcGis.length === 1 ? "needs" : "need"} the ArcGIS JS runtime.`,
      });
    }
  }
  for (const dependency of arcgisDependencies) {
    if (dependency.manifest !== MANIFEST) {
      holds.push({
        stage: "dependencies",
        message: `${dependency.name} is declared in ${dependency.manifest}, outside the application root; the plan does not change it.`,
        action: `Remove ${dependency.name} from ${dependency.manifest} once nothing that manifest builds imports ArcGIS.`,
      });
    }
  }
  return changes;
}

function renderManifest(parsed: ParsedManifest, original: string, changes: readonly JsDependencyChange[]): string {
  const manifest: ManifestObject = structuredClone(parsed.value);
  let changed = false;
  for (const change of changes) {
    if (change.action === "keep") {
      continue;
    }
    const section = { ...dependencySection(manifest, change.section) };
    if (change.action === "add") {
      const keys = Object.keys(section);
      const sorted = keys.every((key, index) => index === 0 || compareText(keys[index - 1], key) <= 0);
      section[change.name] = change.version;
      manifest[change.section] = sorted
        ? Object.fromEntries(Object.entries(section).sort(([a], [b]) => compareText(a, b)))
        : section;
    } else {
      delete section[change.name];
      manifest[change.section] = section;
    }
    changed = true;
  }
  if (!changed) {
    return original;
  }
  const json = JSON.stringify(manifest, null, parsed.indent).split("\n").join(parsed.newline);
  return parsed.trailingNewline ? `${json}${parsed.newline}` : json;
}

function findConfigReferences(snapshot: ReadonlyMap<string, Buffer>): JsConfigReference[] {
  const references: JsConfigReference[] = [];
  for (const [file, contents] of snapshot) {
    if (file.includes("/") || !CONFIG_FILE_NAME.test(file)) {
      continue;
    }
    const lines = contents.toString("utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      if (ARCGIS_RUNTIME_REFERENCE.test(text)) {
        references.push({
          file,
          line: index + 1,
          text: text.trim().slice(0, 200),
          action:
            "This configuration names the ArcGIS JS runtime and the plan does not rewrite it; update or remove the entry by hand once no source imports ArcGIS.",
        });
      }
    });
  }
  return references;
}

function codemodStage(
  plan: JsMigrationPlan,
  snapshot: ReadonlyMap<string, Buffer>,
  outputs: ReadonlyMap<string, Buffer>,
): JsPipelineStage {
  if (!isConversionMode(plan.mode)) {
    return {
      stage: "codemod",
      status: "not-run",
      detail: `Not run: ${plan.mode === null ? "the scan discovered no ArcGIS usage" : `${plan.mode} is recommended`}. ${plan.rationale}`,
    };
  }
  const after = readAppTree(plan.appRoot);
  const unexpected = [...snapshot.keys()].filter(
    (file) => !outputs.has(file) && !after.get(file)?.equals(snapshot.get(file) ?? Buffer.alloc(0)),
  );
  if (unexpected.length > 0) {
    return {
      stage: "codemod",
      status: "failed",
      detail: `Files outside the plan changed while it was applied: ${unexpected.join(", ")}.`,
    };
  }
  const boundaries = plan.report.conversion.fileBoundaries;
  return {
    stage: "codemod",
    status: "passed",
    detail: `Wrote ${plan.sourceChanges.length} planned source files (${boundaries.converted} converted, ${boundaries.mixed} mixed); ${boundaries.kept} kept and ${boundaries.held} held files, and every other file outside the plan, are byte-identical.`,
  };
}

function dependencyStage(plan: JsMigrationPlan): JsPipelineStage {
  const dependencyHolds = plan.holds.filter((hold) => hold.stage === "dependencies");
  if (!isConversionMode(plan.mode)) {
    return { stage: "dependencies", status: "not-run", detail: "Not run: the plan converts no source." };
  }
  if (!plan.manifest || (dependencyHolds.length > 0 && !plan.manifest.changed)) {
    return {
      stage: "dependencies",
      status: "not-run",
      detail: `Not run: ${dependencyHolds.map((hold) => hold.message).join(" ")}`,
    };
  }
  const describe = (action: JsDependencyChangeAction): string => {
    const names = plan.dependencyChanges.filter((change) => change.action === action).map((change) => change.name);
    return names.length === 0 ? "none" : names.join(", ");
  };
  return {
    stage: "dependencies",
    status: "passed",
    detail: plan.manifest.changed
      ? `Updated package.json. Added: ${describe("add")}. Removed: ${describe("remove")}. Kept: ${describe("keep")}.`
      : "package.json already declares what the migrated source needs.",
  };
}

function runAppScript(stage: "build" | "browser", script: string, appRoot: string, timeoutMs: number): JsPipelineStage {
  if (!NPM_SCRIPT_NAME.test(script)) {
    return { stage, status: "failed", detail: `"${script}" is not a valid npm script name.` };
  }
  const parsed = fs.existsSync(path.join(appRoot, MANIFEST))
    ? parseManifest(fs.readFileSync(path.join(appRoot, MANIFEST), "utf8"))
    : undefined;
  const scripts = parsed ? objectField(parsed.value, "scripts") : {};
  if (typeof scripts[script] !== "string") {
    return { stage, status: "failed", detail: `package.json at the application root declares no "${script}" script.` };
  }
  return runNpm(stage, ["run", script], appRoot, timeoutMs);
}

function runNpm(stage: JsPipelineStageName, args: string[], cwd: string, timeoutMs: number): JsPipelineStage {
  const command = ["npm", ...args];
  const started = Date.now();
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "npm.cmd" : "npm", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: windows,
  });
  const durationMs = Date.now() - started;
  const outputTail = tailOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const commandText = command.join(" ");
  if (result.error) {
    return {
      stage,
      status: "failed",
      detail: `${commandText} did not complete: ${result.error.message}`,
      command,
      exitCode: result.status,
      durationMs,
      outputTail,
    };
  }
  const passed = result.status === 0;
  return {
    stage,
    status: passed ? "passed" : "failed",
    detail: passed
      ? `${commandText} exited 0.`
      : `${commandText} exited ${result.status === null ? `on signal ${result.signal}` : result.status}.`,
    command,
    exitCode: result.status,
    durationMs,
    outputTail,
  };
}

function tailOutput(output: string): string {
  const lines = output.trimEnd().split(/\r?\n/);
  const tail = lines.slice(-OUTPUT_TAIL_LINES).join("\n");
  return tail.length > OUTPUT_TAIL_CHARS ? tail.slice(-OUTPUT_TAIL_CHARS) : tail;
}

function finishPipelineReport(
  plan: JsMigrationPlan,
  approvedDigest: string,
  stages: JsPipelineStage[],
  applied: boolean,
): JsMigrationPipelineReport {
  const after = scanArcGisUsage(plan.appRoot);
  const dependencies = [...new Set((after.arcgisDependencies ?? []).map((dependency) => dependency.name))].sort(
    compareText,
  );
  const inventory = plan.report.usageInventory;
  const arcgisRuntime = {
    moduleSites: after.imports.length,
    dependencies,
    widgetSitesOnArcGisRuntime: applied ? inventory.arcgisRuntimeWidgetSites : inventory.widgetSites,
    required: after.imports.length > 0 || dependencies.length > 0,
  };

  let verdict: JsPipelineVerdict = "unvalidated";
  if (stages.some((stage) => stage.status === "refused")) {
    verdict = "refused";
  } else if (stages.some((stage) => stage.status === "failed")) {
    verdict = "failed";
  } else if (
    stages.find((stage) => stage.stage === "build")?.status === "passed" &&
    stages.find((stage) => stage.stage === "browser")?.status === "passed"
  ) {
    verdict = "browser-validated";
  }

  return {
    schemaVersion: JS_MIGRATION_PIPELINE_REPORT_SCHEMA_VERSION,
    appRoot: plan.appRoot,
    planDigest: plan.planDigest,
    approvedDigest,
    mode: plan.mode,
    verdict,
    stages,
    arcgisRuntime,
    residualWork: buildResidualWork(plan, stages, verdict),
  };
}

function buildResidualWork(
  plan: JsMigrationPlan,
  stages: readonly JsPipelineStage[],
  verdict: JsPipelineVerdict,
): JsResidualWorkItem[] {
  const items: JsResidualWorkItem[] = [];
  if (verdict === "refused") {
    return [
      {
        source: "stage",
        message: stages[0].detail,
        action: "Plan again, review the new patch and apply its digest.",
      },
    ];
  }

  const conversion = plan.report.conversion;
  if (plan.mode === "keep-esri-client") {
    items.push({
      source: "mode",
      message: plan.rationale,
      action: conversion.modes.find((mode) => mode.mode === "keep-esri-client")?.detail ?? "",
    });
  }
  if (isConversionMode(plan.mode)) {
    for (const file of conversion.files) {
      for (const diagnostic of file.diagnostics) {
        const location = diagnostic.line === undefined ? "" : `line ${diagnostic.line}:${diagnostic.column}: `;
        items.push({
          source: "file-diagnostic",
          file: file.file,
          code: diagnostic.code,
          message: `${location}${diagnostic.message}`,
          action: diagnostic.action,
        });
      }
    }
  }
  for (const change of plan.dependencyChanges) {
    if (change.action === "keep") {
      items.push({
        source: "dependency",
        file: MANIFEST,
        message: `${change.name}@${change.version} stays in ${change.section}. ${change.reason}`,
        action: `Remove ${change.name} once no source imports ArcGIS.`,
      });
    } else if (change.workaround) {
      items.push({
        source: "workaround",
        file: MANIFEST,
        message: `${change.name}@${change.version} was added as a temporary workaround. ${change.reason}`,
        action: `Remove ${change.name} once ${change.workaround} ships, unless the app selects the gRPC transport.`,
      });
    }
  }
  for (const reference of plan.configReferences) {
    items.push({
      source: "config-reference",
      file: reference.file,
      message: `line ${reference.line}: ${reference.text}`,
      action: reference.action,
    });
  }
  for (const hold of plan.holds) {
    items.push({ source: "hold", message: hold.message, action: hold.action });
  }
  if (isConversionMode(plan.mode)) {
    for (const stage of stages) {
      if (stage.status === "passed" || stage.stage === "review") {
        continue;
      }
      items.push({ source: "stage", message: `${stage.stage}: ${stage.detail}`, action: stageAction(stage) });
    }
  }
  return items;
}

function stageAction(stage: JsPipelineStage): string {
  if (stage.status === "failed") {
    return "Fix the failure shown in the stage output and rerun the step.";
  }
  switch (stage.stage) {
    case "install":
      return "Run npm install in the application root.";
    case "build":
      return "Build the migrated app, or apply with --build-script <name>.";
    case "browser":
      return "Validate the migrated app in a browser, or apply with --browser-script <name>.";
    default:
      return "Resolve the holds above and plan again.";
  }
}

function sha256(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type DiffOp = "equal" | "delete" | "insert";

interface DiffLine {
  op: DiffOp;
  text: string;
  /** False for a last line that has no terminating newline. */
  newline: boolean;
}

interface SplitLine {
  text: string;
  newline: boolean;
}

function splitLines(text: string | undefined): SplitLine[] {
  if (text === undefined || text === "") {
    return [];
  }
  const parts = text.split("\n");
  const trailingNewline = parts[parts.length - 1] === "";
  if (trailingNewline) {
    parts.pop();
  }
  return parts.map((part, index) => ({ text: part, newline: trailingNewline || index < parts.length - 1 }));
}

/** Myers O(ND) line diff. */
function diffLines(a: readonly SplitLine[], b: readonly SplitLine[]): DiffLine[] {
  const same = (x: number, y: number): boolean => a[x].text === b[y].text && a[x].newline === b[y].newline;
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && same(x, y)) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  const edits: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const previous = trace[d];
    const k = x - y;
    const previousK = k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1]) ? k + 1 : k - 1;
    const previousX = previous[offset + previousK];
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      edits.push({ op: "equal", ...a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === previousX) {
        edits.push({ op: "insert", ...b[y - 1] });
      } else {
        edits.push({ op: "delete", ...a[x - 1] });
      }
    }
    x = previousX;
    y = previousY;
  }
  return edits.reverse();
}

const DIFF_CONTEXT = 3;

/** A `git apply`-compatible unified diff of one file; `before` is undefined for a new file. Empty when unchanged. */
export function createUnifiedDiff(file: string, before: string | undefined, after: string): string {
  const edits = diffLines(splitLines(before), splitLines(after));
  const changed = edits.map((edit, index) => (edit.op === "equal" ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) {
    return "";
  }

  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - DIFF_CONTEXT);
    const end = Math.min(edits.length, index + DIFF_CONTEXT + 1);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  const header = [before === undefined ? "--- /dev/null" : `--- a/${file}`, `+++ b/${file}`];
  const lines = [
    `diff --git a/${file} b/${file}`,
    ...(before === undefined ? ["new file mode 100644"] : []),
    ...header,
  ];
  let oldLine = 0;
  let newLine = 0;
  let cursor = 0;
  for (const [start, end] of ranges) {
    for (; cursor < start; cursor += 1) {
      if (edits[cursor].op !== "insert") oldLine += 1;
      if (edits[cursor].op !== "delete") newLine += 1;
    }
    const hunk = edits.slice(start, end);
    const oldCount = hunk.filter((edit) => edit.op !== "insert").length;
    const newCount = hunk.filter((edit) => edit.op !== "delete").length;
    lines.push(
      `@@ -${oldCount === 0 ? oldLine : oldLine + 1},${oldCount} +${newCount === 0 ? newLine : newLine + 1},${newCount} @@`,
    );
    for (const edit of hunk) {
      lines.push(`${edit.op === "equal" ? " " : edit.op === "delete" ? "-" : "+"}${edit.text}`);
      if (!edit.newline) {
        lines.push("\\ No newline at end of file");
      }
    }
    for (; cursor < end; cursor += 1) {
      if (edits[cursor].op !== "insert") oldLine += 1;
      if (edits[cursor].op !== "delete") newLine += 1;
    }
  }
  return `${lines.join("\n")}\n`;
}
