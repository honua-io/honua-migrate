import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  compareInventoryToPin,
  deriveWidgetInventory,
  inventoryFromTarball,
  readTarEntries,
} from "../scripts/arcgis-widget-inventory.mjs";
import { generateWidgetSurvivalGuideMarkdown, validateGuideLinks } from "../scripts/generate-widget-survival-guide.mjs";
import { SUPPORTED_ARCGIS_MODULES } from "../src/migration/codemod.js";
import * as widgetDispositionData from "../src/migration/widget-dispositions.js";
import {
  ARCGIS_WIDGET_DEPRECATION_RELEASE,
  ARCGIS_WIDGET_INVENTORY_PIN,
  ARCGIS_WIDGET_INVENTORY_SOURCE,
  ARCGIS_WIDGET_LIFECYCLE_STATEMENT,
  ARCGIS_WIDGET_REMOVAL_RELEASE,
  ARCGIS_WIDGET_REMOVAL_TIMEFRAME,
  WIDGET_DISPOSITIONS,
  WIDGET_DISPOSITION_DOCUMENTATION,
  WIDGET_DISPOSITION_KINDS,
  WIDGET_SURVIVAL_GUIDE_PATH,
  widgetModulePathInfo,
  widgetNameFromModulePath,
} from "../src/migration/widget-dispositions.js";
import {
  buildWidgetReadinessReport,
  formatWidgetReadinessMarkdown,
  formatWidgetReadinessTable,
  scanWidgetUsage,
} from "../src/migration/widget-scanner.js";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const GUIDE_FILE = path.join(PACKAGE_ROOT, WIDGET_SURVIVAL_GUIDE_PATH);
const README_FILE = path.join(PACKAGE_ROOT, "README.md");
const WIDGET_FIXTURE = path.join(import.meta.dirname, "fixtures", "esri-widget-cliff-app");

// Wording the ArcGIS 5.0 notes and the components transition plan do not support:
// widgets are deprecated, existing apps keep working, and removals only *begin* at 6.0.
const OVERSTATED_LIFECYCLE =
  /removed at 6\.0|removes at 6\.0|are removed at|stop(?:s|ped)? (?:working|compiling|running)|no longer work|already (?:broken|removed)/i;
// `?` standing in for a lost em dash between two pieces of report text.
const LOST_DASH = /` \? `|\| \? \||readiness \? |import \? /;

function compatPackageTypings(): Map<string, string> {
  const require = createRequire(import.meta.url);
  const packageDir = path.dirname(require.resolve("@honua/sdk-esri-compat"));
  const compatDir = path.join(packageDir, "esri-compat");
  const typings = new Map<string, string>();
  for (const name of fs.readdirSync(compatDir)) {
    if (name.endsWith(".d.ts")) {
      typings.set(name, fs.readFileSync(path.join(compatDir, name), "utf8"));
    }
  }
  return typings;
}

// Minimal ustar writer: the expected inventory below is written by hand from
// these entries, independently of the reader under test.
function tarEntry(name: string, body: string, options: { prefix?: string; type?: string } = {}): Buffer {
  const content = Buffer.from(body, "utf8");
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.write(options.type ?? "0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (options.prefix) header.write(options.prefix, 345, 155, "utf8");
  header.fill(" ", 148, 156);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512, 0);
  return Buffer.concat([header, content, padding]);
}

function paxEntry(fullPath: string, body: string): Buffer {
  const record = (length: number) => `${length} path=${fullPath}\n`;
  let length = record(0).length;
  while (record(length).length !== length) length = record(length).length;
  return Buffer.concat([tarEntry("PaxHeader", record(length), { type: "x" }), tarEntry("truncated-name", body)]);
}

function deprecatedClass(name: string, tag: string): string {
  return `import type Widget from "./Widget.js";\n/**\n * ${name}.\n * ${tag} Use the component instead.\n */\nexport default class ${name} {}\n`;
}

function syntheticArcGisCore(): Buffer {
  const longName = "AVeryLongWidgetNameThatNeedsAPaxHeader";
  return Buffer.concat([
    tarEntry("package/package.json", JSON.stringify({ name: "@arcgis/core", version: "9.9.9" })),
    tarEntry("package/widgets/Legend.js", "export {};"),
    tarEntry("package/widgets/Legend.d.ts", deprecatedClass("Legend", "@deprecated since 5.0.")),
    tarEntry("Zoom.js", "export {};", { prefix: "package/widgets" }),
    tarEntry("Zoom.d.ts", deprecatedClass("Zoom", "@deprecated\n * since version 4.32."), {
      prefix: "package/widgets",
    }),
    paxEntry(`package/widgets/${longName}.js`, "export {};"),
    paxEntry(`package/widgets/${longName}.d.ts`, deprecatedClass(longName, "@deprecated since version 4.33.")),
    // Only a member is deprecated, not the class.
    tarEntry("package/widgets/Widget.js", "export {};"),
    tarEntry(
      "package/widgets/Widget.d.ts",
      "/** Base class. */\nexport default class Widget {\n  /** @deprecated since 5.0 */\n  old: string;\n}\n",
    ),
    // The deprecated doc block belongs to an interface, not to the class below it.
    tarEntry("package/widgets/Orphan.js", "export {};"),
    tarEntry(
      "package/widgets/Orphan.d.ts",
      "/** @deprecated since 5.0 */\nexport interface OrphanProperties {}\nexport default class Orphan {}\n",
    ),
    tarEntry("package/widgets/Spinner.js", "export {};"),
    tarEntry("package/widgets/types.d.ts", deprecatedClass("types", "@deprecated since 5.0.")),
    tarEntry("package/widgets/Legend/LegendViewModel.js", "export {};"),
    tarEntry(
      "package/widgets/Legend/LegendViewModel.d.ts",
      deprecatedClass("LegendViewModel", "@deprecated since 5.0."),
    ),
    tarEntry("package/layers/FeatureLayer.js", "export {};"),
    tarEntry("package/layers/FeatureLayer.d.ts", deprecatedClass("FeatureLayer", "@deprecated since 5.0.")),
    Buffer.alloc(1024, 0),
  ]);
}

describe("pinned ArcGIS widget inventory", () => {
  it("pins an exact published @arcgis/core release, not a moving documentation page", () => {
    expect(ARCGIS_WIDGET_INVENTORY_PIN.package).toBe("@arcgis/core");
    expect(ARCGIS_WIDGET_INVENTORY_PIN.version).toMatch(/^5\.0\.\d+$/);
    expect(ARCGIS_WIDGET_INVENTORY_PIN.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    expect(ARCGIS_WIDGET_INVENTORY_PIN.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ARCGIS_WIDGET_INVENTORY_SOURCE).toBe(
      `https://www.npmjs.com/package/@arcgis/core/v/${ARCGIS_WIDGET_INVENTORY_PIN.version}`,
    );
    expect(ARCGIS_WIDGET_INVENTORY_SOURCE).not.toContain("/latest/");
  });

  it("lists each deprecated widget once, sorted, and never also as excluded", () => {
    const widgets = ARCGIS_WIDGET_INVENTORY_PIN.widgets;
    expect(widgets).toHaveLength(59);
    expect([...widgets].sort()).toEqual(widgets);
    expect(new Set(widgets).size).toBe(widgets.length);
    const excluded = ARCGIS_WIDGET_INVENTORY_PIN.excludedModules.map((exclusion) => exclusion.module);
    expect(excluded).toEqual(["FovOverlay", "PanoramicVideoViewer", "PanoramicViewer", "Spinner", "Widget"]);
    for (const module of excluded) {
      expect(widgets).not.toContain(module);
    }
  });

  it("records when each widget was deprecated, all by 5.0 and the earliest at 4.32", () => {
    const since = ARCGIS_WIDGET_INVENTORY_PIN.deprecatedSince;
    expect(Object.keys(since).sort()).toEqual([...ARCGIS_WIDGET_INVENTORY_PIN.widgets]);
    const counts: Record<string, number> = {};
    for (const release of Object.values(since)) counts[release] = (counts[release] ?? 0) + 1;
    expect(counts).toEqual({ "4.32": 12, "4.33": 9, "4.34": 7, "5.0": 31 });
    expect(since.DirectionalPad).toBe("4.32");
    expect(since.Popup).toBe("5.0");
    expect(since.TimeZoneLabel).toBe("4.33");
  });

  it("has exactly one disposition row per inventory widget and no rows outside it", () => {
    const rows = WIDGET_DISPOSITIONS.map((entry) => entry.widget).sort();
    expect(rows).toEqual([...ARCGIS_WIDGET_INVENTORY_PIN.widgets]);
  });
});

describe("inventory re-derivation from a tarball", () => {
  it("applies the pin's method to class-level deprecations of top-level widget modules only", () => {
    const tar = syntheticArcGisCore();
    const derived = deriveWidgetInventory(readTarEntries(tar));
    expect(derived).toEqual({
      package: "@arcgis/core",
      version: "9.9.9",
      deprecatedSince: { AVeryLongWidgetNameThatNeedsAPaxHeader: "4.33", Legend: "5.0", Zoom: "4.32" },
      widgets: ["AVeryLongWidgetNameThatNeedsAPaxHeader", "Legend", "Zoom"],
      excludedModules: [
        { module: "Orphan", reason: "not-deprecated" },
        { module: "Spinner", reason: "untyped" },
        { module: "Widget", reason: "not-deprecated" },
      ],
    });
  });

  it("records the gzip tarball's sha512 integrity and reports every difference from a pin", () => {
    const tar = syntheticArcGisCore();
    const tgz = gzipSync(tar);
    const derived = inventoryFromTarball(tgz);
    expect(derived.integrity).toBe(`sha512-${createHash("sha512").update(tgz).digest("base64")}`);
    expect(derived.widgets).toEqual(["AVeryLongWidgetNameThatNeedsAPaxHeader", "Legend", "Zoom"]);

    expect(compareInventoryToPin(derived, { ...derived })).toEqual([]);
    const problems = compareInventoryToPin(derived, {
      ...derived,
      version: "9.9.8",
      deprecatedSince: { ...derived.deprecatedSince, Legend: "4.34" },
      widgets: ["Legend", "Swipe"],
    });
    expect(problems).toEqual([
      "version: tarball 9.9.9 != pin 9.9.8",
      "widget missing from pin: AVeryLongWidgetNameThatNeedsAPaxHeader",
      "widget missing from pin: Zoom",
      "widget not in tarball: Swipe",
      "deprecatedSince Legend: tarball 5.0 != pin 4.34",
    ]);
  });
});

describe("widget disposition rows", () => {
  it("uses exactly one taxonomy disposition per widget, with real target and notes text", () => {
    for (const entry of WIDGET_DISPOSITIONS) {
      expect(WIDGET_DISPOSITION_KINDS).toContain(entry.disposition);
      expect(entry.target.trim().length).toBeGreaterThan(0);
      expect(entry.notes.trim().length).toBeGreaterThan(0);
      expect(`${entry.target} ${entry.notes}`).not.toMatch(/\bTBD\b|\?\?/i);
      for (const modulePath of [...entry.esmModules, ...entry.amdModules]) {
        expect(widgetNameFromModulePath(modulePath)).toBe(entry.widget);
      }
    }
    const modules = WIDGET_DISPOSITIONS.flatMap((entry) => [...entry.esmModules, ...entry.amdModules]);
    expect(new Set(modules).size).toBe(modules.length);
  });

  it("marks a row automated or compat-shim exactly when the codemod rewrites that widget", () => {
    const codemodWidgets = new Set(
      SUPPORTED_ARCGIS_MODULES.flatMap((modulePath) => {
        const info = widgetModulePathInfo(modulePath);
        return info && !info.supportModule ? [info.widget] : [];
      }),
    );
    expect(codemodWidgets.size).toBeGreaterThan(0);
    const shimBacked = new Set(
      WIDGET_DISPOSITIONS.filter(
        (entry) => entry.disposition === "automated" || entry.disposition === "compat-shim",
      ).map((entry) => entry.widget),
    );
    expect([...shimBacked].sort()).toEqual([...codemodWidgets].sort());
  });

  it("grounds every shim-backed row in a <Widget>Compat class shipped by @honua/sdk-esri-compat", () => {
    const typings = compatPackageTypings();
    for (const entry of WIDGET_DISPOSITIONS) {
      if (entry.disposition !== "automated" && entry.disposition !== "compat-shim") {
        expect(entry.shimSource, `${entry.widget} has no shim, so it must not name a shim source`).toBeUndefined();
        continue;
      }
      expect(entry.shimSource, `${entry.widget} must record its shim source`).toMatch(/^src\/esri-compat\/[\w-]+\.ts$/);
      const typingName = path.basename(entry.shimSource!).replace(/\.ts$/, ".d.ts");
      const typing = typings.get(typingName);
      expect(typing, `${entry.shimSource} is not in the installed @honua/sdk-esri-compat`).toBeDefined();
      expect(typing).toContain(`export declare class ${entry.widget}Compat `);
    }
  });

  it("names only compat classes and members that @honua/sdk-esri-compat declares", () => {
    const typings = [...compatPackageTypings().values()];
    for (const entry of WIDGET_DISPOSITIONS) {
      const prose = `${entry.target} ${entry.notes}`;
      for (const match of prose.matchAll(/\b([A-Z]\w*Compat)\b(?:\.(\w+))?/g)) {
        const [, className, member] = match;
        const declaring = typings.find((typing) => typing.includes(`export declare class ${className} `));
        expect(
          declaring,
          `${entry.widget} names ${className}, which the compat package does not declare`,
        ).toBeDefined();
        if (member) {
          expect(declaring, `${entry.widget} names ${className}.${member}`).toMatch(new RegExp(`\\b${member}\\(`));
        }
      }
    }
  });
});

describe("widget lifecycle claims", () => {
  it("states the pinned ArcGIS lifecycle precisely", () => {
    expect(ARCGIS_WIDGET_DEPRECATION_RELEASE).toBe("5.0");
    expect(ARCGIS_WIDGET_REMOVAL_RELEASE).toBe("6.0");
    expect(ARCGIS_WIDGET_REMOVAL_TIMEFRAME).toBe("as early as Q1 2027");
    expect(ARCGIS_WIDGET_LIFECYCLE_STATEMENT).toBe(
      "Every classic ArcGIS JS widget is deprecated as of 5.0 (some since 4.32), and existing widget-based apps " +
        "keep working on 5.x. " +
        "Esri plans to begin removing widgets at 6.0 (as early as Q1 2027), each once its component no longer " +
        "wraps widget code.",
    );
    expect(ARCGIS_WIDGET_INVENTORY_PIN.lifecycleSources).toEqual([
      "https://developers.arcgis.com/javascript/latest/v5-0/",
      "https://developers.arcgis.com/javascript/latest/components-transition-plan/",
    ]);
  });

  it("carries that statement, and no overstatement or lost dash, into every rendered widget report", () => {
    const report = buildWidgetReadinessReport(scanWidgetUsage(WIDGET_FIXTURE));
    const table = formatWidgetReadinessTable(report);
    const markdown = formatWidgetReadinessMarkdown(report);
    expect(report.summaryLine.endsWith(ARCGIS_WIDGET_LIFECYCLE_STATEMENT)).toBe(true);
    expect(markdown).toContain(ARCGIS_WIDGET_LIFECYCLE_STATEMENT);
    expect(table.split("\n")[0]).toBe(
      "ArcGIS widget readiness — deprecated at 5.0; removals begin at 6.0 (as early as Q1 2027)",
    );
    expect(markdown).toContain("` — `");
    for (const rendered of [report.summaryLine, table, markdown, JSON.stringify(report)]) {
      expect(rendered).not.toMatch(OVERSTATED_LIFECYCLE);
      expect(rendered).not.toMatch(LOST_DASH);
    }
  });

  it("keeps the rows, README, and guide free of overstated lifecycle wording", () => {
    for (const entry of WIDGET_DISPOSITION_DOCUMENTATION) {
      expect(`${entry.target} ${entry.notes}`, entry.widget).not.toMatch(OVERSTATED_LIFECYCLE);
    }
    expect(fs.readFileSync(README_FILE, "utf8")).not.toMatch(OVERSTATED_LIFECYCLE);
    expect(fs.readFileSync(GUIDE_FILE, "utf8")).not.toMatch(OVERSTATED_LIFECYCLE);
  });
});

describe("widget survival guide", () => {
  it("exists where every report guideLink points and matches regeneration", () => {
    const generated = generateWidgetSurvivalGuideMarkdown(widgetDispositionData);
    const current = fs.readFileSync(GUIDE_FILE, "utf8").replace(/\r\n/g, "\n");
    expect(current, `${WIDGET_SURVIVAL_GUIDE_PATH} has drifted; run npm run docs:widget-guide`).toBe(generated);
  });

  it("documents the pin and gives every inventory widget its own section", () => {
    const guide = fs.readFileSync(GUIDE_FILE, "utf8");
    expect(guide).toContain(ARCGIS_WIDGET_LIFECYCLE_STATEMENT);
    expect(guide).toContain(`@arcgis/core@${ARCGIS_WIDGET_INVENTORY_PIN.version}`);
    expect(guide).toContain(ARCGIS_WIDGET_INVENTORY_PIN.integrity);
    expect(guide).toContain(`That yields ${ARCGIS_WIDGET_INVENTORY_PIN.widgets.length} widgets`);
    expect(guide).toContain("- Deprecated since: 12 in 4.32, 9 in 4.33, 7 in 4.34, 31 in 5.0.");
    for (const widget of ARCGIS_WIDGET_INVENTORY_PIN.widgets) {
      expect(guide).toContain(
        `\n### ${widget}\n\n- Disposition: \`${WIDGET_DISPOSITIONS.find((entry) => entry.widget === widget)?.disposition}\``,
      );
      expect(guide).toContain(`- Deprecated since: ArcGIS JS ${ARCGIS_WIDGET_INVENTORY_PIN.deprecatedSince[widget]}`);
    }
    expect(guide).toContain("| **Total** | **59** |");
  });

  it("has no broken relative links", () => {
    const guide = fs.readFileSync(GUIDE_FILE, "utf8");
    expect(() => validateGuideLinks(guide, WIDGET_SURVIVAL_GUIDE_PATH, PACKAGE_ROOT)).not.toThrow();
  });

  it("links relatively only to files the npm package ships, so the published guide has no dead links", () => {
    const guide = fs.readFileSync(GUIDE_FILE, "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      files: string[];
    };
    const shipped = new Set(packageJson.files);
    expect(shipped.has(path.dirname(WIDGET_SURVIVAL_GUIDE_PATH))).toBe(true);
    const relativeTargets = [...guide.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((href) => !/^(?:https?:|mailto:|#)/.test(href));
    expect(relativeTargets.length).toBeGreaterThan(0);
    for (const href of relativeTargets) {
      const target = path.relative(PACKAGE_ROOT, path.resolve(path.dirname(GUIDE_FILE), href.split("#", 1)[0]));
      expect(
        shipped.has(target.split(path.sep)[0]),
        `${href} resolves to ${target}, which the npm package does not ship`,
      ).toBe(true);
    }
  });
});
