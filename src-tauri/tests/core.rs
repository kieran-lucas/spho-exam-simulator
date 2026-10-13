use rusqlite::Connection;
use spho_lib::{importer::*, model::*, repository::*};
use std::path::PathBuf;
fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures")
            .join(name),
    )
    .unwrap()
}
fn package() -> Package {
    read_package(&fixture("SPHO_SAMPLE_VALIDATION.zip")).unwrap()
}
fn repo() -> Repository {
    Repository::from_connection(Connection::open_in_memory().unwrap()).unwrap()
}
fn change(q: &str) -> Change {
    Change {
        question_id: q.into(),
        set_choice: false,
        choice: None,
        flagged: None,
        note: None,
        current_question: None,
    }
}
#[test]
fn valid_sample_and_full_size() {
    for (name, count) in [
        ("SPHO_SAMPLE_VALIDATION.zip", 10),
        ("SPHO_SYNTHETIC_100.zip", 100),
    ] {
        let p = read_package(&fixture(name)).unwrap();
        assert_eq!(p.questions.len(), count);
        let mut r = repo();
        r.import(&p).unwrap();
        assert_eq!(r.exam(&p.manifest.exam_id).unwrap().questions.len(), count);
    }
}
#[test]
fn representative_import_failures() {
    for (name, needle) in [
        ("invalid-zip", "Invalid ZIP"),
        ("missing-manifest", "Missing manifest"),
        ("unsupported-schema", "Unsupported schema"),
        ("duplicate-question", "duplicate question"),
        ("missing-question", "questionCount"),
        ("wrong-count", "Section"),
        ("missing-solution", "missing solution"),
        ("invalid-answer", "invalid correctChoice"),
        ("missing-figure", "Q006"),
        ("path-traversal", "Unsafe ZIP path"),
        ("unsafe-svg", "Q006"),
        ("external-image", "unsafe asset path"),
        ("html-injection", "HTML"),
    ] {
        let e = read_package(&fixture(&format!("negative/{name}.zip")))
            .err()
            .unwrap_or_else(|| panic!("{name} unexpectedly passed"));
        assert!(e.contains(needle), "{name}: {e}");
    }
}
#[test]
fn svg_rejects_active_content() {
    for svg in [
        "<svg><g onclick='x()'/></svg>",
        "<svg><foreignObject/></svg>",
        "<svg><use href='https://evil.test/a'/></svg>",
        "<svg><style>rect{fill:red}</style></svg>",
        "<svg><animate/></svg>",
        "<svg><path fill='url(https://evil.test)'/></svg>",
        "<!DOCTYPE svg [<!ENTITY x 'a'>]><svg>&x;</svg>",
        "<svg><image href='data:image/png;base64,x'/></svg>",
    ] {
        assert!(validate_svg(svg.as_bytes()).is_err(), "{svg}");
    }
}
#[test]
fn safe_svg_local_references() {
    validate_svg(b"<svg xmlns='http://www.w3.org/2000/svg'><defs><marker id='arrow'><path d='M0 0L1 1'/></marker></defs><path d='M0 0L10 10' marker-end='url(#arrow)'/></svg>").unwrap();
}
#[test]
fn rejects_paths_and_corrupt_images() {
    for p in [
        "../x",
        "assets/../x",
        "/x",
        "C:/x",
        "assets\\x",
        "assets/%2e%2e/x",
        "assets//x",
    ] {
        assert!(!safe_path(p), "{p}");
    }
    assert!(validate_asset("assets/x.png", b"not png").is_err());
}
#[test]
fn duplicate_import_and_conflicting_content_preserve_attempts() {
    let mut r = repo();
    let mut p = package();
    r.import(&p).unwrap();
    let a = r.start(&p.manifest.exam_id, 1000).unwrap();
    assert!(r.import(&p).unwrap().contains("identical"));
    assert_eq!(r.library().unwrap().len(), 1);
    assert_eq!(r.attempt(&a.id).unwrap().status, "active");
    p.hash = "different".into();
    assert!(r.import(&p).unwrap_err().contains("different content"));
}
#[test]
fn failed_import_rolls_back_all_rows() {
    let mut r = repo();
    r.conn.execute_batch("CREATE TRIGGER fail_insert BEFORE INSERT ON solutions BEGIN SELECT RAISE(ABORT,'injected disk failure'); END;").unwrap();
    assert!(r.import(&package()).is_err());
    for table in ["exams", "questions", "solutions", "assets"] {
        let n: i64 = r
            .conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
    r.conn.execute_batch("DROP TRIGGER fail_insert").unwrap();
    r.import(&package()).unwrap();
}
#[test]
fn answer_change_clear_flags_skip_notes_navigation() {
    let mut r = repo();
    let p = package();
    r.import(&p).unwrap();
    let a = r.start(&p.manifest.exam_id, 1000).unwrap();
    let mut c = change("Q001");
    c.set_choice = true;
    c.choice = Some("A".into());
    r.change(&a.id, c, 1100).unwrap();
    let mut c = change("Q001");
    c.set_choice = true;
    c.choice = Some("B".into());
    c.flagged = Some(true);
    c.note = Some("Điện trường — ghi chú".into());
    c.current_question = Some(1);
    r.change(&a.id, c, 1200).unwrap();
    let mut c = change("Q002");
    c.flagged = Some(true);
    c.current_question = Some(2);
    r.change(&a.id, c, 1300).unwrap();
    let updated = r.attempt(&a.id).unwrap();
    assert_eq!(updated.current_question, 2);
    assert_eq!(updated.responses[0].choice.as_deref(), Some("B"));
    assert!(updated.responses[0].flagged);
    assert!(updated.responses[1].flagged);
    assert_eq!(updated.responses[1].choice, None);
    assert!(updated.responses[0].note.contains("Điện trường"));
    let mut c = change("Q001");
    c.set_choice = true;
    r.change(&a.id, c, 1400).unwrap();
    assert_eq!(r.attempt(&a.id).unwrap().responses[0].choice, None);
}
#[test]
fn grading_zero_negative_marking_freeze_retakes() {
    let mut r = repo();
    let p = package();
    r.import(&p).unwrap();
    let a = r.start(&p.manifest.exam_id, 1000).unwrap();
    assert!(r.solutions(&a.id).is_err());
    for (q, key) in [("Q001", "B"), ("Q002", "A")] {
        let mut c = change(q);
        c.set_choice = true;
        c.choice = Some(key.into());
        r.change(&a.id, c, 1100).unwrap();
    }
    let result = r.submit(&a.id, 2000).unwrap();
    assert_eq!(result.score, Some(1));
    assert_eq!(
        result
            .responses
            .iter()
            .filter(|r| r.choice.is_none())
            .count(),
        8
    );
    assert_eq!(r.solutions(&a.id).unwrap().len(), 10);
    assert!(r.change(&a.id, change("Q001"), 2100).is_err());
    assert!(r
        .conn
        .execute(
            "UPDATE responses SET note='tampered' WHERE attempt_id=?1",
            [&a.id]
        )
        .is_err());
    assert_eq!(
        r.submit(&a.id, 3000).unwrap().submitted_at,
        result.submitted_at
    );
    let b = r.start(&p.manifest.exam_id, 4000).unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(r.library().unwrap()[0].attempts.len(), 2);
    assert!(b
        .responses
        .iter()
        .all(|r| r.choice.is_none() && r.note.is_empty()));
}
#[test]
fn monotonic_timer_checkpoints_minimized_sleep_and_timeout() {
    let mut r = repo();
    let mut p = package();
    p.manifest.duration_seconds = 10;
    r.import(&p).unwrap();
    let a = r.start(&p.manifest.exam_id, 1000).unwrap();
    r.checkpoint(2100).unwrap();
    assert_eq!(r.attempt(&a.id).unwrap().elapsed_ms, 1100);
    r.set_viewing(false, 2200).unwrap();
    let viewed = r.attempt(&a.id).unwrap().responses[0].viewing_ms;
    r.checkpoint(3200).unwrap();
    assert_eq!(r.attempt(&a.id).unwrap().elapsed_ms, 2200);
    assert_eq!(r.attempt(&a.id).unwrap().responses[0].viewing_ms, viewed);
    r.checkpoint(3200).unwrap();
    assert_eq!(r.attempt(&a.id).unwrap().elapsed_ms, 2200);
    r.checkpoint(9999999).unwrap();
    let result = r.attempt(&a.id).unwrap();
    assert_eq!(result.elapsed_ms, 10000);
    assert_eq!(result.status, "submitted");
    assert_eq!(result.score, Some(0));
    r.checkpoint(99999999).unwrap();
    assert_eq!(r.attempt(&a.id).unwrap().submitted_at, result.submitted_at);
}
#[test]
fn graceful_close_reopen_and_crash_checkpoint() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("test.sqlite3");
    let a;
    {
        let mut r = Repository::open(&path).unwrap();
        let p = package();
        r.import(&p).unwrap();
        a = r.start(&p.manifest.exam_id, 1000).unwrap();
        let mut c = change("Q001");
        c.note = Some("persistent".into());
        c.set_choice = true;
        c.choice = Some("B".into());
        r.change(&a.id, c, 1800).unwrap();
        r.checkpoint(2500).unwrap();
    }
    {
        let mut r = Repository::open(&path).unwrap();
        let restored = r.active().unwrap().unwrap();
        assert_eq!(restored.elapsed_ms, 1500);
        assert_eq!(restored.responses[0].note, "persistent");
        assert_eq!(restored.responses[0].choice.as_deref(), Some("B"));
        r.session.as_mut().unwrap().last_ms = 100000;
        r.checkpoint(101000).unwrap();
        assert_eq!(r.attempt(&a.id).unwrap().elapsed_ms, 2500);
    }
    let r = Repository::open(&path).unwrap();
    assert_eq!(r.attempt(&a.id).unwrap().elapsed_ms, 2500);
}
#[test]
fn concurrent_attempts_and_invalid_changes_rejected() {
    let mut r = repo();
    let p = package();
    r.import(&p).unwrap();
    let a = r.start(&p.manifest.exam_id, 1000).unwrap();
    assert!(r.start(&p.manifest.exam_id, 1000).is_err());
    let mut c = change("Q001");
    c.current_question = Some(100);
    assert!(r.change(&a.id, c, 1100).is_err());
    let mut c = change("Q001");
    c.set_choice = true;
    c.choice = Some("E".into());
    assert!(r.change(&a.id, c, 1100).is_err());
    assert!(r.change(&a.id, change("missing"), 1100).is_err());
}
#[test]
fn full_size_score_and_all_navigation_positions() {
    let mut r = repo();
    let p = read_package(&fixture("SPHO_SYNTHETIC_100.zip")).unwrap();
    r.import(&p).unwrap();
    let a = r.start(&p.manifest.exam_id, 1000).unwrap();
    for (i, q) in p.questions.iter().enumerate() {
        let mut c = change(&q.id);
        c.current_question = Some(i);
        c.set_choice = true;
        c.choice = Some("A".into());
        r.change(&a.id, c, 1000 + i as u64).unwrap();
    }
    let a = r.submit(&a.id, 2000).unwrap();
    assert_eq!(a.score, Some(100));
    assert_eq!(a.current_question, 99);
}

fn zip_entries(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    use std::io::{Cursor, Write};
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        z.start_file(
            *name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        z.write_all(bytes).unwrap();
    }
    z.finish().unwrap().into_inner()
}
#[test]
fn rejects_zip_bombs_oversized_assets_and_unsupported_files() {
    let bomb = zip_entries(&[("assets/bomb.svg", vec![b'a'; 2 * 1024 * 1024])]);
    assert!(read_package(&bomb)
        .err()
        .unwrap()
        .contains("compression ratio"));
    let huge = zip_entries(&[("assets/large.svg", vec![b'a'; 17 * 1024 * 1024])]);
    assert!(read_package(&huge).err().unwrap().contains("size limit"));
    let exe = zip_entries(&[("assets/run.exe", b"MZ".to_vec())]);
    assert!(read_package(&exe)
        .err()
        .unwrap()
        .contains("Unsupported file"));
    let large_zip = vec![0u8; MAX_ZIP + 1];
    assert!(read_package(&large_zip).err().unwrap().contains("64 MiB"));
}
#[test]
fn svg_processing_instructions_rejected() {
    assert!(validate_svg(b"<?xml-stylesheet href='https://evil.test/a.css'?><svg/>").is_err());
}
#[test]
fn content_hash_ignores_zip_container_order_and_compression() {
    use std::io::Read;
    let bytes = fixture("SPHO_SAMPLE_VALIDATION.zip");
    let original = read_package(&bytes).unwrap();
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut entries = Vec::new();
    for i in (0..z.len()).rev() {
        let mut f = z.by_index(i).unwrap();
        let name = f.name().to_string();
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes).unwrap();
        entries.push((name, bytes));
    }
    let refs = entries
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.clone()))
        .collect::<Vec<_>>();
    let reordered = read_package(&zip_entries(&refs)).unwrap();
    assert_eq!(original.hash, reordered.hash);
}
