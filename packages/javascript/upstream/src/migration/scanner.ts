import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const PACKAGE_MANIFEST = "package.json";

/** `importClause` marker for modules loaded through an AMD `require([...])`/`define([...])` array. */
export const AMD_REQUIRE_IMPORT_CLAUSE = "amd-require(...)";
/** `importClause` marker for modules loaded through the ArcGIS CDN `$arcgis.import(...)` helper. */
export const ARCGIS_IMPORT_CLAUSE = "$arcgis.import(...)";

const AMD_ESRI_MODULE_PREFIX = "esri/";
const ARCGIS_CORE_MODULE_PREFIX = "@arcgis/core/";
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

export interface ArcGisImportHit {
  file: string;
  modulePath: string;
  importClause: string;
  symbols: string[];
}

export type ArcGisDependencySection = (typeof DEPENDENCY_SECTIONS)[number];

export interface ArcGisDependencyManifest {
  /** Manifest path relative to the scan root, POSIX separators (may point at an ancestor, e.g. `../package.json`). */
  path: string;
  /** False when the manifest could not be parsed; its dependencies are then unknown, not absent. */
  parsed: boolean;
}

export interface ArcGisDependencyHit {
  manifest: string;
  section: ArcGisDependencySection;
  name: string;
  version: string;
}

export interface ArcGisScanReport {
  rootDir: string;
  filesScanned: number;
  filesWithArcGisImports: number;
  imports: ArcGisImportHit[];
  filesWithEsriLeafletImports?: number;
  esriLeafletImportCount?: number;
  esriLeafletImports?: ArcGisImportHit[];
  /** package.json manifests read for dependency accounting. Absent on reports built outside `scanArcGisUsage`. */
  dependencyManifests?: ArcGisDependencyManifest[];
  /** ArcGIS JS runtime packages still declared by those manifests. */
  arcgisDependencies?: ArcGisDependencyHit[];
  symbolUsageCounts: Record<string, number>;
  flags: string[];
}

/**
 * Every ArcGIS module site in one source text, whatever its loading style:
 * ESM import/re-export/side-effect, `import(...)`, `require(...)`, AMD arrays
 * and `$arcgis.import(...)`. `scanArcGisUsage` counts these per file; the
 * codemod runs it over its own output to report what it left behind.
 */
export function findArcGisModuleSites(source: string, file: string): ArcGisImportHit[] {
  return [...findArcGisImports(source, file), ...findModuleLoaderHits(source, file)];
}

export function scanArcGisUsage(rootDir: string): ArcGisScanReport {
  const { sources: files, manifests } = collectScanFiles(rootDir);
  const imports: ArcGisImportHit[] = [];
  const esriLeafletImports: ArcGisImportHit[] = [];
  const flags = new Set<string>();
  const symbolUsageCounts: Record<string, number> = {};

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const loaderHits = findModuleLoaderHits(source, file);
    if (source.includes("@arcgis/core/") || loaderHits.length > 0) {
      addFileLevelFlags(source, flags);
    }
    if (loaderHits.some((item) => item.importClause === AMD_REQUIRE_IMPORT_CLAUSE)) {
      flags.add("amd-modules-detected");
    }
    if (loaderHits.some((item) => item.importClause === ARCGIS_IMPORT_CLAUSE)) {
      flags.add("arcgis-import-detected");
    }

    const fileImports = [...findArcGisImports(source, file), ...loaderHits];
    if (fileImports.some((item) => item.importClause.startsWith("export "))) {
      flags.add("arcgis-reexports-detected");
    }
    if (fileImports.some((item) => isArcGisBarrelModulePath(item.modulePath))) {
      flags.add("arcgis-barrel-imports-detected");
    }
    const fileEsriLeafletImports = findEsriLeafletImports(source, file);
    if (fileEsriLeafletImports.length > 0) {
      flags.add("esri-leaflet-imports-detected");
      esriLeafletImports.push(...fileEsriLeafletImports);
    }
    if (fileImports.length === 0) {
      continue;
    }

    imports.push(...fileImports);

    for (const importHit of fileImports) {
      for (const symbol of importHit.symbols) {
        const usage = countIdentifierUsage(source, symbol);
        symbolUsageCounts[symbol] = (symbolUsageCounts[symbol] ?? 0) + usage;
      }
    }
  }

  const dependencyScan = scanArcGisDependencies(rootDir, manifests);

  return {
    rootDir: path.resolve(rootDir),
    filesScanned: files.length,
    filesWithArcGisImports: new Set(imports.map((item) => item.file)).size,
    imports,
    filesWithEsriLeafletImports: new Set(esriLeafletImports.map((item) => item.file)).size,
    esriLeafletImportCount: esriLeafletImports.length,
    esriLeafletImports,
    dependencyManifests: dependencyScan.manifests,
    arcgisDependencies: dependencyScan.dependencies,
    symbolUsageCounts,
    flags: Array.from(flags).sort(),
  };
}

export function summarizeArcGisScan(report: ArcGisScanReport): string {
  const topSymbols = Object.entries(report.symbolUsageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => `${symbol}:${count}`)
    .join(", ");

  const flagText = report.flags.length > 0 ? report.flags.join(", ") : "none";
  return [
    `filesScanned=${report.filesScanned}`,
    `filesWithArcGisImports=${report.filesWithArcGisImports}`,
    `importCount=${report.imports.length}`,
    `esriLeafletImportCount=${report.esriLeafletImportCount ?? 0}`,
    `topSymbols=[${topSymbols}]`,
    `flags=[${flagText}]`,
  ].join(" ");
}

function collectScanFiles(rootDir: string): { sources: string[]; manifests: string[] } {
  const absoluteRoot = path.resolve(rootDir);
  const queue = [absoluteRoot];
  const sources: string[] = [];
  const manifests: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }
      if (entry.name === PACKAGE_MANIFEST) {
        manifests.push(fullPath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        sources.push(fullPath);
      }
    }
  }

  return { sources, manifests };
}

/**
 * Reads every package.json inside the scan root, plus the nearest ancestor
 * manifest when the root has none of its own (scans commonly target `./src`),
 * and records the ArcGIS JS runtime packages they still declare.
 */
function scanArcGisDependencies(
  rootDir: string,
  manifestsInTree: readonly string[],
): { manifests: ArcGisDependencyManifest[]; dependencies: ArcGisDependencyHit[] } {
  const absoluteRoot = path.resolve(rootDir);
  const manifestPaths = [...manifestsInTree];
  if (!manifestPaths.includes(path.join(absoluteRoot, PACKAGE_MANIFEST))) {
    const ancestorManifest = findAncestorManifest(absoluteRoot);
    if (ancestorManifest) {
      manifestPaths.push(ancestorManifest);
    }
  }

  const manifests: ArcGisDependencyManifest[] = [];
  const dependencies: ArcGisDependencyHit[] = [];
  for (const manifestPath of manifestPaths) {
    const relativePath = path.relative(absoluteRoot, manifestPath).split(path.sep).join("/");
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = undefined;
    }
    if (!isRecord(manifest)) {
      manifests.push({ path: relativePath, parsed: false });
      continue;
    }

    manifests.push({ path: relativePath, parsed: true });
    for (const section of DEPENDENCY_SECTIONS) {
      const entries = manifest[section];
      if (!isRecord(entries)) {
        continue;
      }
      for (const [name, version] of Object.entries(entries)) {
        if (isArcGisRuntimePackage(name)) {
          dependencies.push({ manifest: relativePath, section, name, version: String(version) });
        }
      }
    }
  }

  manifests.sort((a, b) => a.path.localeCompare(b.path));
  dependencies.sort(
    (a, b) =>
      a.manifest.localeCompare(b.manifest) ||
      DEPENDENCY_SECTIONS.indexOf(a.section) - DEPENDENCY_SECTIONS.indexOf(b.section) ||
      a.name.localeCompare(b.name),
  );
  return { manifests, dependencies };
}

function findAncestorManifest(absoluteRoot: string): string | undefined {
  let current = path.dirname(absoluteRoot);
  while (true) {
    const candidate = path.join(current, PACKAGE_MANIFEST);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function isArcGisRuntimePackage(name: string): boolean {
  return name.startsWith("@arcgis/") || name === "arcgis-js-api" || name === "esri-loader";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scriptKindForFile(file: string): ts.ScriptKind {
  const extension = path.extname(file);
  if (extension === ".ts") return ts.ScriptKind.TS;
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/**
 * AMD `require([...])`/`define([...])` arrays and `$arcgis.import(...)` calls
 * load ArcGIS modules without an ESM import or CommonJS require, so the regex
 * scan in `findArcGisImports` never sees them. The codemod leaves them as
 * written, but they are still ArcGIS usage and must count in the report
 * denominator.
 */
function findModuleLoaderHits(source: string, file: string): ArcGisImportHit[] {
  if (!source.includes(AMD_ESRI_MODULE_PREFIX) && !source.includes("$arcgis")) {
    return [];
  }

  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
  const hits: ArcGisImportHit[] = [];

  const recordArray = (array: ts.ArrayLiteralExpression, importClause: string, prefixes: readonly string[]): void => {
    for (const element of array.elements) {
      if (ts.isStringLiteralLike(element)) {
        record(element, importClause, prefixes);
      }
    }
  };
  const record = (literal: ts.StringLiteralLike, importClause: string, prefixes: readonly string[]): void => {
    if (prefixes.some((prefix) => literal.text.startsWith(prefix))) {
      hits.push({ file, modulePath: literal.text, importClause, symbols: [] });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [firstArg, secondArg] = node.arguments;
      const callee = node.expression;
      if (ts.isIdentifier(callee) && (callee.text === "require" || callee.text === "define")) {
        // Named modules pass their id first: define("app/main", ["esri/Map"], factory).
        const dependencyArray =
          callee.text === "define" && ts.isStringLiteralLike(firstArg) && secondArg !== undefined
            ? secondArg
            : firstArg;
        if (ts.isArrayLiteralExpression(dependencyArray)) {
          recordArray(dependencyArray, AMD_REQUIRE_IMPORT_CLAUSE, [AMD_ESRI_MODULE_PREFIX]);
        }
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "$arcgis" &&
        callee.name.text === "import"
      ) {
        const prefixes = [AMD_ESRI_MODULE_PREFIX, ARCGIS_CORE_MODULE_PREFIX];
        if (ts.isStringLiteralLike(firstArg)) {
          record(firstArg, ARCGIS_IMPORT_CLAUSE, prefixes);
        } else if (ts.isArrayLiteralExpression(firstArg)) {
          recordArray(firstArg, ARCGIS_IMPORT_CLAUSE, prefixes);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return hits;
}

function findArcGisImports(source: string, file: string): ArcGisImportHit[] {
  const hits: ArcGisImportHit[] = [];
  const importRegex = /import\s+([^;]+?)\s+from\s+["'](@arcgis\/core\/[^"']+)["'];?/g;
  let importMatch: RegExpExecArray | null = importRegex.exec(source);
  while (importMatch !== null) {
    const importClause = importMatch[1].trim();
    const modulePath = importMatch[2];
    hits.push({
      file,
      modulePath,
      importClause,
      symbols: extractImportedSymbols(importClause),
    });
    importMatch = importRegex.exec(source);
  }

  const sideEffectImportRegex = /import\s+["'](@arcgis\/core\/[^"']+)["'];?/g;
  let sideEffectImportMatch: RegExpExecArray | null = sideEffectImportRegex.exec(source);
  while (sideEffectImportMatch !== null) {
    hits.push({
      file,
      modulePath: sideEffectImportMatch[1],
      importClause: "side-effect-import",
      symbols: [],
    });
    sideEffectImportMatch = sideEffectImportRegex.exec(source);
  }

  const exportRegex = /export\s+([^;]+?)\s+from\s+["'](@arcgis\/core\/[^"']+)["'];?/g;
  let exportMatch: RegExpExecArray | null = exportRegex.exec(source);
  while (exportMatch !== null) {
    const exportClause = exportMatch[1].trim();
    hits.push({
      file,
      modulePath: exportMatch[2],
      importClause: `export ${exportClause}`,
      symbols: extractImportedSymbols(exportClause),
    });
    exportMatch = exportRegex.exec(source);
  }

  const requireRegex =
    /(?:\b(?:const|let|var)\s+(?:([A-Za-z_$][A-Za-z0-9_$]*)|\{\s*default\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)[^}]*\})\s*=\s*)?require\(["'](@arcgis\/core\/[^"']+)["']\)(?:\.default)?/g;
  let requireMatch: RegExpExecArray | null = requireRegex.exec(source);
  while (requireMatch !== null) {
    const localSymbol = requireMatch[1] ?? requireMatch[2];
    hits.push({
      file,
      modulePath: requireMatch[3],
      importClause: "require(...)",
      symbols: localSymbol ? [localSymbol] : [],
    });
    requireMatch = requireRegex.exec(source);
  }

  // The lookbehind keeps `$arcgis.import("@arcgis/core/...")` out of this bucket;
  // `findModuleLoaderHits` records those calls, which the codemod does not rewrite.
  const dynamicImportRegex = /(?<![\w$.])import\(\s*["'](@arcgis\/core\/[^"']+)["']\s*\)/g;
  let dynamicImportMatch: RegExpExecArray | null = dynamicImportRegex.exec(source);
  while (dynamicImportMatch !== null) {
    hits.push({
      file,
      modulePath: dynamicImportMatch[1],
      importClause: "import(...)",
      symbols: [],
    });
    dynamicImportMatch = dynamicImportRegex.exec(source);
  }

  return hits;
}

function findEsriLeafletImports(source: string, file: string): ArcGisImportHit[] {
  const hits: ArcGisImportHit[] = [];

  const importRegex = /import\s+([^;]+?)\s+from\s+["'](esri-leaflet)["'];?/g;
  let importMatch: RegExpExecArray | null = importRegex.exec(source);
  while (importMatch !== null) {
    const importClause = importMatch[1].trim();
    hits.push({
      file,
      modulePath: importMatch[2],
      importClause,
      symbols: extractImportedSymbols(importClause),
    });
    importMatch = importRegex.exec(source);
  }

  const sideEffectImportRegex = /import\s+["'](esri-leaflet)["'];?/g;
  let sideEffectImportMatch: RegExpExecArray | null = sideEffectImportRegex.exec(source);
  while (sideEffectImportMatch !== null) {
    hits.push({
      file,
      modulePath: sideEffectImportMatch[1],
      importClause: "side-effect-import",
      symbols: [],
    });
    sideEffectImportMatch = sideEffectImportRegex.exec(source);
  }

  const requireRegex =
    /(?:\b(?:const|let|var)\s+(?:([A-Za-z_$][A-Za-z0-9_$]*)|\{\s*default\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)[^}]*\})\s*=\s*)?require\(["'](esri-leaflet)["']\)(?:\.default)?/g;
  let requireMatch: RegExpExecArray | null = requireRegex.exec(source);
  while (requireMatch !== null) {
    const localSymbol = requireMatch[1] ?? requireMatch[2];
    hits.push({
      file,
      modulePath: requireMatch[3],
      importClause: "require(...)",
      symbols: localSymbol ? [localSymbol] : [],
    });
    requireMatch = requireRegex.exec(source);
  }

  const dynamicImportRegex = /import\(\s*["'](esri-leaflet)["']\s*\)/g;
  let dynamicImportMatch: RegExpExecArray | null = dynamicImportRegex.exec(source);
  while (dynamicImportMatch !== null) {
    hits.push({
      file,
      modulePath: dynamicImportMatch[1],
      importClause: "import(...)",
      symbols: [],
    });
    dynamicImportMatch = dynamicImportRegex.exec(source);
  }

  return hits;
}

function extractImportedSymbols(importClause: string): string[] {
  const symbols: string[] = [];

  // `import type X` / `import { type X }`: the modifier is not a binding name.
  const clause = importClause.replace(/^type\s+/, "");
  const defaultImportMatch = clause.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (defaultImportMatch) {
    symbols.push(defaultImportMatch[1]);
  }

  // indexOf, not /\{([^}]+)\}/: the unanchored regex is polynomial on clauses
  // like "{{{{" (CodeQL js/polynomial-redos), and import clauses are scanned input.
  const openIndex = clause.indexOf("{");
  const closeIndex = openIndex < 0 ? -1 : clause.indexOf("}", openIndex + 1);
  const namedImports = closeIndex > openIndex + 1 ? clause.slice(openIndex + 1, closeIndex) : undefined;
  if (namedImports !== undefined) {
    for (const part of namedImports.split(",")) {
      const token = part.trim().replace(/^type\s+/, "");
      if (!token) {
        continue;
      }
      const aliasMatch = token.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (aliasMatch) {
        symbols.push(aliasMatch[1]);
      } else {
        const symbolMatch = token.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
        if (symbolMatch) {
          symbols.push(symbolMatch[1]);
        }
      }
    }
  }

  return Array.from(new Set(symbols));
}

function countIdentifierUsage(source: string, symbol: string): number {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "g");
  const matches = source.match(regex);
  if (!matches) {
    return 0;
  }

  // Subtract one usage that usually appears in the import declaration itself.
  return Math.max(0, matches.length - 1);
}

function addFileLevelFlags(source: string, flags: Set<string>): void {
  if (/SceneView\b/.test(source) || /WebScene\b/.test(source)) {
    flags.add("scene-3d-detected");
  }
  if (/WebMap\b/.test(source)) {
    flags.add("webmap-detected");
  }
  if (/(?<![\w$.])import\(\s*["']@arcgis\/core\//.test(source)) {
    flags.add("dynamic-import-detected");
  }
  if (/ClosestFacility|ServiceArea|Geoprocessor/.test(source)) {
    flags.add("advanced-widget-or-networking-detected");
  }
  if (
    /IdentityManager|OAuthInfo|esriConfig|request\s*\.\s*interceptors|\/request["']|generateToken|Credential/i.test(
      source,
    )
  ) {
    flags.add("auth-or-request-customization-detected");
  }
  if (/\bmodule\.exports\b/.test(source) || /\bexports\.[A-Za-z_$][A-Za-z0-9_$]*\b/.test(source)) {
    flags.add("commonjs-detected");
  }
}

function isArcGisBarrelModulePath(modulePath: string): boolean {
  const normalized = modulePath.endsWith(".js") ? modulePath.slice(0, -3) : modulePath;
  if (!normalized.startsWith("@arcgis/core/")) {
    return false;
  }

  return (
    normalized === "@arcgis/core/layers" ||
    normalized === "@arcgis/core/layers/support" ||
    normalized === "@arcgis/core/widgets" ||
    normalized === "@arcgis/core/geometry" ||
    normalized === "@arcgis/core/symbols" ||
    normalized === "@arcgis/core/renderers" ||
    normalized === "@arcgis/core/views" ||
    normalized === "@arcgis/core/rest/support" ||
    normalized === "@arcgis/core/identity" ||
    normalized === "@arcgis/core/core"
  );
}
