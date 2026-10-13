PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS exams (
 id TEXT PRIMARY KEY, manifest TEXT NOT NULL CHECK(json_valid(manifest)), hash TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
 exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL,
 content TEXT NOT NULL CHECK(json_valid(content)), PRIMARY KEY(exam_id,id), UNIQUE(exam_id,position)
);
CREATE TABLE IF NOT EXISTS solutions (
 exam_id TEXT NOT NULL, question_id TEXT NOT NULL, content TEXT NOT NULL CHECK(json_valid(content)),
 PRIMARY KEY(exam_id,question_id), FOREIGN KEY(exam_id,question_id) REFERENCES questions(exam_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS assets (
 exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, path TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL,
 PRIMARY KEY(exam_id,path)
);
CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), status TEXT NOT NULL CHECK(status IN ('active','submitted')),
 started_at TEXT NOT NULL, submitted_at TEXT, elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_ms>=0),
 current_question INTEGER NOT NULL DEFAULT 0 CHECK(current_question>=0), score INTEGER,
 CHECK((status='active' AND score IS NULL AND submitted_at IS NULL) OR (status='submitted' AND score IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON attempts(status) WHERE status='active';
CREATE INDEX IF NOT EXISTS attempts_exam ON attempts(exam_id,started_at);
CREATE TABLE IF NOT EXISTS responses (
 attempt_id TEXT NOT NULL REFERENCES attempts(id), question_id TEXT NOT NULL,
 choice TEXT CHECK(choice IN ('A','B','C','D')), flagged INTEGER NOT NULL DEFAULT 0 CHECK(flagged IN (0,1)),
 note TEXT NOT NULL DEFAULT '', viewing_ms INTEGER NOT NULL DEFAULT 0 CHECK(viewing_ms>=0), PRIMARY KEY(attempt_id,question_id)
);
CREATE TRIGGER IF NOT EXISTS freeze_attempt BEFORE UPDATE ON attempts WHEN OLD.status='submitted'
BEGIN SELECT RAISE(ABORT,'Submitted attempts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS freeze_response BEFORE UPDATE ON responses
WHEN (SELECT status FROM attempts WHERE id=OLD.attempt_id)='submitted'
BEGIN SELECT RAISE(ABORT,'Submitted responses are immutable'); END;
PRAGMA user_version = 1;
