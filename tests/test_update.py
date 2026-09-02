import hashlib
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def _checksums(payloads: dict[str, bytes]) -> bytes:
    return "".join(
        f"{hashlib.sha256(payload).hexdigest()}  {name}\n"
        for name, payload in payloads.items()
    ).encode()


def test_update_refuses_to_mutate_a_source_checkout(wt_module):
    with pytest.raises(wt_module.UpdateError, match="source checkout"):
        wt_module.cmd_update(check=False)


def test_update_refuses_to_mutate_an_npm_install(wt_module, monkeypatch):
    monkeypatch.setenv("WT_INSTALL_CHANNEL", "npm")

    with pytest.raises(wt_module.UpdateError, match="npm-managed"):
        wt_module.cmd_update(check=True)


def test_update_check_reports_a_stable_release_without_downloading(
    wt_module, monkeypatch, tmp_path, capsys
):
    binary = tmp_path / "bin" / "wt"
    binary.parent.mkdir()
    binary.write_text("old cli")
    wrapper = tmp_path / "config" / "wt.sh"
    fish_wrapper = tmp_path / "config" / "wt.fish"
    wrapper.parent.mkdir()
    wrapper.write_text("old wrapper")
    monkeypatch.setattr(
        wt_module,
        "_installation_paths",
        lambda: (binary, wrapper, fish_wrapper),
    )
    monkeypatch.setattr(
        wt_module,
        "_latest_release",
        lambda: ((0, 3, 2), "v0.3.2", {}),
    )

    assert wt_module.cmd_update(check=True) == 0
    assert capsys.readouterr().out == "wt 0.3.1 update available: v0.3.2.\n"
    assert binary.read_text() == "old cli"
    assert wrapper.read_text() == "old wrapper"


def test_update_verifies_and_installs_cli_and_wrapper(
    wt_module, monkeypatch, tmp_path, capsys
):
    binary = tmp_path / "bin" / "wt"
    binary.parent.mkdir()
    binary.write_text("old cli")
    wrapper = tmp_path / "config" / "wt.sh"
    fish_wrapper = tmp_path / "config" / "wt.fish"
    wrapper.parent.mkdir()
    wrapper.write_text("old wrapper")
    fish_wrapper.write_text("old fish wrapper")

    cli_payload = (ROOT / "bin" / "wt").read_text().replace(
        'VERSION = "0.3.1"', 'VERSION = "0.3.2"', 1
    ).encode()
    wrapper_payload = (ROOT / "shell" / "wt.sh").read_bytes()
    fish_wrapper_payload = (ROOT / "shell" / "wt.fish").read_bytes()
    update_payloads = {
        "wt": cli_payload,
        "wt.sh": wrapper_payload,
        "wt.fish": fish_wrapper_payload,
    }
    checksum_payload = _checksums(update_payloads)
    downloads = {
        "https://example.test/wt": cli_payload,
        "https://example.test/wt.sh": wrapper_payload,
        "https://example.test/wt.fish": fish_wrapper_payload,
        "https://example.test/checksums": checksum_payload,
    }

    monkeypatch.setattr(
        wt_module,
        "_installation_paths",
        lambda: (binary, wrapper, fish_wrapper),
    )
    monkeypatch.setattr(
        wt_module,
        "_latest_release",
        lambda: (
            (0, 3, 2),
            "v0.3.2",
            {
                "wt": "https://example.test/wt",
                "wt.sh": "https://example.test/wt.sh",
                "wt.fish": "https://example.test/wt.fish",
                "checksums.txt": "https://example.test/checksums",
            },
        ),
    )
    monkeypatch.setattr(
        wt_module,
        "_fetch_url",
        lambda url, **_kwargs: downloads[url],
    )

    assert wt_module.cmd_update(check=False) == 0
    assert 'VERSION = "0.3.2"' in binary.read_text()
    assert wrapper.read_bytes() == wrapper_payload
    assert fish_wrapper.read_bytes() == fish_wrapper_payload
    assert capsys.readouterr().out == "Updated wt from 0.3.1 to 0.3.2.\n"


def test_update_checksum_failure_leaves_installation_unchanged(
    wt_module, monkeypatch, tmp_path
):
    binary = tmp_path / "bin" / "wt"
    binary.parent.mkdir()
    binary.write_text("old cli")
    wrapper = tmp_path / "config" / "wt.sh"
    fish_wrapper = tmp_path / "config" / "wt.fish"
    wrapper.parent.mkdir()
    wrapper.write_text("old wrapper")
    fish_wrapper.write_text("old fish wrapper")
    bad_payloads = {
        "wt": b"not the release",
        "wt.sh": b"wt() { command wt; }",
        "wt.fish": b"function wt\n    command wt\nend\n",
    }
    bad_checksums = (
        f"{'0' * 64}  wt\n"
        f"{hashlib.sha256(bad_payloads['wt.sh']).hexdigest()}  wt.sh\n"
        f"{hashlib.sha256(bad_payloads['wt.fish']).hexdigest()}  wt.fish\n"
    ).encode()

    monkeypatch.setattr(
        wt_module,
        "_installation_paths",
        lambda: (binary, wrapper, fish_wrapper),
    )
    monkeypatch.setattr(
        wt_module,
        "_latest_release",
        lambda: (
            (0, 3, 2),
            "v0.3.2",
            {
                "wt": "https://example.test/wt",
                "wt.sh": "https://example.test/wt.sh",
                "wt.fish": "https://example.test/wt.fish",
                "checksums.txt": "https://example.test/checksums",
            },
        ),
    )
    monkeypatch.setattr(
        wt_module,
        "_fetch_url",
        lambda url, **_kwargs: {
            "https://example.test/wt": b"not the release",
            "https://example.test/wt.sh": b"wt() { command wt; }",
            "https://example.test/wt.fish": bad_payloads["wt.fish"],
            "https://example.test/checksums": bad_checksums,
        }[url],
    )

    with pytest.raises(wt_module.UpdateError, match="checksum"):
        wt_module.cmd_update(check=False)
    assert binary.read_text() == "old cli"
    assert wrapper.read_text() == "old wrapper"
