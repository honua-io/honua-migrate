import Map from "@arcgis/core/Map";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import MapView from "@arcgis/core/views/MapView";
import Legend from "@arcgis/core/widgets/Legend";
import SearchViewModel from "@arcgis/core/widgets/Search/SearchViewModel";

const parcels = new FeatureLayer({
  url: "https://example.test/rest/services/parcels/FeatureServer/0",
  outFields: ["OBJECTID", "NAME"],
});

const map = new Map({
  basemap: "streets",
  layers: [parcels],
});

const view = new MapView({
  map,
  container: "viewDiv",
  center: [-157.86, 21.31],
  zoom: 11,
});

const legend = new Legend({ view });
view.ui.add(legend, "bottom-left");

// View-model-only usage: the app drives search from its own UI, so no Search widget is constructed.
export const searchModel = new SearchViewModel({ view });
