import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import LayerListViewModel from "@arcgis/core/widgets/LayerList/LayerListViewModel";
import LegendViewModel from "@arcgis/core/widgets/Legend/LegendViewModel";
import SearchViewModel from "@arcgis/core/widgets/Search/SearchViewModel";
import DistanceMeasurement2DViewModel from "@arcgis/core/widgets/DistanceMeasurement2D/DistanceMeasurement2DViewModel";

/**
 * Representative widget/view-model 2D application from the 2026.1 cohort: the
 * app renders its own UI and drives it from the classic widget view models
 * (layer list, legend, search, measurement) instead of mounting the widgets.
 */
const hydrants = new FeatureLayer({
  url: "https://example.test/rest/services/hydrants/FeatureServer/0",
  outFields: ["OBJECTID", "STATUS"],
});

const map = new Map({
  basemap: "streets-vector",
  layers: [hydrants],
});

const view = new MapView({
  map,
  container: "viewDiv",
  center: [-157.83, 21.29],
  zoom: 14,
});

const layerListViewModel = new LayerListViewModel({ view });
const legendViewModel = new LegendViewModel({ view });
const searchViewModel = new SearchViewModel({ view, includeDefaultSources: false });
const measurementViewModel = new DistanceMeasurement2DViewModel({ view, unit: "meters" });

function renderLayerRows(target: HTMLElement): void {
  target.replaceChildren(
    ...layerListViewModel.operationalItems.map((item) => {
      const row = document.createElement("li");
      row.textContent = item.title;
      return row;
    }),
  );
}

function renderLegendRows(target: HTMLElement): void {
  target.textContent = `${legendViewModel.activeLayerInfos.length} legend entries`;
}

document.querySelector<HTMLFormElement>("#search")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = (event.currentTarget as HTMLFormElement).elements.namedItem("q") as HTMLInputElement;
  void searchViewModel.search(input.value);
});

document.querySelector<HTMLButtonElement>("#measure")?.addEventListener("click", () => {
  measurementViewModel.start();
});

view.when(() => {
  const layers = document.querySelector<HTMLElement>("#layers");
  const legend = document.querySelector<HTMLElement>("#legend");
  if (layers) {
    renderLayerRows(layers);
  }
  if (legend) {
    renderLegendRows(legend);
  }
});
