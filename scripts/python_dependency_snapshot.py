"""Describe the complete release lock for GitHub's dependency submission API.

This consumes every pinned distribution, including development tools and
platform-specific requirements. It does not resolve or install packages, and
never overrides the separate pyproject.toml manifest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from urllib.parse import quote

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def requirements(path: Path) -> list[Requirement]:
    """Read uv's pip-compile output, rejecting unsupported directives."""
    result = []
    pending = ""
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        pending += " " + line.removesuffix("\\").strip()
        if line.endswith("\\"):
            continue
        # Hashes are integrity metadata, not dependency requirements.
        value = re.sub(r"\s+--hash=sha256:[0-9a-f]{64}(?=\s|$)", "", pending)
        result.append(Requirement(value.strip()))
        pending = ""
    if pending:
        raise ValueError(f"Unterminated requirement in {path}")
    if not result:
        raise ValueError(f"No requirements in {path}")
    return result


def manifest(lock: Path, inputs: Path) -> dict:
    direct = {canonicalize_name(req.name) for req in requirements(inputs)}
    resolved = {}
    names = set()
    for req in requirements(lock):
        pins = list(req.specifier)
        if (
            req.url
            or len(pins) != 1
            or pins[0].operator != "=="
            or "*" in pins[0].version
        ):
            raise ValueError(f"Lock must contain exact versions: {req.name}")
        name = canonicalize_name(req.name)
        if name in names:
            raise ValueError(f"Duplicate locked distribution: {name}")
        names.add(name)
        package_url = f"pkg:pypi/{name}@{quote(pins[0].version, safe='')}"
        resolved[package_url] = {
            "package_url": package_url,
            "relationship": "direct" if name in direct else "indirect",
            # Keep the entire toolchain in vulnerability coverage. The lock
            # doesn't record sufficient edges to infer runtime/dev boundaries.
            "scope": "runtime",
        }
    if missing := direct - names:
        raise ValueError(f"Inputs absent from lock: {', '.join(sorted(missing))}")
    return {
        "name": "/requirements/release.txt",
        "file": {"source_location": "requirements/release.txt"},
        "resolved": resolved,
    }


def snapshot(root: Path, sha: str, ref: str, run_id: str, run_url: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("A full commit SHA is required")
    if ref != "refs/heads/trunk":
        raise ValueError("Only trunk can update the release dependency graph")
    return {
        "version": 0,
        "sha": sha,
        "ref": ref,
        "job": {
            "correlator": "release-lock",
            "id": run_id,
            "html_url": run_url,
        },
        "detector": {
            "name": "honua-migrate-release-lock",
            "version": "1.0.0",
            "url": "https://github.com/honua-io/honua-migrate",
        },
        "manifests": {
            "/requirements/release.txt": manifest(
                root / "requirements/release.txt", root / "requirements/release.in"
            )
        },
        "scanned": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    args = parser.parse_args()
    print(
        json.dumps(snapshot(Path.cwd(), args.sha, args.ref, args.run_id, args.run_url))
    )


if __name__ == "__main__":
    main()
