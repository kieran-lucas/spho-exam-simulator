use crate::model::*;
use pulldown_cmark::{Event, Options, Parser, Tag};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Cursor, Read},
};

pub const MAX_ZIP: usize = 64 * 1024 * 1024;
const MAX_TOTAL: u64 = 128 * 1024 * 1024;
const MAX_FILE: u64 = 16 * 1024 * 1024;
const MAX_JSON: u64 = 8 * 1024 * 1024;
pub struct Asset {
    pub mime: String,
    pub bytes: Vec<u8>,
}
pub struct Package {
    pub manifest: Manifest,
    pub questions: Vec<Question>,
    pub solutions: Vec<Solution>,
    pub assets: BTreeMap<String, Asset>,
    pub hash: String,
}
pub fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.contains('%')
        && !path.chars().any(|c| c.is_control())
        && path.split('/').all(|p| {
            !p.is_empty() && p != "." && p != ".." && !p.ends_with(' ') && !p.ends_with('.')
        })
}
fn id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
pub fn read_package(bytes: &[u8]) -> AppResult<Package> {
    if bytes.len() > MAX_ZIP {
        return Err("ZIP exceeds the 64 MiB compressed limit".into());
    }
    let mut zip =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Invalid ZIP: {e}"))?;
    if zip.len() > 2000 {
        return Err("ZIP contains more than 2,000 entries".into());
    }
    let mut entries = BTreeMap::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| format!("ZIP entry {i}: {e}"))?;
        let name = file.name().to_string();
        let checked = name.trim_end_matches('/');
        if !safe_path(checked) {
            return Err(format!("Unsafe ZIP path: {name}"));
        }
        if file
            .unix_mode()
            .map(|m| m & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            return Err(format!("Symlink forbidden: {name}"));
        }
        if file.is_dir() {
            continue;
        }
        let is_json = matches!(
            name.as_str(),
            "manifest.json" | "questions.json" | "solutions.json"
        );
        let ext = name.rsplit('.').next().unwrap_or("");
        if !is_json && !(name.starts_with("assets/") && matches!(ext, "svg" | "png" | "webp")) {
            return Err(format!("Unsupported file: {name}; only root JSON files and assets/*.svg, *.png, *.webp are allowed"));
        }
        let limit = if is_json { MAX_JSON } else { MAX_FILE };
        total = total.checked_add(file.size()).ok_or("ZIP size overflow")?;
        if total > MAX_TOTAL || file.size() > limit {
            return Err(format!("Uncompressed size limit exceeded: {name}"));
        }
        if file.size() > 1024 * 1024 && file.size() > file.compressed_size().saturating_mul(200) {
            return Err(format!("Suspicious compression ratio (>200:1): {name}"));
        }
        let mut buf = Vec::new();
        (&mut file)
            .take(limit + 1)
            .read_to_end(&mut buf)
            .map_err(|e| format!("Corrupt ZIP entry {name}: {e}"))?;
        if buf.len() as u64 > limit {
            return Err(format!("File too large: {name}"));
        }
        if entries.insert(name.clone(), buf).is_some() {
            return Err(format!("Duplicate ZIP entry: {name}"));
        }
    }
    fn json<T: serde::de::DeserializeOwned>(
        entries: &BTreeMap<String, Vec<u8>>,
        name: &str,
    ) -> AppResult<T> {
        let bytes = entries.get(name).ok_or_else(|| format!("Missing {name}"))?;
        serde_json::from_slice(bytes).map_err(|e| format!("{name}: {e}"))
    }
    let manifest: Manifest = json(&entries, "manifest.json")?;
    let questions: Vec<Question> = json(&entries, "questions.json")?;
    let solutions: Vec<Solution> = json(&entries, "solutions.json")?;
    validate_models(&manifest, &questions, &solutions)?;
    let mut assets = BTreeMap::new();
    for (name, bytes) in &entries {
        if name.starts_with("assets/") {
            let mime = validate_asset(name, bytes).map_err(|e| {
                let refs = asset_contexts(&questions, &solutions, name);
                format!("{refs} — asset {name}: {e}")
            })?;
            assets.insert(
                name.clone(),
                Asset {
                    mime,
                    bytes: bytes.clone(),
                },
            );
        }
    }
    for q in &questions {
        validate_blocks(&q.stem, &format!("{} stem", q.id), &assets)?;
        for c in &q.choices {
            validate_blocks(&c.content, &format!("{} choice {}", q.id, c.key), &assets)?;
        }
    }
    for s in &solutions {
        validate_blocks(
            &s.explanation,
            &format!("{} explanation", s.question_id),
            &assets,
        )?;
        if let Some(b) = &s.shortcut {
            validate_blocks(b, &format!("{} shortcut", s.question_id), &assets)?;
        }
        if let Some(b) = &s.pitfalls {
            validate_blocks(b, &format!("{} pitfalls", s.question_id), &assets)?;
        }
    }
    // Content identity ignores ZIP compression/timestamps/file order. Names and bytes are length-framed.
    let mut digest = Sha256::new();
    for (name, bytes) in entries {
        digest.update((name.len() as u64).to_le_bytes());
        digest.update(name.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(&bytes);
    }
    Ok(Package {
        manifest,
        questions,
        solutions,
        assets,
        hash: format!("{:x}", digest.finalize()),
    })
}
fn asset_contexts(qs: &[Question], ss: &[Solution], name: &str) -> String {
    let references = |b: &[Block]| {
        b.iter()
            .any(|b| matches!(b,Block::Image{src,..} if src==name))
    };
    let mut ids = Vec::new();
    for q in qs {
        if references(&q.stem) || q.choices.iter().any(|c| references(&c.content)) {
            ids.push(q.id.clone());
        }
    }
    for s in ss {
        if references(&s.explanation)
            || s.shortcut.as_deref().is_some_and(references)
            || s.pitfalls.as_deref().is_some_and(references)
        {
            ids.push(s.question_id.clone());
        }
    }
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        "Unreferenced figure".into()
    } else {
        ids.join(", ")
    }
}
pub fn validate_models(m: &Manifest, qs: &[Question], ss: &[Solution]) -> AppResult<()> {
    if m.schema_version != "spho-exam/1.0" {
        return Err(format!(
            "Unsupported schemaVersion '{}'; expected spho-exam/1.0",
            m.schema_version
        ));
    }
    if !id_valid(&m.exam_id) {
        return Err("examId must contain 1–100 ASCII letters, digits, '-' or '_'".into());
    }
    if m.title.trim().is_empty() || m.title.len() > 500 || m.description.len() > 10000 {
        return Err("Invalid manifest title/description".into());
    }
    if !(1..=86400).contains(&m.duration_seconds) {
        return Err("durationSeconds must be an integer from 1 to 86400".into());
    }
    if m.question_count == 0 || m.question_count > 500 || m.question_count != qs.len() {
        return Err(format!(
            "Declared questionCount {} differs from actual {} (limit 500)",
            m.question_count,
            qs.len()
        ));
    }
    let mut sections = HashSet::new();
    if m.sections.is_empty() {
        return Err("At least one section is required".into());
    }
    for s in &m.sections {
        if !id_valid(&s.id) || s.title.trim().is_empty() || !sections.insert(s.id.as_str()) {
            return Err(format!("Invalid or duplicate section '{}'", s.id));
        }
        let count = qs.iter().filter(|q| q.section == s.id).count();
        if count != s.question_count || count == 0 {
            return Err(format!(
                "Section {} declares {} questions, found {count}",
                s.id, s.question_count
            ));
        }
    }
    let mut ids = HashSet::new();
    for q in qs {
        if !id_valid(&q.id) || !ids.insert(q.id.as_str()) {
            return Err(format!("Invalid or duplicate question ID '{}'", q.id));
        }
        if !sections.contains(q.section.as_str()) {
            return Err(format!("{} references unknown section {}", q.id, q.section));
        }
        if q.topic.trim().is_empty()
            || q.topic.len() > 500
            || q.tags.len() > 100
            || q.tags.iter().any(|t| t.len() > 500)
        {
            return Err(format!("{}: invalid topic/tags", q.id));
        }
        let keys: HashSet<_> = q.choices.iter().map(|c| c.key.as_str()).collect();
        if q.choices.len() != 4 || keys != HashSet::from(["A", "B", "C", "D"]) {
            return Err(format!(
                "{} must have exactly the unique choices A, B, C, D",
                q.id
            ));
        }
    }
    let mut solved = HashSet::new();
    for s in ss {
        if !ids.contains(s.question_id.as_str()) {
            return Err(format!(
                "Solution references missing question {}",
                s.question_id
            ));
        }
        if !solved.insert(s.question_id.as_str()) {
            return Err(format!("Duplicate solution for {}", s.question_id));
        }
        if !["A", "B", "C", "D"].contains(&s.correct_choice.as_str()) {
            return Err(format!(
                "{}: invalid correctChoice {}",
                s.question_id, s.correct_choice
            ));
        }
    }
    for q in qs {
        if !solved.contains(q.id.as_str()) {
            return Err(format!("{}: missing solution", q.id));
        }
    }
    Ok(())
}
fn validate_blocks(blocks: &[Block], ctx: &str, assets: &BTreeMap<String, Asset>) -> AppResult<()> {
    if blocks.is_empty() || blocks.len() > 200 {
        return Err(format!("{ctx}: content must contain 1–200 blocks"));
    }
    for (i, b) in blocks.iter().enumerate() {
        let loc = format!("{ctx}, block {}", i + 1);
        match b {
            Block::Markdown { content } => {
                if content.trim().is_empty() || content.len() > 100000 {
                    return Err(format!("{loc}: empty or oversized Markdown"));
                }
                for e in Parser::new_ext(content, Options::ENABLE_TABLES | Options::ENABLE_MATH) {
                    match e {
                        Event::Html(_) | Event::InlineHtml(_) => {
                            return Err(format!("{loc}: embedded HTML is forbidden"))
                        }
                        Event::Start(Tag::Image { .. }) => {
                            return Err(format!(
                                "{loc}: use an image block instead of a Markdown image"
                            ))
                        }
                        Event::Start(Tag::Link { .. }) => {
                            return Err(format!(
                                "{loc}: links are forbidden; packages must be self-contained"
                            ))
                        }
                        _ => {}
                    }
                }
            }
            Block::Image { src, alt, caption } => {
                if !safe_path(src) || !src.starts_with("assets/") {
                    return Err(format!("{loc}: unsafe asset path {src}"));
                }
                if !assets.contains_key(src) {
                    return Err(format!("{loc}: missing asset {src}"));
                }
                if alt.trim().is_empty() || alt.len() > 2000 || caption.len() > 5000 {
                    return Err(format!(
                        "{loc}: provide a nonempty alt (≤2000 chars) and caption ≤5000 chars"
                    ));
                }
            }
        }
    }
    Ok(())
}
pub fn validate_asset(name: &str, bytes: &[u8]) -> AppResult<String> {
    let ext = name.rsplit('.').next().unwrap_or("");
    if ext == "svg" {
        validate_svg(bytes)?;
        return Ok("image/svg+xml".into());
    }
    let format = match ext {
        "png" => image::ImageFormat::Png,
        "webp" => image::ImageFormat::WebP,
        _ => return Err("Unsupported image extension".into()),
    };
    if image::guess_format(bytes).map_err(|e| e.to_string())? != format {
        return Err("Image signature does not match extension".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(12000);
    limits.max_image_height = Some(12000);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let img = reader
        .decode()
        .map_err(|e| format!("Invalid/oversized image: {e}"))?;
    if u64::from(img.width()) * u64::from(img.height()) > 16_000_000 {
        return Err("Raster exceeds 16 megapixels".into());
    }
    Ok(if ext == "png" {
        "image/png"
    } else {
        "image/webp"
    }
    .into())
}
pub fn validate_svg(bytes: &[u8]) -> AppResult<()> {
    let s = std::str::from_utf8(bytes).map_err(|_| "SVG must be UTF-8")?;
    if s.to_ascii_lowercase().contains("<!doctype") || s.to_ascii_lowercase().contains("<!entity") {
        return Err("SVG DTD/entities are forbidden".into());
    }
    let doc = roxmltree::Document::parse(s).map_err(|e| format!("Invalid SVG XML: {e}"))?;
    if doc.root_element().tag_name().name() != "svg" {
        return Err("SVG root element required".into());
    }
    if doc.descendants().any(|n| n.pi().is_some()) {
        return Err("SVG processing instructions are forbidden".into());
    }
    // Deliberate static-diagram allowlist: no CSS, animation, HTML, scripts, filters or external resources.
    let elements = [
        "svg",
        "g",
        "defs",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "title",
        "desc",
        "marker",
        "clipPath",
        "mask",
        "linearGradient",
        "radialGradient",
        "stop",
        "use",
        "symbol",
    ];
    let attrs = [
        "id",
        "version",
        "width",
        "height",
        "viewBox",
        "preserveAspectRatio",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "d",
        "points",
        "transform",
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-opacity",
        "opacity",
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "text-anchor",
        "dominant-baseline",
        "alignment-baseline",
        "dx",
        "dy",
        "rotate",
        "textLength",
        "lengthAdjust",
        "marker-start",
        "marker-mid",
        "marker-end",
        "markerWidth",
        "markerHeight",
        "refX",
        "refY",
        "orient",
        "markerUnits",
        "clip-path",
        "clip-rule",
        "clipPathUnits",
        "mask",
        "maskUnits",
        "maskContentUnits",
        "offset",
        "stop-color",
        "stop-opacity",
        "gradientUnits",
        "gradientTransform",
        "spreadMethod",
        "href",
        "role",
        "aria-label",
        "color",
        "vector-effect",
    ];
    if doc.descendants().count() > 50000 {
        return Err("SVG exceeds 50,000 nodes".into());
    }
    for n in doc.descendants().filter(|n| n.is_element()) {
        if !elements.contains(&n.tag_name().name())
            || n.tag_name()
                .namespace()
                .is_some_and(|ns| ns != "http://www.w3.org/2000/svg")
        {
            return Err(format!("Forbidden SVG element {}", n.tag_name().name()));
        }
        for a in n.attributes() {
            if !attrs.contains(&a.name())
                || a.namespace()
                    .is_some_and(|ns| ns != "http://www.w3.org/1999/xlink")
            {
                return Err(format!("Forbidden SVG attribute {}", a.name()));
            }
            let value = a.value().trim();
            let lower = value.to_ascii_lowercase();
            if lower.contains('\\')
                || lower.contains("http:")
                || lower.contains("https:")
                || lower.contains("data:")
                || lower.contains("javascript:")
                || lower.contains('@')
                || lower.contains("/*")
            {
                return Err(format!("Unsafe SVG value for {}", a.name()));
            }
            if a.name() == "href" && (!value.starts_with('#') || value.len() < 2) {
                return Err("SVG href must reference a local #id".into());
            }
            if lower.contains("url(")
                && (!lower.starts_with("url(#")
                    || !lower.ends_with(')')
                    || lower[5..lower.len() - 1]
                        .chars()
                        .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_')))
            {
                return Err("SVG URL must be a simple local url(#id)".into());
            }
        }
    }
    Ok(())
}
