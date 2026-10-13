use crate::{importer::Package, model::*};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use uuid::Uuid;

pub struct Session {
    pub id: String,
    pub last_ms: u64,
    pub viewing: bool,
}
pub struct Repository {
    pub conn: Connection,
    pub session: Option<Session>,
}
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn tick_ms() -> u64 {
    #[cfg(windows)]
    {
        unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() }
    }
    #[cfg(not(windows))]
    {
        use std::{sync::OnceLock, time::Instant};
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_millis() as u64
    }
}
fn db<T>(v: rusqlite::Result<T>) -> AppResult<T> {
    v.map_err(|e| format!("Local database: {e}"))
}
fn json<T: serde::de::DeserializeOwned>(s: String) -> AppResult<T> {
    serde_json::from_str(&s).map_err(|e| format!("Corrupted stored content: {e}"))
}
impl Repository {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::from_connection(db(Connection::open(path))?)
    }
    pub fn from_connection(conn: Connection) -> AppResult<Self> {
        db(conn.pragma_update(None, "journal_mode", "WAL"))?;
        db(conn.pragma_update(None, "synchronous", "FULL"))?;
        db(conn.pragma_update(None, "foreign_keys", true))?;
        let version: i64 = db(conn.pragma_query_value(None, "user_version", |r| r.get(0)))?;
        if version > 1 {
            return Err("This database was created by a newer application. Update the app before opening it.".into());
        }
        if version == 0 {
            conn.execute_batch("BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            if let Err(e) = conn.execute_batch(include_str!("../migrations/001_initial.sql")) {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e.to_string());
            }
            db(conn.execute_batch("COMMIT"))?;
        }
        let active: Option<String> = db(conn
            .query_row("SELECT id FROM attempts WHERE status='active'", [], |r| {
                r.get(0)
            })
            .optional())?;
        Ok(Self {
            conn,
            session: active.map(|id| Session {
                id,
                last_ms: tick_ms(),
                viewing: false,
            }),
        })
    }
    pub fn import_status(&self, p: &Package) -> AppResult<Option<String>> {
        let old: Option<String> = db(self
            .conn
            .query_row(
                "SELECT hash FROM exams WHERE id=?1",
                [&p.manifest.exam_id],
                |r| r.get(0),
            )
            .optional())?;
        match old {Some(hash) if hash==p.hash=>Ok(Some("This identical package is already in your library. All attempts are preserved.".into())),Some(_)=>Err(format!("examId '{}' already exists with different content. Use a new examId for a revised package; existing progress has been preserved.",p.manifest.exam_id)),None=>Ok(None)}
    }
    pub fn import(&mut self, p: &Package) -> AppResult<String> {
        if let Some(msg) = self.import_status(p)? {
            return Ok(msg);
        }
        let tx = db(self.conn.transaction())?;
        let id = &p.manifest.exam_id;
        db(tx.execute(
            "INSERT INTO exams VALUES (?1,?2,?3,?4)",
            params![
                id,
                serde_json::to_string(&p.manifest).unwrap(),
                p.hash,
                now_iso()
            ],
        ))?;
        for (i, q) in p.questions.iter().enumerate() {
            db(tx.execute(
                "INSERT INTO questions VALUES (?1,?2,?3,?4)",
                params![id, q.id, i as i64, serde_json::to_string(q).unwrap()],
            ))?;
        }
        for s in &p.solutions {
            db(tx.execute(
                "INSERT INTO solutions VALUES (?1,?2,?3)",
                params![id, s.question_id, serde_json::to_string(s).unwrap()],
            ))?;
        }
        for (path, a) in &p.assets {
            db(tx.execute(
                "INSERT INTO assets VALUES (?1,?2,?3,?4)",
                params![id, path, a.mime, a.bytes],
            ))?;
        }
        db(tx.commit())?;
        Ok(format!(
            "Imported {} — {} questions. Ready to begin.",
            p.manifest.title,
            p.questions.len()
        ))
    }
    pub fn exam(&self, id: &str) -> AppResult<Exam> {
        let m: String =
            db(self
                .conn
                .query_row("SELECT manifest FROM exams WHERE id=?1", [id], |r| r.get(0)))?;
        let mut stmt = db(self
            .conn
            .prepare("SELECT content FROM questions WHERE exam_id=?1 ORDER BY position"))?;
        let rows = db(stmt.query_map([id], |r| r.get::<_, String>(0)))?;
        let mut questions = Vec::new();
        for row in rows {
            questions.push(json(db(row)?)?);
        }
        Ok(Exam {
            manifest: json(m)?,
            questions,
        })
    }
    pub fn attempt(&self, id: &str) -> AppResult<Attempt> {
        let mut a=db(self.conn.query_row("SELECT id,exam_id,status,started_at,submitted_at,elapsed_ms,current_question,score FROM attempts WHERE id=?1",[id],|r|Ok(Attempt{id:r.get(0)?,exam_id:r.get(1)?,status:r.get(2)?,started_at:r.get(3)?,submitted_at:r.get(4)?,elapsed_ms:r.get::<_,i64>(5)? as u64,current_question:r.get::<_,i64>(6)? as usize,score:r.get(7)?,responses:Vec::new()})))?;
        let mut s=db(self.conn.prepare("SELECT question_id,choice,flagged,note,viewing_ms FROM responses WHERE attempt_id=?1 ORDER BY question_id"))?;
        let rows = db(s.query_map([id], |r| {
            Ok(Response {
                question_id: r.get(0)?,
                choice: r.get(1)?,
                flagged: r.get(2)?,
                note: r.get(3)?,
                viewing_ms: r.get::<_, i64>(4)? as u64,
            })
        }))?;
        for r in rows {
            a.responses.push(db(r)?);
        }
        Ok(a)
    }
    pub fn active(&self) -> AppResult<Option<Attempt>> {
        let id: Option<String> = db(self
            .conn
            .query_row("SELECT id FROM attempts WHERE status='active'", [], |r| {
                r.get(0)
            })
            .optional())?;
        id.map(|id| self.attempt(&id)).transpose()
    }
    pub fn library(&self) -> AppResult<Vec<LibraryExam>> {
        let mut stmt = db(self
            .conn
            .prepare("SELECT id,manifest,hash,imported_at FROM exams ORDER BY imported_at DESC"))?;
        let rows = db(stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        }))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, m, hash, imported_at) = db(row)?;
            let mut stmt2 = db(self
                .conn
                .prepare("SELECT id FROM attempts WHERE exam_id=?1 ORDER BY started_at DESC"))?;
            let ids = db(stmt2.query_map([&id], |r| r.get::<_, String>(0)))?;
            let mut attempts = Vec::new();
            for id in ids {
                attempts.push(self.attempt(&db(id)?)?);
            }
            out.push(LibraryExam {
                manifest: json(m)?,
                hash,
                imported_at,
                attempts,
            });
        }
        Ok(out)
    }
    pub fn start(&mut self, exam_id: &str, now: u64) -> AppResult<Attempt> {
        if self.active()?.is_some() {
            return Err(
                "Resume or submit your current examination before starting another attempt".into(),
            );
        }
        let exam = self.exam(exam_id)?;
        let id = Uuid::new_v4().to_string();
        let tx = db(self.conn.transaction())?;
        db(tx.execute(
            "INSERT INTO attempts(id,exam_id,status,started_at) VALUES (?1,?2,'active',?3)",
            params![id, exam_id, now_iso()],
        ))?;
        for q in &exam.questions {
            db(tx.execute(
                "INSERT INTO responses(attempt_id,question_id) VALUES (?1,?2)",
                params![id, q.id],
            ))?;
        }
        db(tx.commit())?;
        self.session = Some(Session {
            id: id.clone(),
            last_ms: now,
            viewing: true,
        });
        self.attempt(&id)
    }
    pub fn checkpoint(&mut self, now: u64) -> AppResult<()> {
        let Some(session) = &self.session else {
            return Ok(());
        };
        let id = session.id.clone();
        let delta = now.saturating_sub(session.last_ms);
        let viewing = session.viewing;
        let a = self.attempt(&id)?;
        if a.status != "active" {
            self.session = None;
            return Ok(());
        }
        let exam = self.exam(&a.exam_id)?;
        let max = u64::from(exam.manifest.duration_seconds) * 1000;
        let elapsed = (a.elapsed_ms + delta).min(max);
        let actual = elapsed.saturating_sub(a.elapsed_ms);
        let tx = db(self.conn.transaction())?;
        db(tx.execute(
            "UPDATE attempts SET elapsed_ms=?1 WHERE id=?2 AND status='active'",
            params![elapsed as i64, id],
        ))?;
        if viewing && actual > 0 && delta <= 3000 {
            let q = &exam.questions[a.current_question];
            db(tx.execute("UPDATE responses SET viewing_ms=viewing_ms+?1 WHERE attempt_id=?2 AND question_id=?3",params![actual as i64,id,q.id]))?;
        }
        db(tx.commit())?;
        if let Some(s) = &mut self.session {
            s.last_ms = now;
        }
        if elapsed >= max {
            self.grade(&id)?;
        }
        Ok(())
    }
    pub fn set_viewing(&mut self, value: bool, now: u64) -> AppResult<()> {
        self.checkpoint(now)?;
        if let Some(s) = &mut self.session {
            s.viewing = value;
        }
        Ok(())
    }
    pub fn change(&mut self, id: &str, c: Change, now: u64) -> AppResult<Attempt> {
        self.checkpoint(now)?;
        let a = self.attempt(id)?;
        if a.status != "active" {
            return Err("This attempt has been submitted and is immutable".into());
        }
        if !a.responses.iter().any(|r| r.question_id == c.question_id) {
            return Err("Unknown question ID".into());
        }
        if c.set_choice
            && c.choice
                .as_deref()
                .is_some_and(|k| !["A", "B", "C", "D"].contains(&k))
        {
            return Err("Invalid answer key".into());
        }
        if c.note.as_ref().is_some_and(|n| n.len() > 20000) {
            return Err("Note exceeds 20,000 bytes".into());
        }
        if c.current_question.is_some_and(|i| i >= a.responses.len()) {
            return Err("Question position is out of range".into());
        }
        let tx = db(self.conn.transaction())?;
        if c.set_choice {
            db(tx.execute(
                "UPDATE responses SET choice=?1 WHERE attempt_id=?2 AND question_id=?3",
                params![c.choice, id, c.question_id],
            ))?;
        }
        if let Some(f) = c.flagged {
            db(tx.execute(
                "UPDATE responses SET flagged=?1 WHERE attempt_id=?2 AND question_id=?3",
                params![f, id, c.question_id],
            ))?;
        }
        if let Some(n) = c.note {
            db(tx.execute(
                "UPDATE responses SET note=?1 WHERE attempt_id=?2 AND question_id=?3",
                params![n, id, c.question_id],
            ))?;
        }
        if let Some(i) = c.current_question {
            db(tx.execute(
                "UPDATE attempts SET current_question=?1 WHERE id=?2",
                params![i as i64, id],
            ))?;
        }
        db(tx.commit())?;
        self.attempt(id)
    }
    fn grade(&mut self, id: &str) -> AppResult<Attempt> {
        let a = self.attempt(id)?;
        if a.status == "submitted" {
            return Ok(a);
        }
        let tx = db(self.conn.transaction())?;
        let score:u32=db(tx.query_row("SELECT COUNT(*) FROM responses r JOIN attempts a ON a.id=r.attempt_id JOIN solutions s ON s.exam_id=a.exam_id AND s.question_id=r.question_id WHERE r.attempt_id=?1 AND r.choice=json_extract(s.content,'$.correctChoice')",[id],|r|r.get(0)))?;
        db(tx.execute("UPDATE attempts SET status='submitted',score=?1,submitted_at=?2 WHERE id=?3 AND status='active'",params![score,now_iso(),id]))?;
        db(tx.commit())?;
        if self.session.as_ref().is_some_and(|s| s.id == id) {
            self.session = None;
        }
        self.attempt(id)
    }
    pub fn submit(&mut self, id: &str, now: u64) -> AppResult<Attempt> {
        self.checkpoint(now)?;
        self.grade(id)
    }
    pub fn solutions(&self, attempt_id: &str) -> AppResult<Vec<Solution>> {
        let a = self.attempt(attempt_id)?;
        if a.status != "submitted" {
            return Err("Solutions are available only after submission".into());
        }
        let mut stmt = db(self
            .conn
            .prepare("SELECT content FROM solutions WHERE exam_id=?1"))?;
        let rows = db(stmt.query_map([&a.exam_id], |r| r.get::<_, String>(0)))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(json(db(row)?)?);
        }
        Ok(out)
    }
    pub fn asset(&self, exam_id: &str, path: &str) -> AppResult<(String, Vec<u8>)> {
        db(self.conn.query_row(
            "SELECT mime,bytes FROM assets WHERE exam_id=?1 AND path=?2",
            params![exam_id, path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))
    }
}
