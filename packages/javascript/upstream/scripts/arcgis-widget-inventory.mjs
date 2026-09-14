// Re-derives the deprecated ArcGIS widget inventory from a published
// @arcgis/core tarball, so ARCGIS_WIDGET_INVENTORY_PIN in
// upstream/src/migration/widget-dispositions.ts is checked against the package
// rather than copied from a documentation page. Only module names are read;
// nothing from the tarball is written or redistributed. Usage:
//
//   npm pack @arcgis/core@5.0.19
//   node upstream/scripts/arcgis-widget-inventory.mjs arcgis-core-5.0.19.tgz          # print
//   node upstream/scripts/arcgis-widget-inventory.mjs arcgis-core-5.0.19.tgz --check  # compare to the built pin
//
// npm script: inventory:arcgis-widgets.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_MODULE = "dist/migration/widget-dispositions.js";
const WIDGETS_PREFIX = "package/widgets/";

function headerField(header, start, length) {
  const raw = header.subarray(start, start + length).toString("utf8");
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

/** Regular-file entries of an uncompressed ustar/pax archive, keyed by path. */
export function readTarEntries(tar) {
  const entries = new Map();
  let offset = 0;
  let pendingName;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    let name = headerField(header, 0, 100);
    const prefix = headerField(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = Number.parseInt(headerField(header, 124, 12).trim() || "0", 8);
    const type = headerField(header, 156, 1);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (type === "L") {
      pendingName = headerField(body, 0, body.length);
    } else if (type === "x") {
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (match) pendingName = match[1];
    } else {
      if (pendingName !== undefined) {
        name = pendingName;
        pendingName = undefined;
      }
      if (type === "0" || type === "") entries.set(name, body);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const CLASS_DEPRECATION = /@deprecated\s*(?:\*\s*)?since\s+(?:version\s+)?(\d+\.\d+)/;

/**
 * Release named by the `@deprecated since` tag in the JSDoc block directly
 * above `export default class <className>`. A deprecated property or a doc
 * block that belongs to something else does not count.
 */
export function classDeprecationRelease(typing, className) {
  const classStart = typing.search(new RegExp(`export default class ${className}\\b`));
  if (classStart === -1) return undefined;
  const beforeClass = typing.slice(0, classStart);
  const docStart = beforeClass.lastIndexOf("/**");
  if (docStart === -1) return undefined;
  const doc = beforeClass.slice(docStart);
  if (!/\*\/\s*$/.test(doc)) return undefined;
  return CLASS_DEPRECATION.exec(doc)?.[1];
}

/**
 * Applies the pin's method: top-level package/widgets/<Name>.js modules whose
 * package/widgets/<Name>.d.ts class JSDoc carries `@deprecated since <version>`.
 * Everything else at the top level is reported as excluded, with the reason.
 */
export function deriveWidgetInventory(entries) {
  const manifest = entries.get("package/package.json");
  if (!manifest) throw new Error("tarball has no package/package.json");
  const { name, version } = JSON.parse(manifest.toString("utf8"));

  const modules = new Set();
  const typings = new Map();
  for (const [entryPath, body] of entries) {
    if (!entryPath.startsWith(WIDGETS_PREFIX)) continue;
    const rest = entryPath.slice(WIDGETS_PREFIX.length);
    if (rest.includes("/")) continue;
    if (rest.endsWith(".d.ts")) typings.set(rest.slice(0, -".d.ts".length), body.toString("utf8"));
    else if (rest.endsWith(".js")) modules.add(rest.slice(0, -".js".length));
  }

  const widgets = [];
  const deprecatedSince = {};
  const excludedModules = [];
  for (const module of [...modules].sort()) {
    const typing = typings.get(module);
    const since = typing === undefined ? undefined : classDeprecationRelease(typing, module);
    if (typing === undefined) {
      excludedModules.push({ module, reason: "untyped" });
    } else if (since === undefined) {
      excludedModules.push({ module, reason: "not-deprecated" });
    } else {
      widgets.push(module);
      deprecatedSince[module] = since;
    }
  }
  return { package: name, version, deprecatedSince, widgets, excludedModules };
}

export function tarballIntegrity(tgz) {
  return `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
}

export function inventoryFromTarball(tgz) {
  return { ...deriveWidgetInventory(readTarEntries(gunzipSync(tgz))), integrity: tarballIntegrity(tgz) };
}

/** Differences between a derived inventory and the committed pin; empty when they match. */
export function compareInventoryToPin(derived, pin) {
  const problems = [];
  for (const field of ["package", "version", "integrity"]) {
    if (derived[field] !== pin[field]) problems.push(`${field}: tarball ${derived[field]} != pin ${pin[field]}`);
  }
  const pinned = new Set(pin.widgets);
  const found = new Set(derived.widgets);
  for (const widget of derived.widgets) if (!pinned.has(widget)) problems.push(`widget missing from pin: ${widget}`);
  for (const widget of pin.widgets) if (!found.has(widget)) problems.push(`widget not in tarball: ${widget}`);
  for (const widget of derived.widgets) {
    const pinnedSince = pin.deprecatedSince[widget];
    if (pinned.has(widget) && derived.deprecatedSince[widget] !== pinnedSince) {
      problems.push(`deprecatedSince ${widget}: tarball ${derived.deprecatedSince[widget]} != pin ${pinnedSince}`);
    }
  }
  if (JSON.stringify(derived.excludedModules) !== JSON.stringify(pin.excludedModules)) {
    problems.push(
      `excludedModules: tarball ${JSON.stringify(derived.excludedModules)} != pin ${JSON.stringify(pin.excludedModules)}`,
    );
  }
  return problems;
}

async function main() {
  const [tarballPath, flag] = process.argv.slice(2);
  if (!tarballPath || (flag !== undefined && flag !== "--check")) {
    throw new Error("usage: arcgis-widget-inventory.mjs <arcgis-core.tgz> [--check]");
  }
  const derived = inventoryFromTarball(fs.readFileSync(tarballPath));
  process.stdout.write(`${JSON.stringify(derived, null, 2)}\n`);
  if (flag !== "--check") return;

  const dataModulePath = path.join(ROOT, DATA_MODULE);
  if (!fs.existsSync(dataModulePath)) throw new Error(`${DATA_MODULE} is missing; run npm run build first`);
  const { ARCGIS_WIDGET_INVENTORY_PIN } = await import(pathToFileURL(dataModulePath).href);
  const problems = compareInventoryToPin(derived, ARCGIS_WIDGET_INVENTORY_PIN);
  if (problems.length > 0) throw new Error(`inventory does not match ARCGIS_WIDGET_INVENTORY_PIN:\n${problems.join("\n")}`);
  process.stdout.write(
    `Verified ${derived.widgets.length} deprecated widgets in ${derived.package}@${derived.version} match the pin\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
