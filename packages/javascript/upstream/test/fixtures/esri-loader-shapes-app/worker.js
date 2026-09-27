import * as bufferOperator from "@arcgis/core/geometry/operators/bufferOperator.js";
import * as generalizeOperator from "@arcgis/core/geometry/operators/generalizeOperator.js";
import * as query from "@arcgis/core/rest/query.js";

export async function run(line, url) {
  const buffered = bufferOperator.execute(line, 200, { unit: "meters" });
  const simplified = generalizeOperator.execute(buffered, 10, { unit: "meters" });
  const features = await query.executeQueryJSON(url, { where: "1=1" });
  return { simplified, features };
}
