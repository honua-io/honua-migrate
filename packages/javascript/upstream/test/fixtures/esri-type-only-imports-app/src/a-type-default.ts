import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
export const describe = (layer: FeatureLayer): string => layer.title;
