import type MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
export const layer = new FeatureLayer({ url: "https://example.test/rest/services/x/FeatureServer/0" });
export const g = (v: MapView) => v.zoom;
