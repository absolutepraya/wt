import pytest


def test_cities_list_has_at_least_50_entries(wt_module):
    assert len(wt_module.CITIES) >= 50


def test_word_pair_lists_have_at_least_50_entries(wt_module):
    assert len(wt_module.ADJECTIVES) >= 50
    assert len(wt_module.NOUNS) >= 50


def test_generate_cities_returns_a_known_city(wt_module):
    name = wt_module.generate_name("cities", used=set())
    assert name in wt_module.CITIES


def test_generate_word_pairs_returns_two_words(wt_module):
    name = wt_module.generate_name("word_pairs", used=set())
    parts = name.split("-")
    assert len(parts) == 2
    assert parts[0] in wt_module.ADJECTIVES
    assert parts[1] in wt_module.NOUNS


def test_generate_avoids_used_names(wt_module, monkeypatch):
    """When most cities are taken, the generator should still find a free one."""
    used = set(wt_module.CITIES[:-1])  # only the last city is free
    name = wt_module.generate_name("cities", used=used)
    assert name == wt_module.CITIES[-1]


def test_generate_falls_back_when_all_used(wt_module):
    """If every candidate collides on 5 tries, fall back to <token>-<hex>."""
    used = set(wt_module.CITIES)
    name = wt_module.generate_name("cities", used=used)
    parts = name.rsplit("-", 1)
    assert len(parts) == 2
    assert parts[0] in wt_module.CITIES
    assert len(parts[1]) == 4
    assert all(c in "0123456789abcdef" for c in parts[1])


def test_generate_unknown_strategy_raises(wt_module):
    with pytest.raises(ValueError, match="strategy"):
        wt_module.generate_name("pokemon", used=set())
