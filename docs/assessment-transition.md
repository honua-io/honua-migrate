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

Default artifact filenames are now `AssessmentFootprint.json` and
`AssessmentAccessFootprint.json`; explicit output paths still work. Existing JSON
schema IDs and fields remain unchanged. Contract evolution follows the separate
[versioning policy](schemas/versioning.md).
