"""Pytest fixtures: real git repo with a fake `origin` bare remote."""
from __future__ import annotations

import importlib
import importlib.util
from importlib.machinery import SourceFileLoader
import os
import subprocess
from pathlib import Path

import pytest


def _run(cmd: list[str], cwd: Path) -> None:
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def fake_remote(tmp_path: Path) -> Path:
    """A bare git repo that acts as `origin` for `tmp_repo`."""
    remote = tmp_path / "remote.git"
    remote.mkdir()
    _run(["git", "init", "--bare", "-b", "main"], remote)
    return remote


@pytest.fixture
def tmp_repo(tmp_path: Path, fake_remote: Path) -> Path:
    """A working git repo with `origin` pointing at `fake_remote` and an
    initial commit on `main` already pushed upstream."""
    repo = tmp_path / "myproject"
    repo.mkdir()
    _run(["git", "init", "-b", "main"], repo)
    _run(["git", "config", "user.email", "test@example.com"], repo)
    _run(["git", "config", "user.name", "Test"], repo)
    _run(["git", "config", "commit.gpgsign", "false"], repo)
    (repo / "README.md").write_text("# myproject\n")
    _run(["git", "add", "."], repo)
    _run(["git", "commit", "-m", "initial"], repo)
    _run(["git", "remote", "add", "origin", str(fake_remote)], repo)
    _run(["git", "push", "-u", "origin", "main"], repo)
    return repo


# Path to the canonical wt source, resolved at import time (before any
# monkeypatch can rewrite HOME). Points at bin/wt at the repo root so the
# same bytes that get shipped are the bytes under test.
_WT_SOURCE = Path(__file__).resolve().parent.parent / "bin" / "wt"


@pytest.fixture
def wt_module(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Import `wt` as a module, with HOME pointed at a tmp dir so state
    files don't leak into the real ~/.wt."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USER", "testuser")

    import sys
    # Explicit SourceFileLoader needed because the file has no .py extension;
    # importlib can't otherwise infer it's Python.
    loader = SourceFileLoader("wt", str(_WT_SOURCE))
    spec = importlib.util.spec_from_loader("wt", loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules["wt"] = module
    loader.exec_module(module)
    return module


@pytest.fixture
def write_config(tmp_repo: Path):
    """Helper to drop a `.wt/config.toml` into the test repo."""

    def _write(content: str) -> Path:
        cfg_dir = tmp_repo / ".wt"
        cfg_dir.mkdir(exist_ok=True)
        cfg_path = cfg_dir / "config.toml"
        cfg_path.write_text(content)
        return cfg_path

    return _write
