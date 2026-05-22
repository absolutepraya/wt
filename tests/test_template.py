import pytest


def test_render_user_and_name(wt_module, monkeypatch):
    monkeypatch.setenv("USER", "abhip")
    out = wt_module.render_branch_template("{user}/{name}", name="adelaide")
    assert out == "abhip/adelaide"


def test_render_with_date(wt_module, monkeypatch):
    monkeypatch.setenv("USER", "abhip")
    out = wt_module.render_branch_template(
        "{user}/{date}-{name}", name="adelaide"
    )
    parts = out.split("/")[1].split("-")
    # parts[0..2] is YYYY-MM-DD, parts[3] is "adelaide"
    assert parts[3] == "adelaide"
    assert len(parts[0]) == 4  # YYYY


def test_unknown_token_raises(wt_module):
    with pytest.raises(KeyError):
        wt_module.render_branch_template("{user}/{nope}", name="x")
