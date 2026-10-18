// Harness controls only: the HTTP service below is deliberately synthetic.
// They prove false-success detection in a real browser, not live import fidelity.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { baselineDigest, sha256, validateInputs, verifyImportedApp } from "../scripts/verify-imported-app.mjs";

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
const row = (id, name) => ({ attributes: { OBJECTID: id, NAME: name }, geometry: { x: id, y: 20 } });
const features = [row(11, "Alpha"), row(12, "Beta")];
const payload = (rows) => ({ features: rows, spatialReference: { wkid: 4326 }, exceededTransferLimit: false });
const sha = "a".repeat(40);
const serverIdentity = { sourceSha: sha, image: `ghcr.io/honua-io/honua-server@sha256:${"b".repeat(64)}` };

function inputs(origin) {
  const receipt = { schema: "honua.dotnet-import-fidelity-receipt/v1", postgis: true, sdkSeamMocks: false,
    server: serverIdentity, provenance: { imports: [{ serviceCase: "esri_usa_cities", jobId: "owned-test-import",
      sourceCount: 2, postgisCount: 2, sourceSnapshotSha256: "c".repeat(64),
      targetServiceUrl: `${origin}/rest/services/imported-run-123/FeatureServer`, targetLayerId: 7 }] },
    cells: ["all_fields_diff", "core_query_parity", "geometry_parity"].map((name) => ({
      id: `esri_usa_cities/${name}`, verdict: "pass", executed: true, sourceBuilt: false, stale: false })) };
  const manifest = { schema: "honua.imported-app-browser-input/v1", appId: "harness-control-only",
    originalSourceSha: sha, importReceiptDigest: sha256(JSON.stringify(receipt)), server: serverIdentity,
    serviceCase: "esri_usa_cities", appUrl: `${origin}/`, timeoutMs: 1500,
    steps: [
      { id: "load", actions: [], assertions: [{ selector: "#rows", text: "Alpha,Beta" }],
        queries: [{ parameters: { where: "1=1" }, expected: payload(features) }] },
      { id: "filter", actions: [{ type: "click", selector: "#filter" }], assertions: [{ selector: "#rows", text: "Beta" }],
        queries: [{ parameters: { where: "OBJECTID=12" }, expected: payload([features[1]]) }] },
    ] };
  manifest.baselineDigest = baselineDigest(manifest);
  return { manifest, receipt };
}

async function exercise(mode) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push(url.pathname);
    if (url.pathname.endsWith("/query")) {
      let rows = url.searchParams.get("where") === "1=1" ? features : [features[1]];
      if (mode === "lost-attribute") rows = rows.map((item) => ({ ...item, attributes: { OBJECTID: item.attributes.OBJECTID } }));
      if (mode === "wrong-geometry") rows = rows.map((item) => ({ ...item, geometry: { x: 99, y: 99 } }));
      if (mode === "extra-record") rows = [...rows, row(13, "Undeclared")];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(mode === "error-envelope" ? { ...payload(rows), error: { code: 500 } } : payload(rows)));
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html><div id="rows"></div><button id="filter">Filter</button><script>
        async function load(where) {
          ${mode === "no-query" ? "" : `await fetch('${mode === "backend-fallback" ? "https://undeclared.invalid/FeatureServer/0" : "/rest/services/imported-run-123/FeatureServer/7"}/query?where=' + encodeURIComponent(where)).then(r => r.json()).catch(() => {});`}
          // A lying UI is intentional: independently observed data must reject it.
          document.querySelector('#rows').textContent = ${mode === "wrong-ui" ? "'Incorrect'" : "where === '1=1' ? 'Alpha,Beta' : 'Beta'"};
        }
        document.querySelector('#filter').onclick = () => load('OBJECTID=12');
        ${mode === "arcgis-runtime" ? "const s=document.createElement('script');s.src='/@arcgis/core.js';document.head.append(s);" : ""}
        load('1=1');
      </script>`);
      return;
    }
    response.writeHead(404).end();
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const data = inputs(`http://127.0.0.1:${server.address().port}`);
    return { report: await verifyImportedApp({ ...data, browser }), requests };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("real browser proves app-issued exact imported-layer reads plus visible load/filter behavior", async () => {
  const { report, requests } = await exercise("positive");
  assert.equal(report.result, "pass");
  assert.equal(report.qualification, false);
  assert.deepEqual(report.steps.map(({ result }) => result), ["pass", "pass"]);
  assert.deepEqual(report.steps.map(({ queries }) => queries[0].rows), [2, 1]);
  assert.equal(requests.filter((value) => value.endsWith("/query")).length, 2);
  assert.equal(report.networkViolationCount, 0);
});

for (const mode of ["no-query", "lost-attribute", "wrong-geometry", "extra-record", "error-envelope", "wrong-ui", "backend-fallback", "arcgis-runtime"]) {
  test(`real browser refuses ${mode}, including a UI that pretends the query succeeded`, async () => {
    const { report } = await exercise(mode);
    assert.equal(report.result, "fail");
    assert.equal(report.steps[0].result, "fail");
    assert.equal(report.steps[1].result, "not-run");
    assert.equal(report.qualification, false);
    assert.equal(JSON.stringify(report).includes("undeclared.invalid"), false);
  });
}

for (const [name, change] of [
  ["different server", ({ receipt }) => { receipt.server = { ...serverIdentity, sourceSha: "d".repeat(40) }; }],
  ["ambiguous mapping", ({ receipt }) => { receipt.provenance.imports.push(receipt.provenance.imports[0]); }],
  ["unexecuted import", ({ receipt }) => { receipt.cells[0].executed = false; }],
  ["lost imported rows", ({ receipt }) => { receipt.provenance.imports[0].postgisCount = 1; }],
  ["changed baseline", ({ manifest }) => { manifest.steps[0].assertions[0].text = "Different"; }],
  ["credential in manifest", ({ manifest }) => { manifest.token = "do-not-print"; }],
  ["empty behavior scope", ({ manifest }) => { manifest.steps = []; }],
]) {
  test(`refuses ${name} before opening the browser`, () => {
    const data = inputs("http://127.0.0.1:12345");
    change(data);
    assert.throws(() => validateInputs(data.manifest, data.receipt));
  });
}
