---
type: reference
title: "geoservices-rest-footprint v0.3 schema"
description: "Breaking neutral revision of the read-only footprint artifact contract."
resource: "https://github.com/honua-io/honua-migrate/tree/trunk/schemas"
tags: [schema, footprint, v0.3]
---
# GeoServicesRestFootprint.json v0.3

The v0.3 footprint contract uses neutral GeoServices REST artifact identifiers.
Its schema ID is
`https://schemas.honua.io/geoservices-rest-footprint/v0.3.0/geoservices-rest-footprint.json`,
and the canonical schema is
[`schemas/geoservices-rest-footprint-v0.3.json`](../../schemas/geoservices-rest-footprint-v0.3.json).

This is a breaking v0.x minor revision. The producer name is `honua-migrate`,
source kinds are `portal`, `geoservices-server`, and `filegdb`, inventory types
use `GeoServicesRestItem`, and the default output is
`GeoServicesRestFootprint.json`. Consumers pinned to v0.1 or v0.2 must opt into
v0.3 and update strict checks for those identifiers. The prior schemas remain
available to validate artifacts produced on those lines.

The artifact records a prospect-safe source locator, normalized inventory,
counts, and diagnostics. Portal content, server services, and local FileGDB
feature classes use distinct inventory variants selected by `source.kind`.
Optional dependency edges describe references between inventory records.

The schema preserves literal GeoServices REST response identifiers where they
are part of the external protocol, including geometry and field type tags. The
service routes remain the documented REST paths used by the read-only scanner.
No credentials, query strings, or URL fragments are accepted in handoff fields.
