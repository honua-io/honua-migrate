// Browser evidence for an already built, migrated app against an imported service.
// This observes the app's own requests. It never supplies rows, rewrites URLs,
// imports data, or turns a browser result into a release certification verdict.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "playwright-core";

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const require = (condition, code) => { if (!condition) throw new Error(code); };
const digest = (value) => /^sha256:[a-f0-9]{64}$/.test(value ?? "");
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const canonical = (value) => JSON.stringify(value, (_key, item) => item && !Array.isArray(item)
  && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const baselineDigest = ({ appId, originalSourceSha, steps }) => sha256(canonical({ appId, originalSourceSha, steps }));

function safeUrl(value) {
  const url = new URL(value);
  require(["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    && !url.search && !url.hash, "unsafe-url");
  require(url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "insecure-remote-url");
  return url;
}

function publicJson(value) {
  // Inputs and retained output must not be a credential transport. Authentication
  // is configured on the app by its existing operator workflow, not this file.
  const text = JSON.stringify(value);
  require(!/"[^"\\]*(?:password|secret|token|authorization|credential|api[_-]?key)[^"\\]*"\s*:/i.test(text), "credential-field");
}

export function validateInputs(manifest, receipt) {
  publicJson(manifest);
  require(manifest?.schema === "honua.imported-app-browser-input/v1", "manifest-schema");
  require(nonempty(manifest.appId) && /^[a-f0-9]{40}$/.test(manifest.originalSourceSha ?? "")
    && digest(manifest.baselineDigest) && digest(manifest.importReceiptDigest), "manifest-identity");
  safeUrl(manifest.appUrl);
  require(receipt?.schema === "honua.dotnet-import-fidelity-receipt/v1" && receipt.postgis === true
    && receipt.sdkSeamMocks === false, "import-producer");
  require(isDeepStrictEqual(receipt.server, manifest.server)
    && /^[a-f0-9]{40}$/.test(receipt.server?.sourceSha ?? "")
    && /@sha256:[a-f0-9]{64}$/.test(receipt.server?.image ?? ""), "server-binding");
  const imports = receipt.provenance?.imports?.filter((item) => item.serviceCase === manifest.serviceCase);
  require(imports?.length === 1, "import-mapping");
  const imported = imports[0];
  require(nonempty(imported.jobId) && Number.isSafeInteger(imported.targetLayerId) && imported.targetLayerId >= 0
    && Number.isSafeInteger(imported.sourceCount) && imported.sourceCount > 0
    && imported.postgisCount === imported.sourceCount
    && /^[a-f0-9]{64}$/.test(imported.sourceSnapshotSha256 ?? ""), "import-provenance");
  // These are existing producer cell IDs, not caller-authored pass booleans.
  // Other import/candidate cells remain the existing release consumer's concern.
  for (const name of ["all_fields_diff", "core_query_parity", "geometry_parity"]) {
    const cells = receipt.cells?.filter((cell) => cell.id === `${manifest.serviceCase}/${name}`);
    require(cells?.length === 1 && cells[0].verdict === "pass" && cells[0].executed === true
      && cells[0].sourceBuilt === false && cells[0].stale === false, "import-parity");
  }
  const service = safeUrl(imported.targetServiceUrl);
  require(/\/FeatureServer$/.test(service.pathname), "target-service");
  const layer = `${service.href}/${imported.targetLayerId}`;
  require(Array.isArray(manifest.steps) && manifest.steps.length > 0 && manifest.steps.length <= 50, "empty-behavior-scope");
  require(new Set(manifest.steps.map((step) => step.id)).size === manifest.steps.length, "duplicate-step");
  require(manifest.baselineDigest === baselineDigest(manifest), "baseline-binding");
  for (const step of manifest.steps) {
    require(nonempty(step.id) && Array.isArray(step.assertions) && step.assertions.length > 0, "missing-dom-oracle");
    for (const assertion of step.assertions) require(nonempty(assertion.selector) && typeof assertion.text === "string", "dom-oracle");
    require(Array.isArray(step.actions) && step.actions.every((action) => nonempty(action.selector)
      && ["click", "fill", "selectOption"].includes(action.type)
      && (action.type === "click" || typeof action.value === "string")), "browser-actions");
    require(Array.isArray(step.queries) && step.queries.length > 0, "missing-live-query-oracle");
    for (const query of step.queries) {
      require(query.parameters && typeof query.parameters === "object" && !Array.isArray(query.parameters)
        && Object.keys(query.parameters).length > 0 && Object.values(query.parameters).every((item) => typeof item === "string"), "query-parameters");
      require(query.expected && Array.isArray(query.expected.features)
        && !Object.hasOwn(query.expected, "error") && typeof query.expected.exceededTransferLimit === "boolean", "query-oracle");
      for (const feature of query.expected.features) require(feature.attributes && Object.hasOwn(feature, "geometry"), "feature-oracle");
    }
  }
  require(Number.isInteger(manifest.timeoutMs) && manifest.timeoutMs >= 100 && manifest.timeoutMs <= 30_000, "browser-budget");
  return { layer, imported };
}

function queryMatches(request, query, layer) {
  const url = new URL(request.url());
  if (`${url.origin}${url.pathname}` !== `${layer}/query` || !["GET", "POST"].includes(request.method())) return false;
  const parameters = request.method() === "POST" ? new URLSearchParams(request.postData() ?? "") : url.searchParams;
  return Object.entries(query.parameters).every(([key, value]) => parameters.getAll(key).length === 1 && parameters.get(key) === value);
}

async function verifyResponse(response, expected) {
  require(response.status() === 200 && /application\/(?:[\w.+-]*\+)?json/i.test(response.headers()["content-type"] ?? ""), "query-http");
  const bytes = await response.body();
  require(bytes.length <= 8 * 1024 * 1024, "query-size");
  const body = JSON.parse(bytes.toString());
  require(!Object.hasOwn(body, "error") && Array.isArray(body.features), "query-error");
  const actual = Object.fromEntries(Object.keys(expected).map((key) => [key, body[key]]));
  // Preserve all declared attributes/geometry, duplicate rows and multiplicity;
  // only record order is irrelevant unless a separate UI assertion requires it.
  const sorted = (rows) => [...rows].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  actual.features = sorted(actual.features);
  require(isDeepStrictEqual(actual, { ...expected, features: sorted(expected.features) }), "query-data-mismatch");
  return { status: response.status(), rows: body.features.length, bodyDigest: sha256(bytes) };
}

export async function verifyImportedApp({ manifest, receipt, browser }) {
  const { layer, imported } = validateInputs(manifest, receipt);
  const app = safeUrl(manifest.appUrl);
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(manifest.timeoutMs);
  const violations = [];
  const failures = [];
  let activeStep = -1;
  const captured = manifest.steps.map(() => []);
  const requests = new Map();
  const report = { schema: "honua.imported-app-browser-observation/v1", appId: manifest.appId,
    qualification: false, scope: "browser-behavior-only", originalSourceSha: manifest.originalSourceSha,
    baselineDigest: manifest.baselineDigest, importReceiptDigest: manifest.importReceiptDigest,
    server: manifest.server, serviceCase: manifest.serviceCase, jobId: imported.jobId,
    sourceSnapshotDigest: `sha256:${imported.sourceSnapshotSha256}`, browserVersion: browser.version(),
    startedAt: new Date().toISOString(), result: "fail", steps: manifest.steps.map(({ id }) => ({ id, result: "not-run" })) };
  try {
    // No response fulfillment or URL substitution: the migrated app must already
    // be configured to use the exact fresh imported endpoint from the producer.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = `${url.origin}${url.pathname}`;
      const runtime = /(?:@arcgis|js\.arcgis\.com|arcgis\/core)/i.test(request.url());
      const target = endpoint === layer || endpoint === `${layer}/query`;
      const staticApp = url.origin === app.origin && ["document", "script", "stylesheet", "image", "font", "manifest"].includes(request.resourceType())
        && !/\/(?:FeatureServer|MapServer)(?:\/|$)/i.test(url.pathname);
      if (runtime || (!target && !staticApp) || !["GET", "HEAD", "POST"].includes(request.method())
        || (request.method() === "POST" && endpoint !== `${layer}/query`)) {
        violations.push("undeclared-network-request");
        await route.abort();
      } else await route.continue();
    });
    page.on("websocket", () => violations.push("undeclared-websocket"));
    page.on("pageerror", () => violations.push("browser-error"));
    page.on("console", (message) => { if (message.type() === "error") violations.push("browser-console-error"); });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (`${url.origin}${url.pathname}` !== `${layer}/query`) return;
      if (activeStep < 0) { violations.push("query-outside-step"); return; }
      const entry = { request, finished: false, failed: false };
      requests.set(request, entry);
      captured[activeStep].push(entry);
    });
    page.on("response", (response) => {
      const entry = requests.get(response.request());
      if (entry) entry.response = response;
    });
    page.on("requestfinished", (request) => { const entry = requests.get(request); if (entry) entry.finished = true; });
    page.on("requestfailed", (request) => {
      const entry = requests.get(request);
      if (entry) { entry.failed = true; violations.push("query-failed"); }
    });
    for (const [index, step] of manifest.steps.entries()) {
      activeStep = index;
      const observation = report.steps[index];
      observation.result = "fail";
      try {
        if (index === 0) await page.goto(app.href, { waitUntil: "load", timeout: manifest.timeoutMs });
        for (const action of step.actions) {
          const locator = page.locator(action.selector);
          if (action.type === "click") await locator.click();
          else if (action.type === "fill") await locator.fill(action.value);
          else await locator.selectOption(action.value);
        }
        for (const assertion of step.assertions) {
          await page.locator(assertion.selector).waitFor({ state: "visible" });
          await page.waitForFunction(({ selector, text }) => {
            const elements = document.querySelectorAll(selector);
            return elements.length === 1 && elements[0].textContent === text;
          }, assertion, { timeout: manifest.timeoutMs });
        }
        const deadline = performance.now() + manifest.timeoutMs;
        while (!step.queries.every((query) => captured[index].some((entry) => queryMatches(entry.request, query, layer)))
          || captured[index].some((entry) => !entry.finished)) {
          require(!captured[index].some((entry) => entry.failed), "app-query-failed");
          require(performance.now() < deadline, "missing-app-query");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const used = new Set();
        observation.queries = [];
        for (const query of step.queries) {
          const matches = captured[index].filter((entry) => queryMatches(entry.request, query, layer));
          require(matches.length === 1 && !used.has(matches[0]), "ambiguous-app-query");
          used.add(matches[0]);
          observation.queries.push(await verifyResponse(matches[0].response, query.expected));
        }
        require(captured[index].length === used.size && captured[index].every((entry) => entry.finished && !entry.failed), "unaccounted-app-query");
        require(violations.length === 0, "browser-network-or-runtime-failure");
        observation.result = "pass";
      } catch {
        // Diagnostics intentionally contain no raw exception/DOM/HTTP text.
        observation.reason = "browser-step-failed";
        failures.push(step.id);
        break;
      }
    }
    // Close the owned context before deciding success; no listener outlives the
    // observation. This does not claim absence of errors after the tested flow.
  } finally { await context.close(); }
  for (const [index, entries] of captured.entries()) {
    const step = report.steps[index];
    if (step.result === "pass" && (entries.length !== step.queries.length
      || entries.some((entry) => !entry.finished || entry.failed))) {
      step.result = "fail";
      step.reason = "unaccounted-app-query";
    }
  }
  report.completedAt = new Date().toISOString();
  report.networkViolationCount = violations.length;
  report.result = failures.length === 0 && violations.length === 0 && report.steps.every((step) => step.result === "pass") ? "pass" : "fail";
  return report;
}

export async function runFiles(manifestPath, receiptPath, expectedManifestDigest, outputPath) {
  const manifestBytes = await readFile(manifestPath);
  require(digest(expectedManifestDigest) && sha256(manifestBytes) === expectedManifestDigest, "unreviewed-browser-manifest");
  const manifest = JSON.parse(manifestBytes);
  const receiptBytes = await readFile(receiptPath);
  require(sha256(receiptBytes) === manifest.importReceiptDigest, "import-receipt-digest");
  const receipt = JSON.parse(receiptBytes);
  validateInputs(manifest, receipt);
  const browser = await chromium.launch();
  try {
    const report = await verifyImportedApp({ manifest, receipt, browser });
    report.manifestDigest = expectedManifestDigest;
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    return report.result === "pass" ? 0 : 1;
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    require(process.argv.length === 6, "usage: verify-imported-app.mjs MANIFEST IMPORT_RECEIPT MANIFEST_SHA256 OUTPUT");
    process.exitCode = await runFiles(...process.argv.slice(2));
  } catch {
    process.stderr.write("Imported-app browser verification refused or failed; no qualification was produced.\n");
    process.exitCode = 1;
  }
}
