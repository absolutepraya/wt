import json
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def test_npm_manifest_exposes_the_wt_binary():
    manifest = json.loads((ROOT / "package.json").read_text())

    assert manifest["name"] == "@praya/wt"
    assert manifest["bin"] == {"wt": "npm/wt.cjs"}
    assert "bin/wt" in manifest["files"]
    assert "npm/wt.cjs" in manifest["files"]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_npm_launcher_forwards_to_python_cli():
    result = subprocess.run(
        [shutil.which("node"), str(ROOT / "npm" / "wt.cjs"), "--help"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "Universal git worktree CLI" in result.stdout
