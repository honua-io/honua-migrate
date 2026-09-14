// Classic AMD (Dojo loader) entry point still shipped alongside the ESM build.
require(["esri/Map", "esri/views/MapView", "esri/widgets/LayerList"], (EsriMap, MapView, LayerList) => {
  const view = new MapView({
    container: "legacyViewDiv",
    map: new EsriMap({ basemap: "topo-vector" }),
  });
  view.ui.add(new LayerList({ view }), "top-right");
});
