import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runEsriCompatCodemod } from "../src/migration/codemod.js";
import { buildJsMigrationReport } from "../src/migration/report.js";
import { scanArcGisUsage } from "../src/migration/scanner.js";

const CORPUS = path.join(import.meta.dirname, "fixtures", "esri-current-samples");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writtenPage(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-current-sample-"));
  tempDirs.push(dir);
  fs.cpSync(path.join(CORPUS, name), dir, { recursive: true });
  runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
  return fs.readFileSync(path.join(dir, "index.html"), "utf8");
}

function migrate(name: string) {
  const rootDir = path.join(CORPUS, name);
  const scanReport = scanArcGisUsage(rootDir);
  const codemodResult = runEsriCompatCodemod({ rootDir, write: false, target: "honua-compat" });
  return { scanReport, codemodResult, report: buildJsMigrationReport(rootDir, codemodResult, scanReport) };
}

describe("current ArcGIS sample corpus", () => {
  it("rewrites supported loads and the viewer shell, and holds related-record calls", () => {
    const trees = migrate("intro-featurelayer");
    const counties = migrate("featurelayer-query");
    const related = migrate("query-related-features");

    expect(trees.report.conversion.recommendedMode).toBe("assisted-conversion");
    expect(trees.codemodResult.filesChanged).toBe(1);
    expect(trees.report.conversion.files.find((file) => file.file === "index.html")?.boundary).toBe("mixed");
    expect(trees.report.unhandledArcGisModules.map((module) => module.modulePath)).not.toContain(
      "@arcgis/core/layers/FeatureLayer.js",
    );
    expect(writtenPage("intro-featurelayer")).toContain('new MapCompat({ basemap: "hybrid" })');

    expect(counties.report.conversion.recommendedMode).toBe("assisted-conversion");
    const countyModules = counties.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(countyModules).not.toContain("@arcgis/core/layers/FeatureLayer.js");
    expect(countyModules).not.toContain("@arcgis/core/Map.js");
    expect(countyModules).toContain("@arcgis/core/geometry/operators/centroidOperator.js");

    expect(related.report.conversion.recommendedMode).toBe("assisted-conversion");
    expect(related.report.conversion.recommendedMode).not.toBe("complete-honua-conversion");
    expect(related.codemodResult.filesChanged).toBe(1);
    const relatedModules = related.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(relatedModules).toContain("@arcgis/map-components/queryRelatedFeatures");
    expect(relatedModules).toContain("@arcgis/map-components/arcgisViewClick");
    expect(relatedModules).not.toContain("@arcgis/map-components/arcgis-map");
    expect(relatedModules).not.toContain("@arcgis/map-components/viewOnReady");
    expect(relatedModules).not.toContain("@arcgis/map-components/whenLayerView");

    const relatedPage = writtenPage("query-related-features");
    expect(relatedPage).toContain(
      'const honuaView = new MapViewCompat({ container: document.getElementById("honua-map"), map: new WebMapCompat({ portalItem: { id: "00113543095f45e78e521e316dc447dd" } }) });',
    );
    expect(relatedPage).toContain("await honuaView.when()");
    expect(relatedPage).toContain("await honuaView.whenLayerView(layer)");
    expect(relatedPage).not.toContain("viewElement.when()");
    expect(relatedPage).not.toContain("MapViewCompat.prototype.whenLayerView");
    expect(relatedPage).toContain("new ZoomCompat({ view: honuaView, container:");
    expect(relatedPage).toContain("new LegendCompat({ view: honuaView, container:");
    expect(relatedPage).toContain("new ExpandCompat({ view: honuaView, container:");
    expect(relatedPage).not.toContain("<arcgis-map");
    expect(relatedPage).not.toContain("<arcgis-zoom");
    expect(relatedPage).not.toContain("<arcgis-legend");
    expect(relatedPage).not.toContain("<arcgis-expand");
  });
});
