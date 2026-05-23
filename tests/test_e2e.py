import os
import subprocess
import sys
from pathlib import Path

# Point at the in-repo script so the e2e test exercises the same bytes
# we ship. Mirrors the resolution logic in conftest.py.
WT = str(Path(__file__).resolve().parent.parent / "bin" / "wt")


def _run_wt(args, cwd, env):
    return subprocess.run(
        [sys.executable, WT, *args],
        cwd=cwd, env=env, capture_output=True, text=True,
    )


def test_full_lifecycle_via_subprocess(tmp_repo, write_config, tmp_path):
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        'name_strategy = "cities"\n'
    )
    home = tmp_path / "home"
    home.mkdir()
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["USER"] = "abhip"

    # 1. Create
    r = _run_wt(["new", "adelaide"], cwd=tmp_repo, env=env)
    assert r.returncode == 0, r.stderr
    assert "Created worktree: adelaide" in r.stdout
    assert "__cd__:" in r.stdout

    # 2. List
    r = _run_wt(["ls"], cwd=tmp_repo, env=env)
    assert r.returncode == 0
    assert "adelaide" in r.stdout

    # 3. Cd (just verifies the command exits 0 and emits a sentinel)
    r = _run_wt(["cd", "adelaide"], cwd=tmp_repo, env=env)
    assert r.returncode == 0
    assert "__cd__:" in r.stdout

    # 4. Remove
    r = _run_wt(["rm", "adelaide"], cwd=tmp_repo, env=env)
    assert r.returncode == 0
    assert "Removed worktree: adelaide" in r.stdout

    # 5. ls now empty (only main)
    r = _run_wt(["ls"], cwd=tmp_repo, env=env)
    assert "adelaide" not in r.stdout
