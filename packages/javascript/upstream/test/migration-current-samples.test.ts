import { spawnSync } from "node:child_process";
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
  const codemodResult = runEsriCompatCodemod({
    rootDir,
    write: false,
    target: "honua-compat",
  });
  return {
    scanReport,
    codemodResult,
    report: buildJsMigrationReport(rootDir, codemodResult, scanReport),
  };
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
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
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
      'import SearchViewModel from "esri/widgets/Search/SearchViewModel";',
      "export function find(lon: number, lat: number) {",
      "  const point = new Point({ longitude: lon, latitude: lat });",
      "  const search = new SearchViewModel();",
      "  return search.search(point);",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "route.ts"), source, "utf8");
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    expect(fs.readFileSync(path.join(dir, "route.ts"), "utf8")).toBe(source);
  });

  it("rewrites Locator({ url }) and the Point passed to it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-locator-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"locator-app","private":true}\n', "utf8");
    fs.writeFileSync(
      path.join(dir, "places.ts"),
      [
        'import Point from "esri/geometry/Point";',
        'import Locator from "esri/tasks/Locator";',
        "const geocoder = new Locator({ url: geocodeURL });",
        "export function find(longitude: number, latitude: number) {",
        "  const point = new Point({ longitude, latitude });",
        "  return geocoder.addressToLocations({ location: point });",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const written = fs.readFileSync(path.join(dir, "places.ts"), "utf8");
    expect(written).toContain("new LocatorCompat({ url: geocodeURL })");
    expect(written).toContain("new PointCompat({ x: longitude, y: latitude })");
    expect(written).toContain("TODO(honua-migrate)[locator]: set locator.provider before calling addressToLocations");
    expect(written).not.toContain('from "esri/');
    expect(codemodResult.manualTodos.map((todo) => todo.reason)).toContain(
      "set locator.provider before calling addressToLocations",
    );
    expect(report.conversion.files.find((file) => file.file === "places.ts")?.boundary).toBe("mixed");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies["@honua/sdk-esri-compat"]).toBe("0.1.11-beta.0");
  });

  it("leaves Locator and a Point passed to it on Esri when the constructor is not only url", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-locator-unsafe-"));
    tempDirs.push(dir);
    const source = [
      'import Point from "esri/geometry/Point";',
      'import Locator from "esri/tasks/Locator";',
      'const geocoder = new Locator({ url: geocodeURL, countryCode: "US" });',
      "export function find(longitude: number, latitude: number) {",
      "  const point = new Point({ longitude, latitude });",
      "  return geocoder.addressToLocations({ location: point });",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "places.ts"), source, "utf8");
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const written = fs.readFileSync(path.join(dir, "places.ts"), "utf8");
    expect(written).toBe(source);
    expect(written).not.toContain("PointCompat");
    expect(written).not.toContain("LocatorCompat");
  });

  it("rewrites rest locator functions onto LocatorCompat and aliases geodesicBuffer to buffer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-rest-locator-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"locator-fn","private":true}\n', "utf8");
    fs.writeFileSync(
      path.join(dir, "geocode.ts"),
      [
        'import { addressToLocations } from "@arcgis/core/rest/locator.js";',
        'import Point from "@arcgis/core/geometry/Point.js";',
        "export function find(url: string, longitude: number, latitude: number) {",
        "  const point = new Point({ longitude, latitude });",
        "  return addressToLocations(url, { location: point, maxLocations: 5 });",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "namespace.ts"),
      [
        'import * as locator from "@arcgis/core/rest/locator.js";',
        "export function reverse(url: string, params: object) {",
        "  return locator.locationToAddress(url, params);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "options.ts"),
      [
        'import { addressToLocations } from "@arcgis/core/rest/locator.js";',
        'import Point from "@arcgis/core/geometry/Point.js";',
        "export function find(url: string, longitude: number, latitude: number, requestOptions: object) {",
        "  const point = new Point({ longitude, latitude });",
        "  return addressToLocations(url, { location: point }, requestOptions);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "buffer.ts"),
      [
        'import { geodesicBuffer } from "@arcgis/core/geometry/geometryEngine.js";',
        'import geometryEngine from "@arcgis/core/geometry/geometryEngine.js";',
        "export function around(geometry: object) {",
        '  return geodesicBuffer(geometry, 10, "meters");',
        "}",
        "export function aroundAgain(geometry: object) {",
        '  return geometryEngine.geodesicBuffer(geometry, 10, "meters");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const geocode = fs.readFileSync(path.join(dir, "geocode.ts"), "utf8");
    expect(geocode).toContain("new LocatorCompat({ url: url }).addressToLocations(");
    expect(geocode).toContain("new PointCompat({ x: longitude, y: latitude })");
    expect(geocode).toContain("TODO(honua-migrate)[locator]: set locator.provider before calling addressToLocations");
    expect(geocode).not.toContain('from "@arcgis/core/rest/locator');
    const namespace = fs.readFileSync(path.join(dir, "namespace.ts"), "utf8");
    expect(namespace).toContain("new LocatorCompat({ url: url }).locationToAddress(params)");
    expect(namespace).not.toContain('from "@arcgis/core/rest/locator');
    const options = fs.readFileSync(path.join(dir, "options.ts"), "utf8");
    expect(options).toContain('import { addressToLocations } from "@arcgis/core/rest/locator.js"');
    expect(options).toContain("new Point({ longitude, latitude })");
    expect(options).not.toContain("LocatorCompat");
    const buffer = fs.readFileSync(path.join(dir, "buffer.ts"), "utf8");
    expect(buffer).toContain('geometryEngineCompat.buffer(geometry, 10, "meters")');
    expect(buffer).toContain('geometryEngine.buffer(geometry, 10, "meters")');
    expect(buffer).not.toContain("geodesicBuffer");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies["@honua/sdk-esri-compat"]).toBe("0.1.11-beta.0");
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
    expect(written).toContain("reactiveUtils.watch(() => locate.viewModel.state, () => {}, { initial: true })");
    expect(written).toContain("new LocateCompat(");
    expect(written).not.toContain("watchUtils");
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
    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const written = fs.readFileSync(path.join(dir, "oauth.ts"), "utf8");
    expect(written).toContain("identityManager.registerOAuthInfos");
    expect(written).toContain("let info: OAuthInfoCompat");
    expect(written).toContain("new OAuthInfoCompat");
    expect(written).toContain("IdentityCredentialCompat");
    expect(written).not.toContain('from "esri/');
    expect(report.unhandledArcGisModules.map((module) => module.modulePath)).not.toContain(
      "@arcgis/core/identity/Credential",
    );
    expect(report.conversion.files.find((file) => file.file === "oauth.ts")?.boundary).toBe("converted");
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
    expect(treesPage).toContain('const honuaMap = new MapCompat({ basemap: "hybrid" });');
    expect(treesPage).toContain("honuaMap.add(featureLayer)");
    expect(treesPage).toContain("xmin: __honuaGoToTarget.xmin");
    expect(treesPage).not.toContain("honuaView.goTo(featureLayer.fullExtent");
    expect(treesPage).toContain("FeatureLayerCompat");
    expect(treesPage).toContain("honuaView.constraints");
    expect(treesPage).not.toContain("viewElement.constraints");
    expect(treesPage).not.toContain('src="%CDN%"');
    expect(treesPage).not.toContain("registerHonuaWidgetKit");

    expect(counties.report.conversion.recommendedMode).toBe("complete-honua-conversion");
    const countyModules = counties.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(countyModules).not.toContain("@arcgis/core/layers/FeatureLayer.js");
    expect(countyModules).not.toContain("@arcgis/core/Map.js");
    expect(countyModules).not.toContain("@arcgis/core/geometry/operators/centroidOperator.js");
    const countyPage = writtenPage("featurelayer-query");
    expect(countyPage).toContain("geometryEngineCompat.centroid");
    expect(countyPage).toContain("honuaView.map = map");
    expect(countyPage).not.toContain("honuaMap = map");

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
      'const honuaMap = new WebMapCompat({ portalItem: { id: "00113543095f45e78e521e316dc447dd" } });',
    );
    expect(relatedPage).toContain(
      'const honuaView = new MapViewCompat({ container: document.getElementById("honua-map"), map: honuaMap });',
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

  it("typechecks the rewritten intro-featurelayer script against the installed compat package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-intro-types-"));
    tempDirs.push(dir);
    fs.cpSync(path.join(CORPUS, "intro-featurelayer"), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"intro-featurelayer","private":true}\n');
    const codemodResult = runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies["@honua/sdk-esri-compat"]).toBe("0.1.11-beta.0");
    expect(codemodResult.errors).toBeUndefined();
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toContain("honuaMap.add(featureLayer)");
    expect(script).toContain("xmin: __honuaGoToTarget.xmin");
    expect(script).not.toContain("honuaView.goTo(featureLayer.fullExtent");
    fs.writeFileSync(path.join(dir, "main.ts"), `${script?.trim()}\n`);
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: "es2022",
            moduleResolution: "bundler",
            moduleDetection: "force",
            target: "es2022",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            lib: ["ES2022", "DOM"],
            types: [],
          },
          files: ["main.ts"],
        },
        null,
        2,
      )}\n`,
    );
    fs.symlinkSync(path.resolve(import.meta.dirname, "../../node_modules"), path.join(dir, "node_modules"));
    const tsc = spawnSync(
      path.resolve(import.meta.dirname, "../../node_modules/typescript/bin/tsc"),
      ["-p", "tsconfig.json", "--pretty", "false", "--noEmit"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(tsc.status, `${tsc.stdout}\n${tsc.stderr}`).toBe(0);
  });

  it("rewrites the popup shell and geodetic length, and leaves smart-mapping statistics held", () => {
    const popup = migrate("popup-actions");
    const popupModules = popup.report.unhandledArcGisModules.map((module) => module.modulePath);
    expect(popupModules).not.toContain("@arcgis/core/geometry/operators/geodeticLengthOperator.js");
    expect(popup.report.conversion.recommendedMode).not.toBe("keep-esri-client");
    const popupPage = writtenPage("popup-actions");
    expect(popupPage).toContain("honuaView.map = new Map(");
    expect(popupPage).not.toContain("honuaMap = new Map(");
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

  it("constructs the compat view from the module that queries arcgis-map", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-shell-host-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(
      path.join(dir, "index.html"),
      [
        "<!doctype html>",
        '<arcgis-map item-id="abc123def456abc123def456abc12345"></arcgis-map>',
        "<arcgis-chart></arcgis-chart>",
        '<script type="module" src="/src/main.ts"></script>',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "src", "main.ts"),
      [
        'import Point from "@arcgis/core/geometry/Point.js";',
        'import type WebMap from "@arcgis/core/WebMap.js";',
        'const viewElement = document.querySelector("arcgis-map");',
        "export const point = new Point({ x: 1, y: 2 });",
        "export const map = viewElement;",
        "export type MapType = WebMap;",
        "",
      ].join("\n"),
      "utf8",
    );
    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    const main = fs.readFileSync(path.join(dir, "src", "main.ts"), "utf8");
    expect(html).toContain('data-honua-compat="MapViewCompat"');
    expect(html).not.toContain("<arcgis-map");
    expect(html).toContain("<arcgis-chart");
    expect(main).toContain("new MapViewCompat(");
    expect(main).toContain('portalItem: { id: "abc123def456abc123def456abc12345" }');
    expect(main).toContain("const viewElement = honuaView");
    expect(main).toContain("import type WebMap");
    const mainFile = report.conversion.files.find((file) => file.file === "src/main.ts");
    expect(mainFile?.boundary).toBe("converted");
    expect(report.unhandledArcGisModules.map((module) => module.modulePath)).toContain(
      "@arcgis/map-components/arcgis-chart",
    );
  });

  it("does not turn map tags into empty divs when no module queries arcgis-map", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-shell-skip-"));
    tempDirs.push(dir);
    const html = [
      "<!doctype html>",
      "<arcgis-map></arcgis-map>",
      '<script type="module" src="/src/main.ts"></script>',
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "main.ts"), "export const ready = true;\n", "utf8");
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf8")).toContain("<arcgis-map");
  });

  it("rewrites a supported AMD module and leaves an unsupported one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-amd-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "page.js"),
      [
        'require(["esri/Map", "esri/widgets/Sketch/SketchViewModel"], function (Map, SketchViewModel) {',
        '  const map = new Map({ basemap: "streets-vector" });',
        "  const model = new SketchViewModel({ view: map });",
        "  return { map, model };",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const written = fs.readFileSync(path.join(dir, "page.js"), "utf8");
    expect(written).toContain("new MapCompat(");
    expect(written).toContain("SketchViewModel");
    expect(written).not.toContain('"esri/Map"');
    expect(written).toContain("MapCompat");
  });

  it("sees import-equals requires and rewrites a covered geometry call", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-import-equals-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "main.ts"),
      [
        'import EsriMap = require("esri/Map");',
        'import geometryEngine = require("esri/geometry/geometryEngine");',
        "export function build(geometry: object) {",
        '  const map = new EsriMap({ basemap: "streets-vector" });',
        '  return { map, area: geometryEngine.geodesicBuffer(geometry, 10, "meters") };',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const written = fs.readFileSync(path.join(dir, "main.ts"), "utf8");
    expect(scanReport.imports.map((hit) => hit.modulePath)).toEqual(
      expect.arrayContaining(["@arcgis/core/Map", "@arcgis/core/geometry/geometryEngine"]),
    );
    expect(report.conversion.files.map((file) => file.file)).toContain("main.ts");
    expect(written).toContain("new MapCompat(");
    expect(written).toContain('geometryEngineCompat.buffer(geometry, 10, "meters")');
  });

  it("rewrites bufferOperator.execute onto geometryEngineCompat.buffer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-buffer-op-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "worker.js"),
      [
        'import * as bufferOperator from "@arcgis/core/geometry/operators/bufferOperator.js";',
        'import * as generalizeOperator from "@arcgis/core/geometry/operators/generalizeOperator.js";',
        "export function run(line) {",
        '  const buffered = bufferOperator.execute(line, 200, { unit: "meters" });',
        '  return generalizeOperator.execute(buffered, 10, { unit: "meters" });',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const written = fs.readFileSync(path.join(dir, "worker.js"), "utf8");
    expect(written).toContain('geometryEngineCompat.buffer(line, 200, "meters")');
    expect(written).toContain("generalizeOperator.execute");
    expect(report.manualTodos.map((todo) => todo.reason)).toContain(
      "generalizeOperator is not covered by geometryEngineCompat",
    );
  });

  it("rewrites Portal search and a client-side FeatureLayer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-portal-source-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "portal.ts"),
      [
        'import Portal from "@arcgis/core/portal/Portal.js";',
        "export async function find(url: string) {",
        "  const portal = new Portal({ url });",
        '  return portal.search({ q: "roads" });',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "layer.ts"),
      [
        'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";',
        "export function points(graphics: object[]) {",
        "  return new FeatureLayer({",
        "    source: graphics,",
        '    objectIdField: "ObjectID",',
        '    geometryType: "point",',
        '    fields: [{ name: "ObjectID", type: "oid" }],',
        "  });",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    expect(fs.readFileSync(path.join(dir, "portal.ts"), "utf8")).toContain("new PortalCompat({ portalUrl: url })");
    expect(fs.readFileSync(path.join(dir, "layer.ts"), "utf8")).toContain("new FeatureLayerCompat({");
  });

  it("leaves a Graphic on Esri when it receives a symbol that stays on Esri", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-graphic-symbol-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "draw.ts"),
      [
        'import Graphic from "@arcgis/core/Graphic.js";',
        'import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";',
        'import * as symbolUtils from "@arcgis/core/symbols/support/symbolUtils.js";',
        "export function draw(node: HTMLElement) {",
        '  const symbol = new SimpleMarkerSymbol({ color: "red" });',
        "  symbolUtils.renderPreviewHTML(symbol, { node });",
        "  return new Graphic({ geometry: { x: 1, y: 2 }, symbol });",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    runEsriCompatCodemod({ rootDir: dir, write: true, target: "honua-compat" });
    const written = fs.readFileSync(path.join(dir, "draw.ts"), "utf8");
    expect(written).toContain("new Graphic(");
    expect(written).toContain("new SimpleMarkerSymbol(");
    expect(written).not.toContain("GraphicCompat");
  });

  it("rewrites the four loader shapes in the checked-in fixture", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honua-loader-shapes-"));
    tempDirs.push(dir);
    fs.cpSync(path.join(import.meta.dirname, "fixtures", "esri-loader-shapes-app"), dir, { recursive: true });
    const scanReport = scanArcGisUsage(dir);
    const codemodResult = runEsriCompatCodemod({
      rootDir: dir,
      write: true,
      target: "honua-compat",
    });
    const report = buildJsMigrationReport(dir, codemodResult, scanReport);
    const amd = fs.readFileSync(path.join(dir, "amd.html"), "utf8");
    const equalsFile = fs.readFileSync(path.join(dir, "import-equals.ts"), "utf8");
    const worker = fs.readFileSync(path.join(dir, "worker.js"), "utf8");
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    const main = fs.readFileSync(path.join(dir, "src", "main.ts"), "utf8");

    expect(amd).toContain("new MapCompat(");
    expect(amd).toContain("new FeatureLayerCompat(");
    expect(amd).toContain("SketchViewModel");
    expect(amd).not.toContain('"esri/Map"');
    expect(amd).not.toContain('"esri/layers/FeatureLayer"');
    expect(equalsFile).toContain("new MapCompat(");
    expect(equalsFile).toContain('geometryEngineCompat.buffer(geometry, 10, "meters")');
    expect(worker).toContain('geometryEngineCompat.buffer(line, 200, "meters")');
    expect(worker).toContain("generalizeOperator.execute");
    expect(worker).toContain("query.executeQueryJSON");
    expect(html).not.toContain("<arcgis-map");
    expect(main).toContain("new MapViewCompat(");
    expect(report.conversion.files.map((file) => file.file)).toEqual(
      expect.arrayContaining(["amd.html", "import-equals.ts", "worker.js", "index.html"]),
    );
    expect(report.manualTodos.map((todo) => todo.reason)).toContain(
      "generalizeOperator is not covered by geometryEngineCompat",
    );
    expect(report.unhandledArcGisModules.map((module) => module.modulePath)).toContain("@arcgis/core/rest/query.js");
    expect(report.conversion.recommendedMode).toBe("assisted-conversion");
  });
});
