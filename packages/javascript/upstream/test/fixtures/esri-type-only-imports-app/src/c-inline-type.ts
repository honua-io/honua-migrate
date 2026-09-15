import { type default as MapView } from "@arcgis/core/views/MapView";
import Map from "@arcgis/core/Map";
export const m = new Map({ basemap: "streets" });
export const f = (v: MapView) => v.zoom;
