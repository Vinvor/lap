#!/usr/bin/env python3
"""Run the real metadata/XMP modules against fixtures and in-memory SQLite.

The isolated harness avoids linking Tauri and native image/ML libraries. It
does not exercise the app's SQLite file scanner or platform packaging.
"""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="lap-metadata-tests-") as directory:
    work = Path(directory)
    (work / "src").mkdir()
    (work / "Cargo.toml").write_text('''[package]
name = "lap-metadata-tests"
version = "0.1.0"
edition = "2024"
[dependencies]
quick-xml = "0.37.5"
rusqlite = { version = "0.32.1", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
exiftool-rs = "=0.13.0"
''')
    shutil.copyfile(root / "src-tauri/Cargo.lock", work / "Cargo.lock")
    modules = '\n'.join(
        f'#[path={json.dumps(str(root / "src-tauri/src" / (name + ".rs")))}] mod {name};'
        for name in ("t_xmp", "t_metadata")
    )
    (work / "src/lib.rs").write_text('''#![allow(dead_code)]
mod t_utils { pub fn is_cloud_only(_: &std::fs::Metadata) -> bool { false } }
mod t_sqlite {
    pub fn open_conn() -> Result<rusqlite::Connection, String> {
        Err("Use explicit in-memory connections in this harness".into())
    }
}
''' + modules)
    subprocess.run(["cargo", "test", "--offline", "--manifest-path", str(work / "Cargo.toml")], check=True)
