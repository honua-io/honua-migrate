import Map from "@arcgis/core/Map";
import MapImageLayer from "@arcgis/core/layers/MapImageLayer";

const parcels = new MapImageLayer({
  url: "https://example.test/rest/services/parcels/MapServer",
  opacity: 0.7,
});

const map = new Map({
  basemap: "osm",
  layers: [parcels],
});

void map;
