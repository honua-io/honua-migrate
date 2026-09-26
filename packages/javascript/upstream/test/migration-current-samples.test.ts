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
  it("rewrites webpack esri/ imports and ignores an ambient asset module", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-esri-webpack-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "assets.d.ts"), 'declare module "*.svg";\n', "utf8");
    fs.writeFileSync(
      path.join(dir, "map.ts"),
      [
        'import ArcGISMap from "esri/Map";',
        'import MapView from "esri/views/MapView";',
        'import FeatureLayer from "esri/layers/FeatureLayer";',
        "export function build() {",
        '  const map = new ArcGISMap({ basemap: "topo-vector" });',
        '  const view = new MapView({ map, container: "view" });',
        '  const layer = new FeatureLayer({ url: "https://services.example.com/Places/FeatureServer/0" });',
        "  map.add(layer);",
        "  return view;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const written = fs.readFileSync(path.join(dir, "map.ts"), "utf8");

    expect(codemodResult.errors).toBeUndefined();
    expect(scanReport.imports.map((hit) => hit.modulePath).sort()).toEqual([
      "@arcgis/core/Map",
      "@arcgis/core/layers/FeatureLayer",
      "@arcgis/core/views/MapView",
    ]);
    expect(report.conversion.recommendedMode).not.toBe("keep-esri-client");
    expect(written).toContain("MapCompat");
    expect(written).toContain("MapViewCompat");
    expect(written).toContain("FeatureLayerCompat");
    expect(written).not.toContain('from "esri/Map"');
    expect(fs.readFileSync(path.join(dir, "assets.d.ts"), "utf8")).toBe('declare module "*.svg";\n');
  });

  it("rewrites a named geodesicLength import and a Point constructed with longitude and latitude", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-esri-length-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "nearby.ts"),
      [
        'import { geodesicLength } from "esri/geometry/geometryEngine";',
        'import Polyline from "esri/geometry/Polyline";',
        "export function miles(a: number, b: number) {",
        "  const line = new Polyline({ paths: [[[a, b], [a + 1, b + 1]]] });",
        '  return geodesicLength(line, "miles");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "point.ts"),
      ['import Point from "esri/geometry/Point";', "export const p = new Point({ longitude, latitude });", ""].join(
        "\n",
      ),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const written = fs.readFileSync(path.join(dir, "nearby.ts"), "utf8");
    expect(written).toContain("geometryEngineCompat.geodesicLength");
    expect(written).toContain("PolylineCompat");
    expect(written).not.toContain('from "esri/');
    expect(fs.readFileSync(path.join(dir, "point.ts"), "utf8")).toContain(
      "new PointCompat({ x: longitude, y: latitude })",
    );
  });

  it("leaves a Point on Esri when it is passed to an unre-written Esri call", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-point-esri-"));
    tempDirs.push(dir);
    const source = [
      'import Point from "esri/geometry/Point";',
      'import RouteTask from "esri/tasks/RouteTask";',
      "export function solve(lon: number, lat: number) {",
      "  const point = new Point({ longitude: lon, latitude: lat });",
      '  const task = new RouteTask({ url: "https://example.com/route" });',
      "  return task.solve(point);",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "route.ts"), source, "utf8");
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    expect(fs.readFileSync(path.join(dir, "route.ts"), "utf8")).toBe(source);
  });

  it("removes a js.arcgis.com worker loader and keeps a config file that sets an api key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-esri-config-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "workers.ts"),
      [
        'import esriConfig from "esri/config";',
        'esriConfig.workers.loaderScript = "https://js.arcgis.com/4.14/";',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "keyed.ts"),
      ['import esriConfig from "esri/config";', 'esriConfig.apiKey = "secret";', ""].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const workers = fs.readFileSync(path.join(dir, "workers.ts"), "utf8");
    expect(workers).toContain('from "@honua/sdk-esri-compat"');
    expect(workers).not.toContain("loaderScript");
    expect(workers).toContain("TODO(honua-migrate)[esri-config]");
    expect(fs.readFileSync(path.join(dir, "keyed.ts"), "utf8")).toContain('esriConfig.apiKey = "secret"');
    expect(fs.readFileSync(path.join(dir, "keyed.ts"), "utf8")).not.toContain("@honua/sdk-esri-compat");
  });

  it("rewrites esri.Point after the Point value moved and keeps an unmapped type", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-esri-types-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "types.ts"),
      [
        "import esri = __esri;",
        'import Point from "esri/geometry/Point";',
        "export function mark(): esri.Point {",
        "  const center: esri.Point = new Point({ x: 1, y: 2 });",
        "  return center;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "route-type.ts"),
      [
        "import esri = __esri;",
        'import Point from "esri/geometry/Point";',
        "export function mark(): esri.DirectionsFeatureSet {",
        "  const center: esri.Point = new Point({ x: 1, y: 2 });",
        "  return center as unknown as esri.DirectionsFeatureSet;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const types = fs.readFileSync(path.join(dir, "types.ts"), "utf8");
    expect(types).toContain("PointCompat");
    expect(types).not.toContain("esri.Point");
    expect(types).not.toContain("import esri = __esri");
    const routeType = fs.readFileSync(path.join(dir, "route-type.ts"), "utf8");
    expect(routeType).toContain("import esri = __esri");
    expect(routeType).toContain("esri.DirectionsFeatureSet");
    expect(routeType).toContain("PointCompat");
  });

  it("rewrites watchUtils calls onto the compat view and leaves init", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-watch-utils-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "map.ts"),
      [
        'import { init, once, whenFalseOnce, whenOnce, whenTrueOnce } from "esri/core/watchUtils";',
        'import Locate from "esri/widgets/Locate";',
        "export async function run(view: { when(): Promise<void>; extent: unknown; stationary: boolean }, layerView: { updating: boolean }) {",
        '  await whenOnce(view, "ready");',
        '  await once(view, "extent");',
        '  await whenTrueOnce(view, "stationary");',
        '  await whenFalseOnce(layerView, "updating");',
        "  const locate = new Locate({ view });",
        '  init(locate, "viewModel.state", () => {});',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const written = fs.readFileSync(path.join(dir, "map.ts"), "utf8");
    expect(written).toContain("await view.when()");
    expect(written).toContain("reactiveUtils.whenOnce(() => view.stationary)");
    expect(written).toContain("reactiveUtils.whenOnce(() => !layerView.updating)");
    expect(written).toContain(
      "new Promise((resolve) => { reactiveUtils.watch(() => view.extent, resolve, { once: true }); })",
    );
    expect(written).toContain('import { init } from "esri/core/watchUtils"');
    expect(written).toContain("new Locate(");
    expect(written).not.toContain("LocateCompat");
    expect(written).not.toContain('whenOnce(view, "ready")');
  });

  it("rewrites sign-in onto identityManager and OAuthInfoCompat", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-esri-oauth-"));
    tempDirs.push(dir);
    const source = [
      'import Credential from "esri/identity/Credential";',
      'import IdentityManager from "esri/identity/IdentityManager";',
      'import OAuthInfo from "esri/identity/OAuthInfo";',
      "export function initialize(appId: string) {",
      "  let info: OAuthInfo;",
      '  info = new OAuthInfo({ appId, portalUrl: "https://www.arcgis.com", popup: true });',
      "  IdentityManager.registerOAuthInfos([info]);",
      "  return Credential;",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "oauth.ts"), source, "utf8");
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const written = fs.readFileSync(path.join(dir, "oauth.ts"), "utf8");
    expect(written).toContain("identityManager.registerOAuthInfos");
    expect(written).toContain("let info: OAuthInfoCompat");
    expect(written).toContain("new OAuthInfoCompat");
    expect(written).toContain("IdentityCredentialCompat");
    expect(written).not.toContain('from "esri/');
  });

  it("rewrites supported loads and the viewer shell, and holds related-record calls", () => {
    const trees = migrate("intro-featurelayer");
    const counties = migrate("featurelayer-query");
    const related = migrate("query-related-features");

    expect(trees.report.conversion.recommendedMode).toBe("complete-honua-conversion");
    expect(trees.codemodResult.filesChanged).toBe(1);
    expect(trees.report.conversion.files.find((file) => file.file === "index.html")?.boundary).toBe("converted");
    expect(trees.report.unhandledArcGisModules.map((module) => module.modulePath)).not.toContain(
      "@arcgis/core/layers/FeatureLayer.js",
    );
    const treesPage = writtenPage("intro-featurelayer");
    expect(treesPage).toContain('new MapCompat({ basemap: "hybrid" })');
    expect(treesPage).toContain("FeatureLayerCompat");
    expect(treesPage).not.toContain('src="%CDN%"');

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

  it("rewrites the popup shell and geodetic length, and leaves smart-mapping statistics held", () => {
    const popup = migrate("popup-actions");
    const popupModules = popup.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(popupModules).not.toContain("@arcgis/core/geometry/operators/geodeticLengthOperator.js");
    expect(popup.report.conversion.recommendedMode).not.toBe("keep-esri-client");
    const popupPage = writtenPage("popup-actions");
    expect(popupPage).toContain("geometryEngineCompat.geodesicLength(geometry, unit)");
    expect(popupPage).not.toContain("geodeticLengthOperator.js");
    expect(popupPage).not.toContain('src="%CDN%"');

    const sizes = migrate("visualization-sm-size");
    const sizeModules = sizes.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(sizes.report.conversion.recommendedMode).toBe("assisted-conversion");
    expect(sizeModules).toContain("@arcgis/core/smartMapping/renderers/size.js");
    expect(sizeModules).toContain("@arcgis/core/smartMapping/statistics/histogram.js");
    expect(sizeModules).toContain("@arcgis/map-components/arcgis-slider-size-legacy");
    expect(sizeModules).not.toContain("@arcgis/map-components/arcgis-popup");
    const sizePage = writtenPage("visualization-sm-size");
    expect(sizePage).toContain("new PopupCompat({ view: honuaView, container:");
    expect(sizePage).toContain('src="%CDN%"');
  });
});
