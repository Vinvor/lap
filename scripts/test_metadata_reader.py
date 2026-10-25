#!/usr/bin/env python3
"""Run the real metadata/XMP modules against fixtures and in-memory SQLite.

The isolated harness avoids linking Tauri and native image/ML libraries. It
does not exercise the app's SQLite file scanner or platform packaging.

Run from the repository: python3 scripts/test_metadata_reader.py
Set LAP_TEST_EXIFTOOL=1 to also verify output with an installed ExifTool.
Cargo uses cached dependencies (--offline); the generated project is temporary.
The real rename_exclusive implementation is included to test publication on the
host platform. Frontend action tests: cd src-vite && npm run test:xmp.
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
exiftool-rs = { version = "=0.14.0", default-features = false }
flate2 = "1"
memmap2 = "0.9"
libc = "0.2"
[target.'cfg(windows)'.dependencies]
windows = { version = "0.61.3", default-features = false, features = ["Win32_Foundation", "Win32_Storage_FileSystem"] }
''')
    shutil.copyfile(root / "src-tauri/Cargo.lock", work / "Cargo.lock")
    # Exercise the actual platform publication primitive without importing the
    # unrelated catalog/UI dependencies of the batch rename module.
    rename_source = (root / "src-tauri/src/t_batch_rename.rs").read_text()
    begin = "// METADATA_HARNESS_RENAME_BEGIN"
    end = "// METADATA_HARNESS_RENAME_END"
    assert rename_source.count(begin) == rename_source.count(end) == 1, "rename harness markers missing or duplicated"
    assert rename_source.index(begin) < rename_source.index(end), "rename harness markers out of order"
    rename_fn = rename_source.split(begin, 1)[1].split(end, 1)[0]
    (work / "src/t_batch_rename.rs").write_text("use std::path::Path;\n" + rename_fn)
    modules = '\n'.join(
        f'#[path={json.dumps(str(root / "src-tauri/src" / (name + ".rs")))}] mod {name};'
        for name in ("t_xmp", "t_metadata")
    )
    (work / "src/lib.rs").write_text('''#![allow(dead_code)]
mod t_batch_rename;
mod t_utils { pub fn is_cloud_only(_: &std::fs::Metadata) -> bool { false } }
mod t_sqlite {
    pub fn open_conn() -> Result<rusqlite::Connection, String> {
        Err("Use explicit in-memory connections in this harness".into())
    }
}
''' + modules)
    subprocess.run(["cargo", "test", "--offline", "--manifest-path", str(work / "Cargo.toml")], check=True)
