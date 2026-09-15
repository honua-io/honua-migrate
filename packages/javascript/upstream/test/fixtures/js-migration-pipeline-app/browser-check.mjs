// Browser validation for the built app: serve dist/ next to a fixture
// FeatureServer, load the page in headless Chromium, and check what it shows.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { chromium } from "playwright-core";

const distDir = path.resolve("dist");
const TRAILS = [
  { OBJECTID: 1, NAME: "Backbone Trail", DIFFICULTY: "easy" },
  { OBJECTID: 2, NAME: "Sandstone Peak", DIFFICULTY: "hard" },
  { OBJECTID: 3, NAME: "Mishe Mokwa", DIFFICULTY: "easy" },
];
const LAYER_PATH = "/rest/services/trails/FeatureServer/0";
const requests = [];

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  requests.push(`${request.method} ${url.pathname}${url.search}`);
  if (url.pathname === LAYER_PATH) {
    return sendJson(response, {
      id: 0,
      name: "trails",
      type: "Feature Layer",
      geometryType: "esriGeometryPoint",
      objectIdField: "OBJECTID",
      fields: [
        { name: "OBJECTID", type: "esriFieldTypeOID" },
        { name: "NAME", type: "esriFieldTypeString" },
        { name: "DIFFICULTY", type: "esriFieldTypeString" },
      ],
    });
  }
  if (url.pathname === `${LAYER_PATH}/query`) {
    const where = url.searchParams.get("where") ?? "1=1";
    const match = /^DIFFICULTY = '([a-z]+)'$/.exec(where);
    const rows = where === "1=1" ? TRAILS : match ? TRAILS.filter((row) => row.DIFFICULTY === match[1]) : null;
    if (!rows) {
      return sendJson(response, { error: { code: 400, message: `unsupported where: ${where}` } }, 400);
    }
    return sendJson(response, {
      objectIdFieldName: "OBJECTID",
      geometryType: "esriGeometryPoint",
      spatialReference: { wkid: 4326 },
      fields: [{ name: "NAME", type: "esriFieldTypeString" }],
      features: rows.map((row) => ({ attributes: { OBJECTID: row.OBJECTID, NAME: row.NAME }, geometry: { x: -118.8, y: 34.03 } })),
    });
  }
  const file = path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(distDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
  response.writeHead(200, { "content-type": type }).end(fs.readFileSync(file));
});

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const browserRequests = [];
  const pageErrors = [];
  page.on("request", (request) => browserRequests.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/`);
  await page.waitForFunction(
    () => {
      const status = document.getElementById("status");
      return status?.dataset.count !== undefined || status?.dataset.error !== undefined;
    },
    undefined,
    { timeout: 15_000 },
  );
  const observed = await page.evaluate(() => {
    const status = document.getElementById("status");
    return { ...status.dataset, text: status.textContent };
  });
  const offOrigin = browserRequests.filter((url) => !url.startsWith(origin));
  const result = { observed, pageErrors, offOrigin, requests };
  fs.writeFileSync(path.join(distDir, "browser-observations.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  const passed =
    observed.count === "2" &&
    observed.text === "Backbone Trail, Mishe Mokwa" &&
    observed.error === undefined &&
    pageErrors.length === 0 &&
    offOrigin.length === 0;
  process.exitCode = passed ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
