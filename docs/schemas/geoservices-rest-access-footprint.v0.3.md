---
type: reference
title: "geoservices-rest-access-footprint v0.3 schema"
description: "Breaking neutral revision of the access footprint artifact contract."
resource: "https://github.com/honua-io/honua-migrate/tree/trunk/schemas"
tags: [schema, access, permissions]
---
# GeoServicesRestAccessFootprint.json v0.3

The v0.3 access artifact uses neutral GeoServices REST identifiers. Its schema
ID is `https://schemas.honua.io/geoservices-rest-access-footprint/v0.3.0/geoservices-rest-access-footprint.json`,
and the file is [`schemas/geoservices-rest-access-footprint-v0.3.json`](../../schemas/geoservices-rest-access-footprint-v0.3.json).

This is a breaking v0.x minor revision. The producer name is `honua-migrate`;
source kinds are `portal` and `geoservices-server`; the artifact filename and
schema identifier are neutral. Strict consumers pinned to v0.1 or v0.2 must
explicitly adopt v0.3 and update producer, source-kind, and schema-ID checks.
Earlier schemas remain available for validating historical artifacts.

The access footprint contains identities, roles and privileges, groups,
service permissions, item sharing, organization security configuration, and
prospect-safe diagnostics. All recorded access is read-only. External service
paths such as `/sharing/rest` and `/arcgis/admin` remain literal where needed
to describe the service protocol.
