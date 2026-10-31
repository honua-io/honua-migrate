import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEsriCompatCodemod } from "../src/migration/codemod.js";

function inspect(source: string, filename = "app.ts") {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "basemap-readiness-"));
  try {
    fs.writeFileSync(path.join(rootDir, filename), source);
    return runEsriCompatCodemod({ rootDir, write: false, compatImportPath: "@honua/sdk-esri-compat" });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

const imports = [
  "import Map from '@arcgis/core/Map';",
  "import Basemap from '@arcgis/core/Basemap';",
  "import WebMap from '@arcgis/core/WebMap';",
  "import BasemapGallery from '@arcgis/core/widgets/BasemapGallery';",
  "import BasemapToggle from '@arcgis/core/widgets/BasemapToggle';",
].join("\n");

describe("basemap readiness", () => {
  it.each([
    "new Map({ basemap: 'streets' });",
    "new Map({ basemap: selected });",
    "new Basemap({ id: 'streets-vector' });",
    "new Basemap();",
    "new BasemapGallery({ view });",
    "new BasemapToggle({ view, nextBasemap: 'streets' });",
    "new WebMap({ portalItem: { id: 'example' } });",
    "Basemap.fromId('streets');",
    "map.basemap = selected;",
    "map.setBasemap('streets');",
    "new Map({ basemap: { baseLayers: [{ url: 'https://example.test/services/base/MapServer', ...options }] } });",
    "new Map({ basemap: { id: 'osm', id: selected } });",
  ])("reports unverified source as manual: %s", (expression) => {
    const result = inspect(`${imports}\n${expression}`);
    expect(result.metrics.manualCallSites).toBeGreaterThan(0);
    expect(result.manualTodos.some((todo) => /basemap/i.test(todo.reason))).toBe(true);
  });

  it.each([
    "new Map({ basemap: 'osm' });",
    "new Basemap({ id: 'osm' });",
    "new Map({ basemap: { baseLayers: [{ url: 'https://example.test/services/base/MapServer' }] } });",
  ])("accepts an explicit supported source: %s", (expression) => {
    expect(inspect(`${imports}\n${expression}`).metrics.manualCallSites).toBe(0);
  });

  it("reports an unverified HTML map shell", () => {
    const result = inspect('<arcgis-map basemap="streets"></arcgis-map>', "index.html");
    expect(result.metrics.manualCallSites).toBeGreaterThan(0);
  });
});
