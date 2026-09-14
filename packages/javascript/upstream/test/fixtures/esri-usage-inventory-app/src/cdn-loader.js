// CDN build: modules load through the $arcgis global rather than a bundler import.
export async function addEditingTools(view) {
  const [Sketch, GraphicsLayer] = await $arcgis.import(["esri/widgets/Sketch", "@arcgis/core/layers/GraphicsLayer.js"]);
  const Expand = await $arcgis.import("@arcgis/core/widgets/Expand.js");

  const layer = new GraphicsLayer();
  view.map.add(layer);
  const sketch = new Sketch({ view, layer });
  view.ui.add(new Expand({ view, content: sketch }), "top-right");
}
