import EsriMap = require("esri/Map");
import geometryEngine = require("esri/geometry/geometryEngine");

export function build(geometry: object) {
  const map = new EsriMap({ basemap: "streets-vector" });
  return { map, area: geometryEngine.geodesicBuffer(geometry, 10, "meters") };
}
