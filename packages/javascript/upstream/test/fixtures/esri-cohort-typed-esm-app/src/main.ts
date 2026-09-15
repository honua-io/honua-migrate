import Map from "@arcgis/core/Map.js";
import MapView from "@arcgis/core/views/MapView.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import PopupTemplate from "@arcgis/core/PopupTemplate.js";
import LayerList from "@arcgis/core/widgets/LayerList.js";
import Legend from "@arcgis/core/widgets/Legend.js";
import Search from "@arcgis/core/widgets/Search.js";
import DistanceMeasurement2D from "@arcgis/core/widgets/DistanceMeasurement2D.js";

import { clearSelection, selectParcelsAt } from "./selection.js";

/**
 * Representative typed ESM (TypeScript, `.js`-suffixed specifiers) 2D
 * FeatureLayer/MapView application from the 2026.1 cohort: layer list,
 * legend, search, popup, click selection and distance measurement.
 */
interface ParcelAttributes {
  OBJECTID: number;
  APN: string;
  OWNER: string;
}

const parcelsUrl = "https://example.test/rest/services/parcels/FeatureServer/0";

const parcels = new FeatureLayer({
  url: parcelsUrl,
  outFields: ["OBJECTID", "APN", "OWNER"],
  popupTemplate: new PopupTemplate({
    title: "Parcel {APN}",
    content: "Owner: {OWNER}",
  }),
});

const map = new Map({
  basemap: "gray-vector",
  layers: [parcels],
});

const view = new MapView({
  map,
  container: "viewDiv",
  center: [-157.86, 21.31],
  zoom: 15,
});

const layerList = new LayerList({ view });
const legend = new Legend({ view });
const search = new Search({ view, includeDefaultSources: false });
const measurement = new DistanceMeasurement2D({ view, unit: "meters" });

view.ui.add(layerList, "top-right");
view.ui.add(legend, "bottom-left");
view.ui.add(search, "top-left");
view.ui.add(measurement, "bottom-right");

view.on("click", async (event) => {
  const selected = await selectParcelsAt(view, parcels, event.mapPoint);
  const first = selected[0]?.attributes as ParcelAttributes | undefined;
  if (first) {
    document.title = `Parcel ${first.APN}`;
  }
});

view.on("key-down", (event) => {
  if (event.key === "Escape") {
    clearSelection();
  }
});
