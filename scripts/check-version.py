#!/usr/bin/env python3
"""Check that the package and standalone CLI expose the same version."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def _cli_version() -> str:
    tree = ast.parse((ROOT / "bin" / "wt").read_text(), filename="bin/wt")
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if any(
            isinstance(target, ast.Name) and target.id == "VERSION"
            for target in node.targets
        ):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                return node.value.value
    raise ValueError("bin/wt does not define VERSION as a string")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--print",
        action="store_true",
        dest="print_version",
        help="print the shared version after validation",
    )
    args = parser.parse_args()

    package_version = json.loads((ROOT / "package.json").read_text())["version"]
    cli_version = _cli_version()
    if package_version != cli_version:
        print(
            f"version mismatch: package.json={package_version!r}, "
            f"bin/wt={cli_version!r}",
            file=sys.stderr,
        )
        return 1

    if args.print_version:
        print(package_version)
    else:
        print(f"version metadata is consistent: {package_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
