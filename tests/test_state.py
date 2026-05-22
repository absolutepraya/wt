from pathlib import Path
import json
import pytest


def test_project_id_includes_basename(wt_module):
    pid = wt_module.project_id(Path("/Users/abhip/Projects/smart-invoice-reminder-ai"))
    assert pid.startswith("smart-invoice-reminder-ai-")


def test_project_id_is_deterministic(wt_module):
    p = Path("/Users/abhip/Projects/smart-invoice-reminder-ai")
    assert wt_module.project_id(p) == wt_module.project_id(p)


def test_project_id_differs_for_different_paths(wt_module):
    a = wt_module.project_id(Path("/a/foo"))
    b = wt_module.project_id(Path("/b/foo"))
    assert a != b
    # but the basename is the same prefix
    assert a.startswith("foo-") and b.startswith("foo-")


def test_project_id_hash_is_8_chars(wt_module):
    pid = wt_module.project_id(Path("/x/myrepo"))
    suffix = pid.split("-")[-1]
    assert len(suffix) == 8
    assert all(c in "0123456789abcdef" for c in suffix)


def test_state_paths_under_home_dot_wt(wt_module):
    pid = "myrepo-12345678"
    state, lock = wt_module.state_paths(pid)
    assert state.name == "myrepo-12345678.json"
    assert lock.name == "myrepo-12345678.lock"
    assert state.parent == lock.parent
    assert state.parent.name == ".wt"


def test_load_state_returns_empty_when_missing(wt_module):
    pid = "missing-12345678"
    state = wt_module.load_state(pid)
    assert state["slots"] == {}
    assert state["version"] == 1


def test_save_then_load_roundtrip(wt_module):
    pid = "round-12345678"
    saved = {
        "version": 1,
        "project_root": "/x/y",
        "slots": {"1": {"name": "adelaide", "branch": "abhip/adelaide",
                        "path": ".worktrees/adelaide", "base": "origin/main",
                        "created_at": "2026-05-09T00:00:00+00:00"}},
    }
    wt_module.save_state(pid, saved)
    loaded = wt_module.load_state(pid)
    assert loaded == saved


def test_allocate_lowest_free_slot(wt_module):
    pid = "alloc-12345678"
    # Existing state has slots 1, 3 -- next free is 2
    wt_module.save_state(pid, {
        "version": 1, "project_root": "/x", "slots": {
            "1": {"name": "a", "branch": "b", "path": ".w/a",
                  "base": "origin/main", "created_at": "t"},
            "3": {"name": "c", "branch": "d", "path": ".w/c",
                  "base": "origin/main", "created_at": "t"},
        },
    })
    slot = wt_module.allocate_slot(pid, max_slots=10, entry={
        "name": "x", "branch": "y", "path": ".w/x",
        "base": "origin/main", "created_at": "t",
    })
    assert slot == 2
    state = wt_module.load_state(pid)
    assert state["slots"]["2"]["name"] == "x"


def test_allocate_first_slot_is_one_not_zero(wt_module):
    """Slot 0 is reserved for the main worktree; allocations start at 1."""
    pid = "first-12345678"
    slot = wt_module.allocate_slot(pid, max_slots=10, entry={
        "name": "x", "branch": "y", "path": ".w/x",
        "base": "origin/main", "created_at": "t",
    })
    assert slot == 1


def test_allocate_raises_when_full(wt_module):
    pid = "full-12345678"
    slots = {
        str(i): {"name": f"n{i}", "branch": f"b{i}", "path": f".w/{i}",
                 "base": "origin/main", "created_at": "t"}
        for i in range(1, 4)
    }
    wt_module.save_state(pid, {"version": 1, "project_root": "/x", "slots": slots})
    with pytest.raises(wt_module.SlotsFull):
        wt_module.allocate_slot(pid, max_slots=3, entry={
            "name": "x", "branch": "y", "path": ".w/x",
            "base": "origin/main", "created_at": "t",
        })


def test_free_slot(wt_module):
    pid = "free-12345678"
    wt_module.save_state(pid, {"version": 1, "project_root": "/x", "slots": {
        "2": {"name": "x", "branch": "y", "path": ".w/x",
              "base": "origin/main", "created_at": "t"},
    }})
    wt_module.free_slot(pid, 2)
    assert wt_module.load_state(pid)["slots"] == {}
