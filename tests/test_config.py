import pytest
from pathlib import Path


def test_load_config_from_repo_root(tmp_repo, wt_module, write_config):
    write_config('worktree_path = ".wt-trees"\nport_offset_interval = 100\n')
    cfg = wt_module.load_config(tmp_repo)
    assert cfg.worktree_path == ".wt-trees"
    assert cfg.port_offset_interval == 100


def test_load_config_from_subdir_walks_up(tmp_repo, wt_module, write_config):
    write_config('worktree_path = ".w"\n')
    sub = tmp_repo / "src" / "deep"
    sub.mkdir(parents=True)
    cfg = wt_module.load_config(sub)
    assert cfg.worktree_path == ".w"


def test_defaults_when_fields_omitted(tmp_repo, wt_module, write_config):
    write_config("")  # empty config file
    cfg = wt_module.load_config(tmp_repo)
    assert cfg.worktree_path == ".worktrees"
    assert cfg.port_offset_interval == 10
    assert cfg.max_slots == 20
    assert cfg.name_strategy == "cities"
    assert cfg.branch_template == "{user}/{name}"
    assert cfg.default_base == "origin/main"
    assert cfg.setup == []
    assert cfg.teardown == []


def test_no_config_file_raises(tmp_repo, wt_module):
    with pytest.raises(wt_module.ConfigNotFound):
        wt_module.load_config(tmp_repo)


def test_invalid_name_strategy_raises(tmp_repo, wt_module, write_config):
    write_config('name_strategy = "pokemon"\n')
    with pytest.raises(wt_module.ConfigError, match="name_strategy"):
        wt_module.load_config(tmp_repo)


def test_invalid_default_base_raises(tmp_repo, wt_module, write_config):
    write_config('default_base = "main"\n')  # missing `<remote>/`
    with pytest.raises(wt_module.ConfigError, match="default_base"):
        wt_module.load_config(tmp_repo)
