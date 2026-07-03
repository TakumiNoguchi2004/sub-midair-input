"""Project setup validator for the Mid-Air input workspace."""

from __future__ import annotations

import argparse
import importlib
import json
import os
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DATA_DIR = Path(os.environ.get("MIDAIR_DATA_DIR") or (REPO_ROOT / "data"))
MEDIAPIPE_FILES = (
    "vision_bundle.mjs",
    "hand_landmarker.task",
    "wasm/vision_wasm_internal.js",
    "wasm/vision_wasm_internal.wasm",
    "wasm/vision_wasm_module_internal.js",
    "wasm/vision_wasm_module_internal.wasm",
    "wasm/vision_wasm_nosimd_internal.js",
    "wasm/vision_wasm_nosimd_internal.wasm",
)
IMPORTS = (
    "midair_app",
    "midair_web",
    "midair_web.app",
    "midair_shared",
    "emoji_search",
    "japanese_search",
    "english_search",
    "fastapi",
    "uvicorn",
    "faiss",
    "numpy",
    "PIL",
    "torch",
    "transformers",
)


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def _ok(name: str, detail: str) -> Check:
    return Check(name, True, detail)


def _fail(name: str, detail: str) -> Check:
    return Check(name, False, detail)


def _format_size(path: Path) -> str:
    size = path.stat().st_size
    for unit in ("B", "KiB", "MiB", "GiB"):
        if size < 1024 or unit == "GiB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{path.stat().st_size} B"


def check_imports() -> list[Check]:
    checks: list[Check] = []
    for module in IMPORTS:
        try:
            importlib.import_module(module)
        except Exception as exc:  # noqa: BLE001 - show the concrete setup failure.
            checks.append(_fail(f"import {module}", f"{type(exc).__name__}: {exc}"))
        else:
            checks.append(_ok(f"import {module}", "ok"))
    return checks


def check_file(path: Path, label: str) -> Check:
    if not path.is_file():
        return _fail(label, f"missing: {path}")
    if path.stat().st_size <= 0:
        return _fail(label, f"empty file: {path}")
    return _ok(label, f"{path} ({_format_size(path)})")


def check_json(path: Path, label: str) -> Check:
    file_check = check_file(path, label)
    if not file_check.ok:
        return file_check
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - report invalid setup data.
        return _fail(label, f"invalid JSON: {path} ({type(exc).__name__}: {exc})")
    return file_check


def check_emoji_data(data_dir: Path) -> list[Check]:
    emoji_dir = data_dir / "emoji_search"
    openmoji_dir = emoji_dir / "openmoji"
    checks = [
        check_json(emoji_dir / "openmoji.json", "OpenMoji metadata"),
        check_file(emoji_dir / "index.faiss", "FAISS index"),
        check_file(emoji_dir / "metadata.jsonl", "FAISS metadata"),
        check_json(emoji_dir / "index_meta.json", "FAISS index metadata"),
    ]
    if not openmoji_dir.is_dir():
        checks.append(_fail("OpenMoji images", f"missing directory: {openmoji_dir}"))
    else:
        try:
            sample = next(openmoji_dir.glob("*.png"))
        except StopIteration:
            checks.append(_fail("OpenMoji images", f"no PNG files found: {openmoji_dir}"))
        else:
            checks.append(_ok("OpenMoji images", f"found PNG files, sample: {sample.name}"))
    return checks


def _web_static_dir() -> Path:
    module = importlib.import_module("midair_web")
    return Path(module.__file__).resolve().parent / "static"


def check_mediapipe_assets() -> list[Check]:
    try:
        static_dir = _web_static_dir()
    except Exception as exc:  # noqa: BLE001 - import failure is the useful detail here.
        return [_fail("Web static directory", f"{type(exc).__name__}: {exc}")]

    vendor_dir = static_dir / "vendor" / "mediapipe"
    return [check_file(vendor_dir / rel, f"MediaPipe {rel}") for rel in MEDIAPIPE_FILES]


def check_web_minimum() -> list[Check]:
    try:
        static_dir = _web_static_dir()
    except Exception as exc:  # noqa: BLE001 - import failure is the useful detail here.
        return [_fail("Web static directory", f"{type(exc).__name__}: {exc}")]

    checks = [check_file(static_dir / "index.html", "Web index.html")]
    try:
        from midair_web.__main__ import pick_port

        port = pick_port("127.0.0.1", 8762)
    except Exception as exc:  # noqa: BLE001 - report environment-specific socket failures.
        checks.append(_fail("Web port check", f"{type(exc).__name__}: {exc}"))
    else:
        checks.append(_ok("Web port check", f"127.0.0.1:{port} is available for startup"))
    return checks


def run_checks(data_dir: Path) -> list[Check]:
    checks: list[Check] = []
    checks.extend(check_imports())
    checks.extend(check_emoji_data(data_dir))
    checks.extend(check_mediapipe_assets())
    checks.extend(check_web_minimum())
    return checks


def print_checks(checks: list[Check]) -> None:
    width = max(len(check.name) for check in checks) if checks else 0
    for check in checks:
        mark = "OK" if check.ok else "NG"
        print(f"[{mark}] {check.name:<{width}}  {check.detail}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="midair-doctor",
        description="Mid-Air input のローカル環境が実行可能な状態か検証する",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help="データルート (既定: MIDAIR_DATA_DIR または <repo>/data)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checks = run_checks(args.data_dir)
    print_checks(checks)
    failed = [check for check in checks if not check.ok]
    if failed:
        print(f"\n{len(failed)} check(s) failed.")
        raise SystemExit(1)
    print("\nAll setup checks passed.")


if __name__ == "__main__":
    main()
