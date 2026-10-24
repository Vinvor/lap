//! Read-only embedded metadata. Existing EXIF/LibRaw values remain authoritative.
//! Keep the backend boundary here so unsupported formats never prevent import.
use exiftool_rs::{ExifTool, Options, Tag, Value};
use std::path::Path;

#[derive(Clone, Debug, Default)]
pub struct Metadata {
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub date: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude: Option<f64>,
    pub organization: crate::t_xmp::XmpMetadata,
}

// A single entry per scanning thread avoids parsing twice (file info + DB import).
// Cache only mapped values, not the potentially large full tag collection.
thread_local! {
    static LAST: std::cell::RefCell<Option<(String, Metadata)>> = const { std::cell::RefCell::new(None) };
}

pub fn read(path: &Path) -> Metadata {
    let Ok(info) = std::fs::metadata(path) else {
        return Metadata::default();
    };
    if crate::t_utils::is_cloud_only(&info) {
        return Metadata::default();
    }
    let key = format!(
        "{}:{:?}:{}",
        path.display(),
        info.modified().ok(),
        info.len()
    );
    LAST.with(|cache| {
        if let Some((previous, values)) = cache.borrow().as_ref() {
            if previous == &key {
                return values.clone();
            }
        }
        let options = Options {
            duplicates: true,
            ..Options::default()
        };
        let values = match ExifTool::with_options(options).extract_info(path) {
            Ok(tags) => from_tags(&tags),
            Err(_) => Metadata::default(), // Existing readers still handle this format.
        };
        *cache.borrow_mut() = Some((key, values.clone()));
        values
    })
}

fn text(tag: &Tag) -> Option<String> {
    match &tag.raw_value {
        Value::String(value) if !value.trim().is_empty() && !value.contains('\0') => {
            Some(value.trim().to_owned())
        }
        _ => None,
    }
}

fn source_rank(tag: &Tag) -> u8 {
    match tag.group.family0.as_str() {
        "XMP" => 0,
        "IPTC" => 1,
        "EXIF" => 2,
        _ => 3,
    }
}

fn from_tags(tags: &[Tag]) -> Metadata {
    let string = |name: &str| {
        tags.iter()
            .filter(|t| t.name == name)
            .filter_map(|t| text(t).map(|value| (source_rank(t), value)))
            .min_by_key(|(rank, _)| *rank)
            .map(|(_, value)| value)
    };
    // Only accept complete coordinate pairs from the same metadata directory.
    let mut gps = None;
    for lat in tags.iter().filter(|t| t.name == "GPSLatitude") {
        let Some(lon) = tags
            .iter()
            .find(|t| t.name == "GPSLongitude" && t.group.family1 == lat.group.family1)
        else {
            continue;
        };
        let reference = |name: &str| {
            tags.iter()
                .find(|t| t.name == name && t.group.family1 == lat.group.family1)
                .and_then(text)
        };
        if let (Some(a), Some(b)) = (
            coordinate(&lat.raw_value, reference("GPSLatitudeRef").as_deref(), 90.0),
            coordinate(
                &lon.raw_value,
                reference("GPSLongitudeRef").as_deref(),
                180.0,
            ),
        ) {
            gps = Some((a, b));
            break;
        }
    }
    let mut organization = crate::t_xmp::XmpMetadata::default();
    // Ignore synthetic MakerNote zero ratings: absence must not become a clear.
    let rating = tags
        .iter()
        .filter(|t| t.name == "Rating")
        .filter_map(|tag| {
            let value = tag.raw_value.to_display_string().parse::<i32>().ok()?;
            let trusted = matches!(tag.group.family0.as_str(), "XMP" | "EXIF")
                || (tag.group.family0 == "MakerNotes" && value > 0);
            (trusted && (-1..=5).contains(&value)).then_some((source_rank(tag), value))
        })
        .min_by_key(|(rank, _)| *rank);
    if let Some((_, value)) = rating {
        organization.rating = Some(value.max(0));
        if value == -1 {
            organization.culling_flag = Some(2);
        }
    }
    let mut keywords = Vec::new();
    for tag in tags.iter().filter(|t| {
        matches!(
            t.name.as_str(),
            "Subject" | "Keywords" | "HierarchicalSubject" | "TagsList"
        ) && matches!(t.group.family0.as_str(), "XMP" | "IPTC")
    }) {
        collect_strings(&tag.raw_value, &mut keywords);
    }
    // XPKeywords is UTF-16LE, never the backend's numeric display string.
    for tag in tags.iter().filter(|t| t.name == "XPKeywords") {
        if let Some(value) = xp_keywords(&tag.raw_value) {
            for word in value.split(';') {
                push_keyword(word, &mut keywords);
            }
        }
    }
    if !keywords.is_empty() {
        organization.tags = Some(keywords);
    }
    organization.description = string("Description")
        .or_else(|| string("Caption-Abstract"))
        .or_else(|| string("UserComment"));
    Metadata {
        make: string("Make"),
        model: string("Model"),
        lens_make: string("LensMake"),
        lens_model: string("LensModel"),
        date: string("DateTimeOriginal"),
        latitude: gps.map(|(a, _)| a),
        longitude: gps.map(|(_, b)| b),
        // Altitude reference differs between EXIF and composite output; leave it
        // to the established reader until source-aware conversion is verified.
        altitude: None,
        organization,
    }
}

fn push_keyword(word: &str, words: &mut Vec<String>) {
    let word = word.trim();
    if !word.is_empty()
        && !word.contains('\0')
        && !word.eq_ignore_ascii_case("darktable")
        && !word.to_ascii_lowercase().starts_with("darktable|")
        && !words.iter().any(|w| w == word)
    {
        words.push(word.to_owned());
    }
}

fn collect_strings(value: &Value, words: &mut Vec<String>) {
    match value {
        Value::String(word) => push_keyword(word, words),
        Value::List(values) => {
            for value in values {
                collect_strings(value, words);
            }
        }
        _ => {}
    }
}

fn xp_keywords(value: &Value) -> Option<String> {
    let bytes = match value {
        Value::Binary(v) | Value::Undefined(v) => v.clone(),
        Value::List(v) => v
            .iter()
            .map(|v| match v {
                Value::U8(b) => Some(*b),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?,
        Value::String(v) => return Some(v.trim_end_matches('\0').to_owned()),
        _ => return None,
    };
    if bytes.len() % 2 != 0 {
        return None;
    }
    let utf16: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .take_while(|c| *c != 0)
        .collect();
    String::from_utf16(&utf16).ok()
}

fn coordinate(value: &Value, reference: Option<&str>, limit: f64) -> Option<f64> {
    let number = |v: &Value| v.to_display_string().parse::<f64>().ok();
    let mut value = match value {
        Value::List(parts) if parts.len() == 3 => {
            number(&parts[0])? + number(&parts[1])? / 60.0 + number(&parts[2])? / 3600.0
        }
        _ => number(value)?,
    };
    if reference.is_some_and(|r| matches!(r, "S" | "W" | "South" | "West")) {
        value = -value.abs();
    }
    (value.is_finite() && value.abs() <= limit).then_some(value)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[test]
    fn keywords_preserve_commas_and_ignore_numeric_garbage() {
        let mut words = Vec::new();
        collect_strings(
            &Value::List(vec![
                Value::String("Paris, France".into()),
                Value::String("darktable|internal".into()),
                Value::U8(0),
            ]),
            &mut words,
        );
        assert_eq!(words, ["Paris, France"]);
        assert_eq!(
            xp_keywords(&Value::Binary(vec![0; 10])).as_deref(),
            Some("")
        );
    }
    #[test]
    fn coordinates_are_validated_and_signed() {
        assert_eq!(coordinate(&Value::F64(181.0), None, 180.0), None);
        assert_eq!(coordinate(&Value::F64(f64::NAN), None, 90.0), None);
        assert_eq!(
            coordinate(
                &Value::List(vec![Value::U8(30), Value::U8(30), Value::U8(0)]),
                Some("S"),
                90.0
            ),
            Some(-30.5)
        );
    }

    pub(crate) fn jpeg_with_xmp() -> Vec<u8> {
        let xmp = br#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="4"><dc:subject><rdf:Bag><rdf:li>Paris, France</rdf:li><rdf:li>Travel</rdf:li></rdf:Bag></dc:subject><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Embedded caption</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta>"#;
        let mut payload = b"http://ns.adobe.com/xap/1.0/\0".to_vec();
        payload.extend(xmp);
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe1];
        jpeg.extend(((payload.len() + 2) as u16).to_be_bytes());
        jpeg.extend(payload);
        jpeg.extend([0xff, 0xd9]);
        jpeg
    }

    #[test]
    fn reads_embedded_xmp_without_splitting_keyword_commas() {
        let tags = ExifTool::new()
            .extract_info_from_bytes(&jpeg_with_xmp(), Path::new("synthetic.jpg"))
            .unwrap();
        let metadata = from_tags(&tags);
        assert_eq!(metadata.organization.rating, Some(4));
        assert_eq!(
            metadata.organization.tags,
            Some(vec!["Paris, France".into(), "Travel".into()])
        );
        assert_eq!(
            metadata.organization.description.as_deref(),
            Some("Embedded caption")
        );
    }

    #[test]
    fn unsupported_format_is_nonfatal() {
        let path = std::env::temp_dir().join(format!("lap-unsupported-{}.bin", std::process::id()));
        std::fs::write(&path, b"not a supported media container").unwrap();
        assert_eq!(
            read(&path).organization,
            crate::t_xmp::XmpMetadata::default()
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_orf_camera_make() {
        // Regression for upstream #24: ORF uses 0x4f52 instead of TIFF's 42.
        let data = [
            b'I', b'I', 0x52, 0x4f, 8, 0, 0, 0, 1, 0, 0x0f, 1, 2, 0, 4, 0, 0, 0, b'O', b'M', 0, 0,
            0, 0, 0, 0,
        ];
        let tags = ExifTool::new()
            .extract_info_from_bytes(&data, Path::new("synthetic.orf"))
            .unwrap();
        assert_eq!(from_tags(&tags).make.as_deref(), Some("OM"));
    }

    #[test]
    fn reads_iptc_keywords_and_caption() {
        let mut iim = Vec::new();
        for (dataset, value) in [
            (25u8, "Paris, France"),
            (25, "Travel"),
            (120, "IPTC caption"),
        ] {
            iim.extend([0x1c, 2, dataset]);
            iim.extend((value.len() as u16).to_be_bytes());
            iim.extend(value.as_bytes());
        }
        let mut payload = b"Photoshop 3.0\0".to_vec();
        payload.extend(b"8BIM\x04\x04\0\0");
        payload.extend((iim.len() as u32).to_be_bytes());
        payload.extend(&iim);
        if iim.len() % 2 != 0 {
            payload.push(0);
        }
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xed];
        jpeg.extend(((payload.len() + 2) as u16).to_be_bytes());
        jpeg.extend(payload);
        jpeg.extend([0xff, 0xd9]);
        let tags = ExifTool::new()
            .extract_info_from_bytes(&jpeg, Path::new("iptc.jpg"))
            .unwrap();
        let meta = from_tags(&tags).organization;
        assert_eq!(
            meta.tags,
            Some(vec!["Paris, France".into(), "Travel".into()])
        );
        assert_eq!(meta.description.as_deref(), Some("IPTC caption"));
    }

    #[test]
    fn decodes_utf16_xp_keywords() {
        let bytes = "旅行;Paris\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(
            xp_keywords(&Value::Binary(bytes)).as_deref(),
            Some("旅行;Paris")
        );
        assert_eq!(xp_keywords(&Value::Binary(vec![0])), None);
    }

    #[test]
    fn maker_note_zero_does_not_clear_a_rating() {
        let tags = ExifTool::new()
            .extract_info_from_bytes(&jpeg_with_xmp(), Path::new("rating.jpg"))
            .unwrap();
        let mut rating = tags.into_iter().find(|t| t.name == "Rating").unwrap();
        rating.group.family0 = "MakerNotes".into();
        rating.raw_value = Value::U8(0);
        assert_eq!(from_tags(&[rating.clone()]).organization.rating, None);
        rating.raw_value = Value::U8(3);
        assert_eq!(from_tags(&[rating.clone()]).organization.rating, Some(3));
        rating.raw_value = Value::U8(6);
        assert_eq!(from_tags(&[rating]).organization.rating, None);
    }
}
