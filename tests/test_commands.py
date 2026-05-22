import os
import pytest
import subprocess
from pathlib import Path


def _run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def configured_repo(tmp_repo, write_config):
    """A tmp_repo with a minimal .wt/config.toml."""
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        'name_strategy = "cities"\n'
        'branch_template = "{user}/{name}"\n'
        'default_base = "origin/main"\n'
        "setup = []\n"
        "teardown = []\n"
    )
    return tmp_repo


def test_new_default_creates_worktree_and_branch(configured_repo, wt_module, capsys):
    rc = wt_module.cmd_new(name=None, branch=None, from_=None,
                           run_setup=True, start_dir=configured_repo)
    assert rc == 0
    out = capsys.readouterr().out
    # should emit __cd__:<absolute path> as the last meaningful line
    cd_lines = [l for l in out.splitlines() if l.startswith("__cd__:")]
    assert len(cd_lines) == 1
    new_path = Path(cd_lines[0].removeprefix("__cd__:"))
    assert new_path.exists()
    assert new_path.parent.name == ".worktrees"
    # branch named testuser/<some-city>
    branch = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=new_path, text=True,
    ).strip()
    assert branch.startswith("testuser/")


def test_new_with_explicit_name(configured_repo, wt_module, capsys):
    wt_module.cmd_new(name="my-fix", branch=None, from_=None,
                      run_setup=True, start_dir=configured_repo)
    new_path = configured_repo / ".worktrees" / "my-fix"
    assert new_path.exists()


def test_new_with_explicit_branch(configured_repo, wt_module, capsys):
    wt_module.cmd_new(name="my-fix", branch="custom-branch", from_=None,
                      run_setup=True, start_dir=configured_repo)
    new_path = configured_repo / ".worktrees" / "my-fix"
    branch = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=new_path, text=True,
    ).strip()
    assert branch == "custom-branch"


def test_new_records_state_under_correct_pid(configured_repo, wt_module):
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=True, start_dir=configured_repo)
    pid = wt_module.project_id(configured_repo)
    state = wt_module.load_state(pid)
    assert "1" in state["slots"]
    assert state["slots"]["1"]["name"] == "adelaide"


def test_new_runs_setup_with_env_vars(configured_repo, wt_module, write_config, tmp_path):
    """Setup script writes env vars to a marker file we can inspect."""
    marker = tmp_path / "marker.txt"
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        f'setup = ["env > {marker}"]\n'
    )
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=True, start_dir=configured_repo)
    text = marker.read_text()
    assert "WT_WORKSPACE_NAME=adelaide" in text
    assert f"WT_ROOT_PATH={configured_repo}" in text
    assert "WT_SLOT=1" in text
    assert "WT_PORT_BASE=10" in text
    expected_path = configured_repo / ".worktrees" / "adelaide"
    assert f"WT_WORKSPACE_PATH={expected_path}" in text
    assert "WT_BRANCH=testuser/adelaide" in text


def test_new_setup_failure_rolls_back(configured_repo, wt_module, write_config):
    """If setup fails, the worktree is removed and the slot is freed."""
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        'setup = ["false"]\n'  # always fails
    )
    with pytest.raises(wt_module.SetupFailed):
        wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                          run_setup=True, start_dir=configured_repo)
    # Worktree removed:
    assert not (configured_repo / ".worktrees" / "adelaide").exists()
    # Slot freed:
    pid = wt_module.project_id(configured_repo)
    assert wt_module.load_state(pid)["slots"] == {}


def test_new_when_full_raises(configured_repo, wt_module, write_config):
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 1\n"  # only one allowed
    )
    wt_module.cmd_new(name="first", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    with pytest.raises(wt_module.SlotsFull):
        wt_module.cmd_new(name="second", branch=None, from_=None,
                          run_setup=False, start_dir=configured_repo)


def test_new_from_remote_branch_tracks_origin(configured_repo, wt_module, fake_remote):
    """`wt new --from feature-x` should fetch and track origin/feature-x."""
    # Push a remote branch to fake_remote:
    work = configured_repo.parent / "work"
    work.mkdir()
    _run(["git", "clone", str(fake_remote), str(work)], work.parent)
    _run(["git", "config", "user.email", "test@example.com"], work)
    _run(["git", "config", "user.name", "Test"], work)
    _run(["git", "checkout", "-b", "feature-x"], work)
    (work / "feat.txt").write_text("feature work")
    _run(["git", "add", "."], work)
    _run(["git", "commit", "-m", "feat"], work)
    _run(["git", "push", "origin", "feature-x"], work)

    wt_module.cmd_new(name="adelaide", branch=None, from_="feature-x",
                      run_setup=False, start_dir=configured_repo)

    new_path = configured_repo / ".worktrees" / "adelaide"
    branch = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=new_path, text=True,
    ).strip()
    assert branch == "feature-x"
    upstream = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "feature-x@{upstream}"],
        cwd=new_path, text=True,
    ).strip()
    assert upstream == "origin/feature-x"
    # The committed file is present:
    assert (new_path / "feat.txt").exists()


def test_new_from_when_branch_already_checked_out_errors(
    configured_repo, wt_module, fake_remote
):
    """If `feature-x` is already checked out in another worktree, error."""
    # Set up the remote branch as in the previous test:
    work = configured_repo.parent / "work2"
    work.mkdir()
    _run(["git", "clone", str(fake_remote), str(work)], work.parent)
    _run(["git", "config", "user.email", "test@example.com"], work)
    _run(["git", "config", "user.name", "Test"], work)
    _run(["git", "checkout", "-b", "feature-x"], work)
    (work / "f.txt").write_text("x")
    _run(["git", "add", "."], work)
    _run(["git", "commit", "-m", "x"], work)
    _run(["git", "push", "origin", "feature-x"], work)

    # First worktree claims feature-x:
    wt_module.cmd_new(name="first", branch=None, from_="feature-x",
                      run_setup=False, start_dir=configured_repo)

    # Second attempt should error:
    with pytest.raises(wt_module.GitError, match="already checked out"):
        wt_module.cmd_new(name="second", branch=None, from_="feature-x",
                          run_setup=False, start_dir=configured_repo)


def test_ls_with_one_managed_worktree(configured_repo, wt_module, capsys):
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    capsys.readouterr()  # discard new's output
    rc = wt_module.cmd_ls(start_dir=configured_repo)
    assert rc == 0
    out = capsys.readouterr().out
    assert "adelaide" in out
    assert "testuser/adelaide" in out
    # Header row + main row + adelaide row:
    assert "SLOT" in out
    assert "(main)" in out


def test_ls_marks_unmanaged_worktrees(configured_repo, wt_module, capsys):
    """Worktrees created outside `wt` should appear in the same table under
    a spanning 'Unmanaged worktrees' section header."""
    raw = configured_repo / ".worktrees" / "manual"
    raw.parent.mkdir(exist_ok=True)
    _run(["git", "worktree", "add", "-b", "raw-branch", str(raw), "main"],
         configured_repo)
    wt_module.cmd_ls(start_dir=configured_repo)
    out = capsys.readouterr().out
    assert "Unmanaged worktrees" in out
    assert "raw-branch" in out


def test_cd_emits_path_and_sentinel(configured_repo, wt_module, capsys):
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    capsys.readouterr()
    rc = wt_module.cmd_cd(name="adelaide", start_dir=configured_repo)
    assert rc == 0
    out = capsys.readouterr().out
    expected = configured_repo / ".worktrees" / "adelaide"
    assert f"__cd__:{expected}" in out


def test_cd_unknown_name_errors(configured_repo, wt_module):
    rc = wt_module.cmd_cd(name="ghost", start_dir=configured_repo)
    assert rc == 1


def test_cd_main_routes_to_repo_root(configured_repo, wt_module, capsys):
    """`wt cd main` should go to the main worktree (repo root), which is
    not tracked in wt's state file."""
    rc = wt_module.cmd_cd(name="main", start_dir=configured_repo)
    assert rc == 0
    out = capsys.readouterr().out
    assert f"__cd__:{configured_repo.resolve()}" in out


def test_cd_no_name_defaults_to_main(configured_repo, wt_module, capsys):
    """`wt cd` with no argument should default to main."""
    rc = wt_module.cmd_cd(name=None, start_dir=configured_repo)
    assert rc == 0
    out = capsys.readouterr().out
    assert f"__cd__:{configured_repo.resolve()}" in out


def test_cd_unknown_name_lists_main_in_valid_options(
    configured_repo, wt_module, capsys
):
    """Error message for unknown names should include 'main' so users see
    they can cd back to it."""
    wt_module.cmd_cd(name="ghost", start_dir=configured_repo)
    err = capsys.readouterr().err
    assert "main" in err


def test_rm_clean_branch_removes_worktree_and_branch(configured_repo, wt_module):
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 0
    assert not (configured_repo / ".worktrees" / "adelaide").exists()
    branches = subprocess.check_output(
        ["git", "branch", "--list"], cwd=configured_repo, text=True
    )
    assert "testuser/adelaide" not in branches
    pid = wt_module.project_id(configured_repo)
    assert wt_module.load_state(pid)["slots"] == {}


def test_rm_unmerged_branch_refuses_without_force(
    configured_repo, wt_module, capsys
):
    """When unmerged commits exist and no --force is given, prompt the user
    to continue/stop. In pytest (no tty), defaults to stop → rc=1, worktree
    intact."""
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    new_path = configured_repo / ".worktrees" / "adelaide"
    (new_path / "work.txt").write_text("unmerged")
    _run(["git", "add", "."], new_path)
    _run(["git", "commit", "-m", "unmerged work"], new_path)

    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 1
    err = capsys.readouterr().err
    # Commit subject surfaces to the user via the prompt
    assert "unmerged work" in err
    # Worktree still there:
    assert new_path.exists()


def test_rm_unmerged_branch_force_removes(configured_repo, wt_module):
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    new_path = configured_repo / ".worktrees" / "adelaide"
    (new_path / "work.txt").write_text("unmerged")
    _run(["git", "add", "."], new_path)
    _run(["git", "commit", "-m", "unmerged work"], new_path)

    rc = wt_module.cmd_rm(name="adelaide", force=True, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 0
    assert not new_path.exists()


def test_rm_keep_branch_keeps_branch(configured_repo, wt_module):
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=True,
                          start_dir=configured_repo)
    assert rc == 0
    branches = subprocess.check_output(
        ["git", "branch", "--list"], cwd=configured_repo, text=True
    )
    assert "testuser/adelaide" in branches


def test_rm_runs_teardown_with_env_vars(configured_repo, wt_module, write_config, tmp_path):
    marker = tmp_path / "td.txt"
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        f'teardown = ["env > {marker}"]\n'
    )
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                     start_dir=configured_repo)
    text = marker.read_text()
    assert "WT_WORKSPACE_NAME=adelaide" in text
    assert "WT_SLOT=1" in text


def test_rm_unknown_name_errors(configured_repo, wt_module):
    rc = wt_module.cmd_rm(name="ghost", force=False, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 1


def test_rm_failing_teardown_non_tty_defaults_to_stop(
    configured_repo, wt_module, write_config
):
    """When stdin isn't a tty (i.e. pytest), failing teardown should default
    to stop without --force. The worktree must remain on disk."""
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        'teardown = ["false"]\n'  # always fails
    )
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 1
    assert (configured_repo / ".worktrees" / "adelaide").exists()


def test_rm_failing_teardown_with_force_continues(
    configured_repo, wt_module, write_config
):
    """`--force` should skip the prompt and continue removal even if
    teardown fails."""
    write_config(
        'worktree_path = ".worktrees"\n'
        "port_offset_interval = 10\n"
        "max_slots = 5\n"
        'teardown = ["false"]\n'
    )
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    rc = wt_module.cmd_rm(name="adelaide", force=True, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 0
    assert not (configured_repo / ".worktrees" / "adelaide").exists()


# Fix #1: friendly error on dirty worktree


def test_rm_dirty_worktree_refuses_with_friendly_message(
    configured_repo, wt_module, capsys
):
    """When `wt rm` fails because the worktree has untracked files, it should
    print a clear message mentioning --force and return 1 without touching the
    slot or the branch."""
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    worktree = configured_repo / ".worktrees" / "adelaide"
    # Write an untracked file — git worktree remove refuses without --force
    (worktree / "scratch.txt").write_text("dirty")

    capsys.readouterr()  # clear output from cmd_new
    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=configured_repo)

    assert rc == 1
    err = capsys.readouterr().err
    assert "--force" in err

    # Worktree still present on disk
    assert worktree.exists()

    # Slot still in state (state is consistent, retry with --force is possible)
    pid = wt_module.project_id(configured_repo)
    state = wt_module.load_state(pid)
    assert any(e["name"] == "adelaide" for e in state["slots"].values())


# Unmerged-commits prompt surfaces the actual commit list


def test_rm_unmerged_branch_prompt_surfaces_commit_subject(
    configured_repo, wt_module, capsys
):
    """The unmerged-commits prompt must include the unmerged commit subject
    so the user knows exactly what they would lose."""
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    new_path = configured_repo / ".worktrees" / "adelaide"
    (new_path / "work.txt").write_text("unique work")
    _run(["git", "add", "."], new_path)
    _run(["git", "commit", "-m", "unmerged work"], new_path)

    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 1  # non-tty defaults to stop
    assert "unmerged work" in capsys.readouterr().err


# Unmerged-commits prompt mentions when the branch has no upstream


def test_rm_unmerged_branch_no_upstream_prompt_mentions_it(
    configured_repo, wt_module, capsys
):
    """When the branch has no upstream tracking ref the prompt should
    include a hint to push before continuing. We explicitly unset the
    upstream that git worktree add establishes so this test is hermetic."""
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    new_path = configured_repo / ".worktrees" / "adelaide"

    # Unset the upstream that git worktree add set (origin/main).
    # After this the branch genuinely has no upstream.
    _run(["git", "branch", "--unset-upstream", "testuser/adelaide"],
         configured_repo)

    (new_path / "work.txt").write_text("local only")
    _run(["git", "add", "."], new_path)
    _run(["git", "commit", "-m", "local commit"], new_path)

    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=configured_repo)
    assert rc == 1
    err = capsys.readouterr().err
    # Commit subject present
    assert "local commit" in err
    # No-upstream hint present
    assert "no upstream" in err


def test_ls_from_inside_linked_worktree_sees_main(configured_repo, wt_module, capsys):
    """`wt ls` invoked from inside a linked worktree should still find the
    main worktree and show the same state, not start a fresh project_id."""
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    capsys.readouterr()
    inside = configured_repo / ".worktrees" / "adelaide"
    rc = wt_module.cmd_ls(start_dir=inside)
    assert rc == 0
    out = capsys.readouterr().out
    # Both main and adelaide should appear, proving project_id is keyed off
    # the main worktree (not the linked one we ran from).
    assert "(main)" in out
    assert "adelaide" in out


def test_rm_refuses_when_cwd_inside_target(
    configured_repo, wt_module, monkeypatch, capsys
):
    """Refuse to remove a worktree the user is currently sitting inside —
    otherwise the shell ends up in a phantom directory."""
    wt_module.cmd_new(name="adelaide", branch=None, from_=None,
                      run_setup=False, start_dir=configured_repo)
    target = configured_repo / ".worktrees" / "adelaide"
    monkeypatch.chdir(target)
    rc = wt_module.cmd_rm(name="adelaide", force=False, keep_branch=False,
                          start_dir=target)
    assert rc == 1
    err = capsys.readouterr().err
    assert "currently inside" in err
    assert "cd out" in err
    # State and disk unchanged
    assert target.exists()
    pid = wt_module.project_id(configured_repo)
    assert "1" in wt_module.load_state(pid)["slots"]


def test_new_explicit_name_collides_with_existing_dir(
    configured_repo, wt_module
):
    """If a directory at `.worktrees/<name>` already exists (e.g. an
    abandoned unmanaged dir), `wt new <name>` should fail with a friendly
    message instead of git's raw stderr."""
    parked = configured_repo / ".worktrees" / "parked"
    parked.mkdir(parents=True)
    (parked / "stale.txt").write_text("hi")
    with pytest.raises(wt_module.GitError, match="already exists"):
        wt_module.cmd_new(name="parked", branch=None, from_=None,
                          run_setup=False, start_dir=configured_repo)
    # State did NOT get a slot for the failed creation
    pid = wt_module.project_id(configured_repo)
    assert wt_module.load_state(pid)["slots"] == {}


def test_new_concurrent_calls_get_distinct_slots(
    configured_repo, wt_module
):
    """Two concurrent `wt new` calls must end up with different slots and
    different names. The flock makes name+slot allocation atomic."""
    import threading
    results: list[tuple[str, int] | Exception] = []
    lock = threading.Lock()

    def go():
        try:
            r = wt_module.cmd_new(name=None, branch=None, from_=None,
                                  run_setup=False, start_dir=configured_repo)
            pid = wt_module.project_id(configured_repo)
            state = wt_module.load_state(pid)
            with lock:
                results.append(("ok", r, state))
        except Exception as e:
            with lock:
                results.append(e)

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads: t.start()
    for t in threads: t.join()

    # Both should have succeeded
    assert all(isinstance(r, tuple) and r[0] == "ok" for r in results), results
    pid = wt_module.project_id(configured_repo)
    state = wt_module.load_state(pid)
    # Two distinct slots allocated
    assert len(state["slots"]) == 2, state
    names = {entry["name"] for entry in state["slots"].values()}
    assert len(names) == 2, names
