import { connect } from "@honua/sdk-js";
import { mountSource } from "@honua/sdk-js/map";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";


// Native slice of finder-sample's query/list/filter/goTo workflow. Not full UI parity.
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const search = document.querySelector<HTMLInputElement>("#search")!;
const cluster = document.querySelector<HTMLSelectElement>("#cluster")!;
const results = document.querySelector<HTMLDivElement>("#results")!;
const detail = document.querySelector<HTMLParagraphElement>("#detail")!;
const map = new maplibregl.Map({
  container: "map", center: [-118.1, 34], zoom: 8,
  style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#dce6e2" } }] },
});
try {
  await map.once("load");
  const dataset = await connect({
    endpoint: `${location.origin}/rest/services/onboarding-venue-001/FeatureServer/1`,
    protocol: "auto", authorizationScopeFingerprint: "local-onboarding-experiment",
  });
  const source = dataset.source();
  if (!source) throw new Error("Imported venue source was not discovered");
  const result = await source.queryAll({ outFields: ["*"], returnGeometry: true, outSr: 4326 });
  const features = result.features;
  const mounted = await mountSource(map, source, {
    strategy: "geojson", fitBounds: true, query: { outFields: ["*"] },
    layers: [{ id: "venues", type: "circle", paint: { "circle-radius": 7, "circle-color": "#13795b", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } }],
  });
  console.info("finder canonical geometry", JSON.stringify(features[0]?.geometry));
  console.info("finder mount diagnostics", JSON.stringify(mounted.diagnostics));
  map.on("idle", () => console.info("finder render", JSON.stringify({ center: map.getCenter(), rendered: map.queryRenderedFeatures({ layers: [...mounted.layerIds] }).length })));
  // Import currently normalizes field names. Bind explicitly rather than assuming ArcGIS casing.
  const attributes = (feature: (typeof features)[number]) => feature.attributes;
  for (const name of [...new Set(features.map(f => String(attributes(f).cluster)))].sort()) {
    const option = document.createElement("option"); option.value = name; option.textContent = name; cluster.append(option);
  }
  function render() {
    const matches = features.filter(f => String(attributes(f).venue).toLowerCase().includes(search.value.toLowerCase()) && (!cluster.value || attributes(f).cluster === cluster.value));
    results.replaceChildren();
    const ids = matches.map(f => attributes(f).objectid);
    for (const id of mounted.layerIds) map.setFilter(id, ["in", ["get", "objectid"], ["literal", ids]]);
    status.textContent = `${matches.length} of ${features.length} imported venues`;
    for (const feature of matches) {
      const a = attributes(feature); const button = document.createElement("button"); button.textContent = String(a.venue);
      button.onclick = () => {
        detail.textContent = `${a.venue} ? ${a.sports}`;
        const geometry = feature.geometry as { x: number; y: number };
        map.flyTo({ center: [geometry.x, geometry.y], zoom: 14, duration: 0 });
        for (const id of mounted.layerIds) map.setPaintProperty(id, "circle-color", ["case", ["==", ["get", "objectid"], Number(a.objectid)], "#b44524", "#13795b"]);
      };
      results.append(button);
    }
  }
  search.oninput = render; cluster.onchange = render; render();
  window.addEventListener("pagehide", () => { mounted.dispose(); map.remove(); }, { once: true });
} catch (error) { status.textContent = `Conversion slice failed: ${String(error)}`; console.error(error); }
