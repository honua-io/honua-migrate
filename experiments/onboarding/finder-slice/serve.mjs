import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
// Local workspace experiment only. No credentials enter the browser bundle.
const sdk = resolve(process.env.HONUA_EXPERIMENT_SDK_DIR ?? "");
if (!process.env.HONUA_EXPERIMENT_SDK_DIR) throw new Error("Set HONUA_EXPERIMENT_SDK_DIR to the built SDK worktree");
const root = fileURLToPath(new URL(".", import.meta.url));
const env = Object.fromEntries(readFileSync(new URL("../.local/stack.env", import.meta.url), "utf8").split(/\r?\n/).filter(x => x.includes("=")).map(x => { const i=x.indexOf("="); return [x.slice(0,i),x.slice(i+1)]; }));
const { createServer } = await import(pathToFileURL(resolve(sdk,"node_modules/vite/dist/node/index.js")));
const server = await createServer({ root, configFile: false,
  plugins: [{ name: "read-only-experiment-proxy", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.startsWith("/rest/") && !["GET", "HEAD"].includes(request.method ?? "")) {
        response.statusCode = 405; response.end("This experiment proxy is read-only"); return;
      }
      next();
    });
  } }],
  resolve: { alias: [
    { find: "@honua/sdk-js/map", replacement: resolve(sdk,"dist/src/map/index.js") },
    { find: "@honua/sdk-js", replacement: resolve(sdk,"dist/src/index.js") },
    { find: "maplibre-gl", replacement: resolve(sdk,"node_modules/maplibre-gl") },
  ] },
  server: { host: "127.0.0.1", port: 18614, strictPort: true, fs: { allow: [root,sdk] }, proxy: {
    "/rest/services/onboarding-venue-001/FeatureServer": { target: "http://127.0.0.1:18613", headers: { "X-API-Key": env.ONBOARDING_ADMIN_PASSWORD } },
  } },
});
await server.listen(); console.log("Finder slice: http://127.0.0.1:18614 (local workspace SDK, incomplete conversion)");
