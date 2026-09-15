import Map from "@arcgis/core/Map";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import MapView from "@arcgis/core/views/MapView";

const status = document.getElementById("status") as HTMLOutputElement;

const trails = new FeatureLayer({
  url: "/rest/services/trails/FeatureServer/0",
  outFields: ["NAME", "DIFFICULTY"],
});

const map = new Map({
  basemap: "topo-vector",
  layers: [trails],
});

const view = new MapView({
  map,
  container: "viewDiv",
  center: [-118.805, 34.027],
  zoom: 13,
});

async function showEasyTrails(): Promise<void> {
  await trails.load();
  const query = trails.createQuery();
  query.where = "DIFFICULTY = 'easy'";
  query.outFields = ["NAME"];
  const { features } = await trails.queryFeatures(query);
  status.dataset.count = String(features.length);
  status.dataset.view = view.container === "viewDiv" ? "viewDiv" : "none";
  status.textContent = features.map((feature) => feature.attributes.NAME).join(", ");
}

showEasyTrails().catch((error: unknown) => {
  status.dataset.error = error instanceof Error ? error.message : String(error);
});
