---
type: guide
title: "Assessment command"
description: "Run read-only assessment through the unified migration command and import the assessment library from its current Python namespace."
resource: "https://pypi.org/project/honua-migrate/"
tags: [assess, read-only, workflow]
---
# Assessment command

Run read-only assessment from the unified command tree:

```bash
honua-migrate assess --help
python -m honua_migrate assess --help
```

The Python package is `honua_migrate.assessment`. The former standalone
assessment command and module entry points have been removed. Scripts that used
them should invoke the unified command; Python integrations should import from
`honua_migrate.assessment`.

Replace `honua-esri-assess ...` and `python -m honua_esri_assess ...` with
`honua-migrate assess ...`. Imports from `honua_esri_assess` move to
`honua_migrate.assessment`.

The default inventory filename is `AssessmentFootprint.json`. RBAC assessment
still writes to stdout by default; use `--output AssessmentAccessFootprint.json`
to save it. Explicit output paths still work. Existing JSON
schema IDs and fields remain unchanged. Contract evolution follows the separate
[versioning policy](schemas/versioning.md).

Source HTTP requests retain the `honua-esri-assess` User-Agent product identifier
so operator proxy allowlists continue to match.

Local crash dumps use `HONUA_MIGRATE_ASSESSMENT_CRASH_DUMPS=1`.
The former `HONUA_ESRI_ASSESS_CRASH_DUMPS` variable is no longer read.
