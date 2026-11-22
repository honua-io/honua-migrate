"""The release snapshot must preserve vulnerability coverage of the whole lock."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "dependency_snapshot", ROOT / "scripts/python_dependency_snapshot.py"
)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_complete_lock_including_tools_and_platform_dependencies():
    result = module.manifest(
        ROOT / "requirements/release.txt", ROOT / "requirements/release.in"
    )
    expected = {
        req.name.lower().replace("_", "-")
        for req in module.requirements(ROOT / "requirements/release.txt")
    }
    actual = {url.split("/")[-1].split("@")[0] for url in result["resolved"]}
    assert actual == expected
    assert "pytest" in actual
    assert result["file"]["source_location"] == "requirements/release.txt"
    assert all(entry["scope"] == "runtime" for entry in result["resolved"].values())


def test_extras_markers_and_direct_relationship(tmp_path):
    lock = tmp_path / "lock"
    inputs = tmp_path / "inputs"
    inputs.write_text("requests>=2\n")
    lock.write_text(
        "requests[socks]==2.0 \\\n    --hash=sha256:"
        + "a" * 64
        + '\n# via -r inputs\ncolorama==1.0; sys_platform == "win32"\n'
    )
    resolved = module.manifest(lock, inputs)["resolved"]
    assert resolved["pkg:pypi/requests@2.0"]["relationship"] == "direct"
    assert resolved["pkg:pypi/colorama@1.0"]["relationship"] == "indirect"


@pytest.mark.parametrize(
    "text",
    [
        "",
        "requests>=2\n",
        "requests==2.*\n",
        "requests==2\nrequests==3\n",
        "--index-url https://example.com\n",
        "requests==2 \\\n",
        "requests==2 --hash=sha256:invalid\n",
    ],
)
def test_invalid_lock_fails_closed(tmp_path, text):
    lock = tmp_path / "lock"
    inputs = tmp_path / "inputs"
    inputs.write_text("requests>=2\n")
    lock.write_text(text)
    with pytest.raises(ValueError):
        module.manifest(lock, inputs)


def test_missing_input_fails_closed(tmp_path):
    lock = tmp_path / "lock"
    inputs = tmp_path / "inputs"
    inputs.write_text("requests>=2\n")
    lock.write_text("certifi==1\n")
    with pytest.raises(ValueError, match="Inputs absent"):
        module.manifest(lock, inputs)


def test_snapshot_rejects_non_trunk_or_invalid_sha():
    for sha, ref in [("abc", "refs/heads/trunk"), ("a" * 40, "refs/heads/feature")]:
        with pytest.raises(ValueError):
            module.snapshot(ROOT, sha, ref, "123", "https://example.com/run")
