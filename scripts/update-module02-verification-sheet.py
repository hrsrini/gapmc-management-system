"""
Module_02 verification rows are maintained by the consolidated workbook sync.

Run (from repo root):
  python scripts/sync-requirement-verification-workbook.py
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    sync = ROOT / "scripts" / "sync-requirement-verification-workbook.py"
    subprocess.run([sys.executable, str(sync)], check=True)


if __name__ == "__main__":
    main()
