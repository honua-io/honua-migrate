---
type: guide
title: "When honua-migrate and honua-sdk collide"
description: "Both distributions declare a honua-migrate console script. Which one wins, why, and what to do if you have installed both."
resource: "https://pypi.org/project/honua-migrate/"
tags: [install, troubleshooting, cli]
---
# `honua-migrate` console-script ownership

The `honua-migrate` distribution is the canonical owner of the
`honua-migrate` console script. The published `honua-sdk` 0.x distribution
also declares a script with that name for its legacy ArcPy migration CLI.
Python installers do not arbitrate duplicate console-script names: whichever
wheel writes the launcher last can silently win.

This distribution therefore does **not** depend on or provide an extra that
automatically installs `honua-sdk`. The offline `honua-migrate code python`
scan, translate, `.pyt`, `.atbx`, and GPServer classification commands work
without the SDK. A live `code python run` exits with the typed unavailable
status when `honua-sdk` cannot be imported; it never installs or selects a
colliding launcher implicitly. Exit 0 from that command is execution success
only after every required job reaches a successful terminal state and every
declared output is verified. `--yes` does not turn an empty, partial,
unsupported, timed-out, or cancelled run into success. `run --dry-run` can
exit 0 for a fully supported preview, and that preview is not execution.

If live execution is required before `honua-sdk` removes its legacy script,
use a dedicated virtual environment and invoke this distribution by module:

```bash
python -m venv .venv-honua-migrate-run
.venv-honua-migrate-run/bin/python -m pip install honua-migrate honua-sdk
.venv-honua-migrate-run/bin/python -m honua_migrate code python run --help
```

A live run against a Honua server uses that same module invocation. Put the
API key in an environment variable and pass the variable name. The quickstart
admin password is that key. A script the server can execute passes a GeoJSON
geometry or base64 WKB, an integer `srid`, and a positive numeric distance:

```bash
export HONUA_API_KEY
.venv-honua-migrate-run/bin/python -m honua_migrate code python run buffer.py \
  --server http://127.0.0.1:18080 \
  --yes \
  --api-key-env HONUA_API_KEY
```

Exit 0 means every required job reached a successful terminal state and every
declared output was verified. A failed or unfinished job exits non-zero, keeps
the job id, and is not submitted again. `run --dry-run` can exit 0 for a
feature-class script such as `Buffer("roads", "roads_buffer", "25 Meters")`.
That preview records the offline process id `buffer` and does not mean the
server accepted the script. With `honua-sdk`'s geoprocessing client installed,
that feature-class plan is refused before any request.

On Windows, the interpreter is
`.venv-honua-migrate-run\Scripts\python.exe`. Do not rely on the
`honua-migrate` executable in a co-installed 0.x SDK environment; use
`python -m honua_migrate` so launcher installation order cannot select the
legacy SDK CLI. A normal `pipx install honua-migrate` remains isolated and
owns both the canonical `honua-migrate` command and the
`honua-esri-assess` compatibility command.

The collision can be considered resolved only after a released `honua-sdk`
version removes its `[project.scripts].honua-migrate` entry while retaining
the documented `python -m honua_sdk.migration` compatibility surface. At that
point this repository may add a version-constrained SDK extra in a separately
reviewed change. Release tests fail if `honua-sdk` is reintroduced as a direct
or optional dependency before that cutover.
