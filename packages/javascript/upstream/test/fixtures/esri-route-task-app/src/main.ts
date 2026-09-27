import { solve } from "@arcgis/core/rest/route";

const result = await solve("https://example.test/rest/services/network/RouteServer", {
  stops: {
    features: [
      { geometry: { x: -157.8583, y: 21.3069 }, attributes: { Name: "Start" } },
      { geometry: { x: -157.9076, y: 21.3035 }, attributes: { Name: "End" } },
    ],
  },
  returnDirections: true,
});

void result;
