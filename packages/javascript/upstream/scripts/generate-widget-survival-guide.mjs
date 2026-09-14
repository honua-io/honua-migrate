// Generates docs/widget-survival-guide.md from the shared widget-disposition
// data in upstream/src/migration/widget-dispositions.ts (built to dist/). The
// guide is generated — do not edit it by hand. Usage:
//
//   node upstream/scripts/generate-widget-survival-guide.mjs write   # regenerate
//   node upstream/scripts/generate-widget-survival-guide.mjs check   # fail on drift
//
// npm scripts: docs:widget-guide (build + write), docs:widget-guide:check.
// Ported from honua-sdk-js scripts/generate-widget-survival-guide.mjs with the
// engine move (#97); shim and component sources stay in honua-sdk-js, so the
// guide links there.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT_PATH = "docs/widget-survival-guide.md";
const DATA_MODULE = "dist/migration/widget-dispositions.js";
const SDK_JS_BLOB = "https://github.com/honua-io/honua-sdk-js/blob/trunk/";
const PUNCH_LIST = `${SDK_JS_BLOB}docs/migration-punch-list.md`;
// The guide ships in the npm package, which does not include upstream/, so the
// data source is linked by repository URL rather than by relative path. It is
// pinned to the `javascript-v<version>` release tag (rather than /blob/trunk/)
// so a guide already shipped in an older npm version keeps linking to the
// dataset it was actually generated from, not a later disposition change on
// trunk.
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.resolve(ROOT, "package.json"), "utf8")).version;
const DATA_SOURCE =
  `https://github.com/honua-io/honua-migrate/blob/javascript-v${PACKAGE_VERSION}/` +
  "packages/javascript/upstream/src/migration/widget-dispositions.ts";

const DISPOSITION_LABELS = {
  automated: "Automated",
  "compat-shim": "Compat shim",
  "app-platform": "App platform",
  "maplibre-plugin": "MapLibre plugin",
  "manual-workaround": "Manual workaround",
  "no-equivalent": "No equivalent",
};

const DISPOSITION_DESCRIPTIONS = {
  automated:
    "The `honua-js-migrate` codemod deterministically rewrites the import and safe constructor call sites to a " +
    "Honua compat shim from `@honua/sdk-esri-compat`. Unsafe option literals fall through to an annotated manual TODO.",
  "compat-shim":
    "A Honua compat shim exists and the codemod rewrites to it, but the widget carries a large interaction " +
    "surface. Treat the migration as assisted and verify app-specific behavior by hand.",
  "app-platform":
    "A native Honua app-platform element ships for this capability. " +
    "(Reserved: no widget currently carries this disposition in this data version.)",
  "maplibre-plugin":
    "The capability is served by a MapLibre control or community plugin wired up by hand. " +
    "(Reserved: no widget currently carries this disposition; several `automated` rows note the MapLibre-native control underneath.)",
  "manual-workaround":
    "No drop-in replacement and no codemod rewrite. The row documents an explicit, honest workaround that is real app work you own.",
  "no-equivalent":
    "No Honua or MapLibre surface reproduces the widget today. Apps that depend on it need a product decision, not a rewrite.",
};

function sdkJsLink(source) {
  return `${SDK_JS_BLOB}${source}`;
}

export function generateWidgetSurvivalGuideMarkdown(data) {
  const {
    WIDGET_DISPOSITION_DOCUMENTATION,
    WIDGET_DISPOSITION_KINDS,
    WIDGET_DISPOSITION_DATA_VERSION,
    ARCGIS_WIDGET_LIFECYCLE_STATEMENT,
    ARCGIS_WIDGET_REMOVAL_RELEASE,
    ARCGIS_WIDGET_INVENTORY_PIN,
    ARCGIS_WIDGET_INVENTORY_SOURCE,
  } = data;
  const pin = ARCGIS_WIDGET_INVENTORY_PIN;

  const widgets = [...WIDGET_DISPOSITION_DOCUMENTATION].sort((a, b) => a.widget.localeCompare(b.widget));
  const countsByDisposition = new Map(WIDGET_DISPOSITION_KINDS.map((kind) => [kind, 0]));
  for (const entry of widgets) {
    countsByDisposition.set(entry.disposition, (countsByDisposition.get(entry.disposition) ?? 0) + 1);
  }

  const lines = [];
  lines.push("---");
  lines.push("type: reference");
  lines.push('title: "ArcGIS widget-removal survival guide"');
  lines.push(
    'description: "Every deprecated ArcGIS JS SDK widget, what replaces it in Honua, ' +
      'and whether the migration is automated, shimmed, hand-written or has no ' +
      'equivalent yet."',
  );
  lines.push('resource: "https://www.npmjs.com/package/@honua/honua-migrate"');
  lines.push("tags: [migration, arcgis, widgets, reference, generated]");
  lines.push("---");
  lines.push("<!-- GENERATED FILE - DO NOT EDIT.");
  lines.push("     Source of truth: upstream/src/migration/widget-dispositions.ts");
  lines.push("     Regenerate with: npm run docs:widget-guide -->");
  lines.push("");
  lines.push("# ArcGIS widget-removal survival guide");
  lines.push("");
  lines.push(ARCGIS_WIDGET_LIFECYCLE_STATEMENT);
  lines.push("");
  lines.push(
    "This guide answers, for each deprecated widget (`esri/widgets/*` / `@arcgis/core/widgets/*`), what happens if " +
      "you migrate to Honua/MapLibre instead of rewriting onto Esri's web components. Dispositions are deliberately " +
      `honest — including "no equivalent" — in the spirit of the [migration punch list](${PUNCH_LIST}).`,
  );
  lines.push("");
  lines.push(
    "This document is generated from the versioned disposition data in " +
      `[\`upstream/src/migration/widget-dispositions.ts\`](${DATA_SOURCE}) ` +
      `(v${WIDGET_DISPOSITION_DATA_VERSION}); the \`honua-js-migrate widgets\` scanner consumes the same data, so ` +
      "the scanner report and this guide cannot drift apart.",
  );
  lines.push("");
  lines.push("## Pinned sources");
  lines.push("");
  lines.push(
    `- Deprecated-widget inventory: [\`${pin.package}@${pin.version}\`](${ARCGIS_WIDGET_INVENTORY_SOURCE}), ` +
      `integrity \`${pin.integrity}\`, derived ${pin.retrieved}.`,
  );
  lines.push(`- Method: ${pin.method} That yields ${pin.widgets.length} widgets, one row each below.`);
  const widgetsBySince = new Map();
  for (const widget of pin.widgets) {
    const since = pin.deprecatedSince[widget];
    widgetsBySince.set(since, (widgetsBySince.get(since) ?? 0) + 1);
  }
  lines.push(
    `- Deprecated since: ${[...widgetsBySince]
      .sort(([left], [right]) => left.localeCompare(right, "en", { numeric: true }))
      .map(([since, count]) => `${count} in ${since}`)
      .join(", ")}.`,
  );
  lines.push(
    `- Top-level modules left out: ${pin.excludedModules
      .map((exclusion) => `\`${exclusion.module}\` (${exclusion.reason})`)
      .join(", ")}.`,
  );
  lines.push(`- Lifecycle statement: ${pin.lifecycleSources.map((source) => `<${source}>`).join(", ")}.`);
  lines.push("- Re-derive the inventory with `npm run inventory:arcgis-widgets -- <tarball> --check`.");
  lines.push("");
  lines.push("## Scan your app first");
  lines.push("");
  lines.push("```bash");
  lines.push("# Human-readable table (also: --json, --markdown, --gate <pct>, --report <file>)");
  lines.push("npx honua-js-migrate widgets ./src");
  lines.push("```");
  lines.push("");
  lines.push(
    "The report inventories every widget usage site (ESM imports, AMD `require([...])` arrays, and dynamic " +
      "`$arcgis.import(...)` specifiers), joins each row to the disposition below, and emits an overall " +
      "automated/assisted/manual split ahead of the removals planned from " +
      `${ARCGIS_WIDGET_REMOVAL_RELEASE}. \`--gate <pct>\` makes CI fail when the automated share drops below the ` +
      "threshold, or when no widget usage sites exist.",
  );
  lines.push("");
  lines.push("## Disposition taxonomy");
  lines.push("");
  for (const kind of WIDGET_DISPOSITION_KINDS) {
    lines.push(`- **${DISPOSITION_LABELS[kind]}** (\`${kind}\`): ${DISPOSITION_DESCRIPTIONS[kind]}`);
  }
  lines.push("");
  lines.push(
    "Readiness buckets: `automated` counts as automated; `compat-shim`, `app-platform`, and " +
      "`maplibre-plugin` count as assisted; `manual-workaround` and `no-equivalent` count as manual.",
  );
  lines.push("");
  lines.push(
    "A compat-backed row may also list a direct `@honua/app-platform` component. That component is the " +
      "recommended destination for a deliberate UI rewrite; the disposition still describes what `honua-js-migrate` " +
      "can automate today.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Disposition | Widgets |");
  lines.push("| --- | --- |");
  for (const kind of WIDGET_DISPOSITION_KINDS) {
    lines.push(`| \`${kind}\` | ${countsByDisposition.get(kind)} |`);
  }
  lines.push(`| **Total** | **${widgets.length}** |`);
  lines.push("");
  lines.push("## Widget dispositions");
  lines.push("");
  lines.push("| Widget | ESM module | AMD module | Disposition | Target |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const entry of widgets) {
    const appPlatformTarget = entry.appPlatformComponent
      ? `<br>Direct app-platform component: [\`<${entry.appPlatformComponent.tagName}>\`](${sdkJsLink(entry.appPlatformComponent.source)}) ` +
        `from \`${entry.appPlatformComponent.moduleSpecifier}\``
      : "";
    lines.push(
      `| [${entry.widget}](#${data.widgetSurvivalGuideAnchor(entry.widget)}) | ${entry.esmModules
        .map((moduleId) => `\`${moduleId}\``)
        .join("<br>")} | ${entry.amdModules.map((moduleId) => `\`${moduleId}\``).join("<br>")} | \`${
        entry.disposition
      }\` | ${escapeTableCell(`${entry.target}${appPlatformTarget}`)} |`,
    );
  }
  lines.push("");
  lines.push("## Per-widget details");
  lines.push("");
  for (const entry of widgets) {
    lines.push(`### ${entry.widget}`);
    lines.push("");
    lines.push(`- Disposition: \`${entry.disposition}\` (${DISPOSITION_LABELS[entry.disposition]})`);
    lines.push(`- Deprecated since: ArcGIS JS ${pin.deprecatedSince[entry.widget]}`);
    lines.push(`- Modules: ${[...entry.esmModules, ...entry.amdModules].map((moduleId) => `\`${moduleId}\``).join(", ")}`);
    lines.push(`- Target: ${entry.target}`);
    if (entry.shimSource) {
      lines.push(`- Compat shim source: [\`${entry.shimSource}\`](${sdkJsLink(entry.shimSource)}) in honua-sdk-js`);
    }
    if (entry.appPlatformComponent) {
      lines.push(
        `- Direct app-platform component: [\`<${entry.appPlatformComponent.tagName}>\`](${sdkJsLink(entry.appPlatformComponent.source)}) ` +
          `from \`${entry.appPlatformComponent.moduleSpecifier}\``,
      );
    }
    lines.push(`- Notes: ${entry.notes}`);
    if (entry.appPlatformComponent) {
      lines.push("");
      lines.push("App-platform usage (the module import auto-registers the element):");
      lines.push("");
      lines.push("```ts");
      lines.push(`import "${entry.appPlatformComponent.moduleSpecifier}";`);
      lines.push("```");
      lines.push("");
      lines.push("```html");
      lines.push(entry.appPlatformComponent.usageHtml);
      lines.push("```");
    }
    lines.push("");
  }
  lines.push("## Out of scope");
  lines.push("");
  lines.push("These surfaces are intentionally **not** covered by the dispositions above:");
  lines.push("");
  lines.push(
    "- **SceneView / 3D rendering.** Honua's `SceneViewCompat` shares 2D `MapView` behavior; WebGL/CesiumJS scene " +
      `parity is not implemented ([punch list, parity gaps 1-2](${PUNCH_LIST})). The 3D widgets above are ` +
      "therefore `no-equivalent` rather than shimmed.",
  );
  lines.push(
    "- **Geoprocessor / NetworkAnalyst beyond RouteTask.** Service-area, closest-facility, OD-cost-matrix, and " +
      "general geoprocessing have no Honua widget equivalent; the scanner's `advanced-widget-or-networking-detected` " +
      `flag calls these out separately ([punch list, parity gap 3](${PUNCH_LIST})).`,
  );
  lines.push("");
  lines.push("## Related reading");
  lines.push("");
  lines.push(`- [Migration punch list](${PUNCH_LIST}) — the honest parity/codemod accounting.`);
  lines.push("- [Reading the migration report](../README.md#reading-the-migration-report) — readiness and denominators.");
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

function escapeTableCell(value) {
  // Escape backslashes first so pre-existing backslashes cannot combine with
  // the pipe escaping into ambiguous sequences (CodeQL js/incomplete-sanitization).
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export function validateGuideLinks(markdown, sourcePath, projectRoot = ROOT) {
  const failures = [];
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|#)/.test(href)) continue;
    const target = href.split("#", 1)[0];
    const absolute = path.resolve(projectRoot, path.dirname(sourcePath), target);
    if (!fs.existsSync(absolute)) failures.push(`${sourcePath}: broken internal link ${href}`);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

async function main() {
  const command = process.argv[2] ?? "check";
  if (!["check", "write"].includes(command)) throw new Error(`unknown command: ${command}`);

  const dataModulePath = path.join(ROOT, DATA_MODULE);
  if (!fs.existsSync(dataModulePath)) {
    throw new Error(`${DATA_MODULE} is missing; run npm run build first (or use npm run docs:widget-guide)`);
  }
  const data = await import(pathToFileURL(dataModulePath).href);
  const generated = generateWidgetSurvivalGuideMarkdown(data);
  validateGuideLinks(generated, OUTPUT_PATH);

  const outputFile = path.join(ROOT, OUTPUT_PATH);
  if (command === "write") {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, generated, "utf8");
  } else {
    const current = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
    // Normalize line endings so Windows checkouts (core.autocrlf) do not
    // report false drift against the generator's LF output.
    if (current.replace(/\r\n/g, "\n") !== generated) {
      throw new Error(`${OUTPUT_PATH} has drifted; run npm run docs:widget-guide`);
    }
  }
  process.stdout.write(
    `${command === "write" ? "Generated" : "Verified"} ${OUTPUT_PATH} from ${data.WIDGET_DISPOSITIONS.length} widget dispositions (data v${data.WIDGET_DISPOSITION_DATA_VERSION})\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
