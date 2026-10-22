import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runEsriCompatCodemod } from "../src/migration/codemod.js";
import { getJsParityMatrix, summarizeJsParityMatrix } from "../src/migration/parity-matrix.js";
import { buildJsMigrationReport } from "../src/migration/report.js";

const tempDirs: string[] = [];
const MIGRATION_DIR = path.resolve(import.meta.dirname, "../src/migration");

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-non-ascii-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("non-ASCII string literals restored after the engine import", () => {
  it("keeps the geometry-engine ellipsis in the parity matrix JSON the CLI writes", () => {
    const source = fs.readFileSync(path.join(MIGRATION_DIR, "parity-matrix.ts"), "utf8");
    expect(source).toContain("cut, \u2026)");
    expect(source).not.toContain("cut, ?)");

    const matrix = getJsParityMatrix();
    const note = matrix.find((row) => row.kind === "geometry-engine")?.notes ?? "";
    expect(note).toContain("uncovered ops (geodesic densify, offset, cut, \u2026) keep a manual TODO.");
    expect(note).not.toContain("?");

    const artifact = JSON.stringify({ summary: summarizeJsParityMatrix(matrix), matrix });
    expect(artifact).toContain("cut, \u2026)");
    expect(artifact).not.toContain("cut, ?)");
  });

  it("keeps the WebMap arrow in the migration report JSON and CLI todo lines", () => {
    const source = fs.readFileSync(path.join(MIGRATION_DIR, "codemod.ts"), "utf8");
    expect(source).toContain("WebMap \u2192 MapLibre style derivation");
    expect(source).not.toContain("WebMap ? MapLibre");

    const root = makeTempProject();
    const file = path.join(root, "webmap-arcade.ts");
    fs.writeFileSync(
      file,
      [
        "import WebMap from '@arcgis/core/WebMap';",
        "const webmap = new WebMap({ operationalLayers: [{ id: 'facilities', url: 'https://services.example.com/Facilities/FeatureServer/0', layerType: 'ArcGISFeatureLayer', layerDefinition: { drawingInfo: { renderer: { type: 'simple', symbol: { type: 'esriSFS', style: 'esriSFSSolid', color: [180, 180, 200, 255] } } } }, popupInfo: { title: '{NAME}', expressionInfos: [{ name: 'statusText', expression: \"IIF($feature.STATUS == 1, 'Open', 'Closed')\" }] } }] });",
        "void webmap;",
      ].join("\n"),
      "utf8",
    );

    const codemodResult = runEsriCompatCodemod({
      rootDir: root,
      target: "honua-maplibre",
      write: true,
      annotateTodos: true,
    });
    const report = buildJsMigrationReport(root, codemodResult);
    const reportJson = JSON.stringify(report);
    const cliLines = [
      ...report.manualTodos.map((todo) => `- ${todo.file}:${todo.line}:${todo.column} [${todo.kind}] ${todo.reason}`),
      ...report.manualTodoReasons.map((reason) => `- ${reason.count}x [${reason.kinds.join(",")}] ${reason.reason}`),
    ];

    expect(cliLines.some((line) => line.includes("WebMap \u2192 MapLibre style derivation"))).toBe(true);
    expect(cliLines.join("\n")).not.toContain("WebMap ? MapLibre");
    expect(reportJson).toContain("WebMap \u2192 MapLibre style derivation");
    expect(reportJson).not.toContain("WebMap ? MapLibre");
    expect(fs.readFileSync(file, "utf8")).toContain("WebMap \u2192 MapLibre style derivation");
  });
});
