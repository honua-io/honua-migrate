import type Graphic from "@arcgis/core/Graphic.js";
import type Point from "@arcgis/core/geometry/Point.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type MapView from "@arcgis/core/views/MapView.js";

interface Handle {
  remove(): void;
}

let highlight: Handle | undefined;

/**
 * Click selection: query the layer around the clicked point and highlight the
 * matching features on the layer view. Only type-only ArcGIS imports appear in
 * this module; every runtime object arrives as an argument.
 */
export async function selectParcelsAt(view: MapView, layer: FeatureLayer, mapPoint: Point): Promise<Graphic[]> {
  const layerView = await view.whenLayerView(layer);
  const query = layer.createQuery();
  query.geometry = mapPoint;
  query.distance = 5;
  query.units = "meters";
  query.spatialRelationship = "intersects";
  query.returnGeometry = true;
  query.outFields = ["OBJECTID", "APN", "OWNER"];

  const { features } = await layer.queryFeatures(query);
  clearSelection();
  highlight = layerView.highlight(features);
  return features;
}

export function clearSelection(): void {
  highlight?.remove();
  highlight = undefined;
}
