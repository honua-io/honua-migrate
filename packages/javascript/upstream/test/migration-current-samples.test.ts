import path from "node:path";

import { describe, expect, it } from "vitest";

import { runEsriCompatCodemod } from "../src/migration/codemod.js";
import { buildJsMigrationReport } from "../src/migration/report.js";
import { scanArcGisUsage } from "../src/migration/scanner.js";

const CORPUS = path.join(import.meta.dirname, "fixtures", "esri-current-samples");

function migrate(name: string) {
  const rootDir = path.join(CORPUS, name);
  const scanReport = scanArcGisUsage(rootDir);
  const codemodResult = runEsriCompatCodemod({ rootDir, write: false, target: "honua-compat" });
  return { scanReport, codemodResult, report: buildJsMigrationReport(rootDir, codemodResult, scanReport) };
}

describe("current ArcGIS sample corpus", () => {
  it("rewrites supported $arcgis.import loads and leaves a component-only page on the Esri client", () => {
    const trees = migrate("intro-featurelayer");
    const counties = migrate("featurelayer-query");
    const related = migrate("query-related-features");

    expect(trees.report.conversion.recommendedMode).toBe("assisted-conversion");
    expect(trees.codemodResult.filesChanged).toBe(1);
    expect(trees.report.conversion.files.find((file) => file.file === "index.html")?.boundary).toBe("mixed");
    expect(trees.report.unhandledArcGisModules.map((module) => module.modulePath)).not.toContain(
      "@arcgis/core/layers/FeatureLayer.js",
    );

    expect(counties.report.conversion.recommendedMode).toBe("assisted-conversion");
    const countyModules = counties.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(countyModules).not.toContain("@arcgis/core/layers/FeatureLayer.js");
    expect(countyModules).not.toContain("@arcgis/core/Map.js");
    expect(countyModules).toContain("@arcgis/core/geometry/operators/centroidOperator.js");

    expect(related.report.conversion.recommendedMode).toBe("keep-esri-client");
    expect(related.codemodResult.filesChanged).toBe(0);
  });
});
