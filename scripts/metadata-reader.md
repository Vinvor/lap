# Embedded metadata reader

Lap supplements its existing EXIF, LibRaw and video readers with the pinned
`exiftool-rs 0.14.0` Rust library. No Perl or external ExifTool process is bundled.
The extraction backend is read-only; it never writes media or sidecars.
Manual **Save Metadata to XMP** writes ratings, culling flags, comments and tags
using Lap’s independent XML writer. It preserves unrelated properties and never
writes the original media. There is no automatic sidecar export.

This is an internal implementation and validation note, not website content.

## Import policy

- Existing technical fields win. Deep extraction fills missing camera, lens,
  original capture date and complete latitude/longitude pairs before geocoding.
- Automatic organization metadata import uses the existing XMP import setting.
  Ratings, pick/reject flags, keywords and descriptions may now come from embedded
  XMP/IPTC/EXIF. Sidecar properties take precedence, including explicit empties.
- The existing non-destructive import mode and dirty bits protect local edits
  and clears. This is fill-empty/merge behavior, not bidirectional synchronization.
- Scan and file-info refresh import automatically when enabled. Refresh bypasses
  fingerprints while retaining local-edit protection; the overwrite-import menu
  action has been removed.
- Media and sidecar timestamps/sizes are recorded together. Unchanged scans skip
  organization extraction; an upgrade backfills embedded organization metadata
  once. Technical-field backfills require a file-info refresh/rescan that actually
  re-extracts file info, not just an unchanged folder scan.
- A per-thread, single-file mapped-value cache avoids the duplicate extraction
  between file-info construction and organization import. Cloud-only files are
  not hydrated by this backend. Unsupported formats fall back to existing readers.
- Unknown fields are not persisted. Hierarchical keyword strings use the existing
  flat tag model. No new hierarchy or full metadata inspector is promised here.

## Known limits and upstream cooperation

ORF IIRO header support is fixed in the pinned 0.14.0 version and covered by a
26-byte synthetic camera-make regression. All 45 formerly failing local ORF
samples read successfully in the 0.14.0 comparison. Original upstream report:
https://github.com/Le-Syl21/exiftool-rs/issues/24

Local comparisons also found missing video GPS and some lens fields. Existing
values must not be replaced by these missing values. GPS altitude remains with
the established reader pending verified sign/reference handling. Numeric XP tag
display strings must never become keywords; XPKeywords is decoded as UTF-16LE.
Synthetic MakerNote zero ratings are ignored. Source groups are retained during
mapping to avoid name-only duplicate selection for ratings and organization fields.

Historical reports from the 0.14.0 comparison (links retained for traceability;
this is not a statement of their current upstream status):
- XMP numeric GPS normalization: https://github.com/Le-Syl21/exiftool-rs/issues/25
- QuickTime GPS composites: https://github.com/Le-Syl21/exiftool-rs/issues/26
- XPKeywords text decoding: https://github.com/Le-Syl21/exiftool-rs/issues/27
- Samsung lens field mapping: https://github.com/Le-Syl21/exiftool-rs/issues/28

## Validation

`python3 scripts/test_metadata_reader.py` compiles the actual reader and XMP
modules in an isolated harness and runs parsing fixtures plus in-memory SQLite
regressions. The filesystem cloud-state check and global DB opener are stubbed;
the full file scanner and UI are not covered by this harness. The actual platform
`rename_exclusive` function is included using checked source markers.

Set `LAP_TEST_EXIFTOOL=1` to independently read exported values with an installed
ExifTool. Run frontend action tests with `cd src-vite && npm run test:xmp`.

`cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` validates
the complete application on the host platform. Windows/Linux builds and installer
execution still require the normal platform CI; host checks do not prove them.

Tests cover embedded JPEG XMP, comma-containing keywords, numeric garbage,
coordinate bounds/signs, unsupported formats, sidecar priority and protection of
local clears, alongside the existing sidecar suite.

The library is GPL-3.0-or-later, matching Lap. Release source archives must include
the pinned dependency and its notices in addition to Lap's build sources.

## Export compatibility

The catalog has flat tag strings. Existing `lr:hierarchicalSubject` and
`digiKam:TagsList` stores are synchronized to those exact strings, including
literal `A|B|C` paths, so removed tags cannot reappear on import. No hierarchy is
inferred. Only an existing `darktable:rejected` field is synchronized; it is not
introduced into other applications’ sidecars.

The catalog snapshot transaction ends before sidecar I/O begins. Embedded
metadata parsing shares a read-only file mapping with URI-aware XMP parsing;
only mapping failures fall back to a full file read, matching the backend.

Batch exports build one directory index per visited folder, shared by sidecar
lookup and RAW/JPEG stem ambiguity checks. Successful publications update that
index; the index is dropped at the end of the batch. Discovery work is therefore
linear in visited directory entries plus selected files, rather than repeating
whole-directory enumeration for every selected file.

Multi-selection refreshes create a library-bound index session before the first
file and release it in the dialog's `finally` block, including cancellation and
partial failures. Each background command enters the same index scope even when
it runs on a different worker thread. Abandoned sessions are capped and reclaimed
on subsequent batch creation. Single-file refresh commands remain compatible.

Only direct photo-subject RDF Description properties are imported; nested and
identified resources remain preserved XML rather than becoming photo metadata.
JPEG 2000 UUID XMP packets use the same bounded container extraction as other
supported ISO box formats.

A non-unique `atags(name COLLATE NOCASE)` index supports case-insensitive tag
lookup without merging or rejecting existing differently-cased tag rows. Existing
libraries build this index once during schema initialization.
