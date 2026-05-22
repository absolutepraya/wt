import pytest
import subprocess
from pathlib import Path


def _run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True)


def test_git_fetch_succeeds(tmp_repo, wt_module):
    wt_module.git_fetch(tmp_repo, "origin", "main")
    # No exception = pass.


def test_git_fetch_unknown_branch_raises(tmp_repo, wt_module):
    with pytest.raises(wt_module.GitError):
        wt_module.git_fetch(tmp_repo, "origin", "does-not-exist")


def test_list_worktrees_returns_main_only(tmp_repo, wt_module):
    wts = wt_module.list_worktrees(tmp_repo)
    assert len(wts) == 1
    assert wts[0]["path"] == str(tmp_repo)
    assert wts[0]["branch"] == "main"


def test_list_worktrees_after_add(tmp_repo, wt_module):
    new_path = tmp_repo / ".worktrees" / "test-wt"
    new_path.parent.mkdir()
    _run(["git", "worktree", "add", "-b", "feat/test", str(new_path), "main"], tmp_repo)
    wts = wt_module.list_worktrees(tmp_repo)
    assert len(wts) == 2
    branches = {w["branch"] for w in wts}
    assert branches == {"main", "feat/test"}


def test_branch_already_checked_out(tmp_repo, wt_module):
    new_path = tmp_repo / ".worktrees" / "x"
    new_path.parent.mkdir()
    _run(["git", "worktree", "add", "-b", "feature-x", str(new_path), "main"], tmp_repo)
    assert wt_module.branch_in_use(tmp_repo, "feature-x") is not None
    assert wt_module.branch_in_use(tmp_repo, "main") is not None
    assert wt_module.branch_in_use(tmp_repo, "nonexistent") is None


def test_has_unmerged_commits_false_when_clean(tmp_repo, wt_module):
    """A branch identical to origin/main has no unmerged commits."""
    _run(["git", "branch", "feat/x", "main"], tmp_repo)
    assert not wt_module.has_unmerged_commits(tmp_repo, "feat/x", "origin/main")


def test_has_unmerged_commits_true_when_diverged(tmp_repo, wt_module):
    _run(["git", "checkout", "-b", "feat/y"], tmp_repo)
    (tmp_repo / "new.txt").write_text("hi")
    _run(["git", "add", "."], tmp_repo)
    _run(["git", "commit", "-m", "add new"], tmp_repo)
    _run(["git", "checkout", "main"], tmp_repo)
    assert wt_module.has_unmerged_commits(tmp_repo, "feat/y", "origin/main")
