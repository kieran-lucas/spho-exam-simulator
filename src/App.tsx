import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Atom,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  Flag,
  FolderInput,
  Library,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  X,
  AlertCircle,
  FileText,
  FlaskConical,
} from "lucide-react";
import { api } from "./api";
import { validateStaged } from "./science";
import { counts, formatTime } from "./analytics";
import type { Attempt, Change, Exam, LibraryExam, Solution } from "./models";
import { ScientificContent } from "./components/ScientificContent";
import { Modal } from "./components/Modal";
import { Results } from "./Results";
import { About } from "./components/About";

type Page = "library" | "exam" | "results" | "qa";
const shortDate = (date: string) =>
  new Date(date).toLocaleString("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export default function App() {
  const [page, setPage] = useState<Page>("library");
  const [library, setLibrary] = useState<LibraryExam[]>([]);
  const [exam, setExam] = useState<Exam | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [about, setAbout] = useState(false);
  const [saving, setSaving] = useState(false);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const chain = useRef<Promise<void>>(Promise.resolve());
  const version = useRef(0);
  const pending = useRef(0);
  const failures = useRef<{ id: string; change: Change }[]>([]);
  const closing = useRef(false);
  const endedAttempt = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const flush = useCallback(async () => {
    await chain.current;
    if (failures.current.length)
      throw new Error(
        "Some changes could not be saved. Retry saving before submitting or closing.",
      );
  }, []);
  const openAttempt = useCallback(async (a: Attempt) => {
    endedAttempt.current = a.status === "submitted" ? a.id : null;
    const e = await api.exam(a.examId);
    const ss = a.status === "submitted" ? await api.solutions(a.id) : [];
    setExam(e);
    setAttempt(a);
    setSolutions(ss);
    setPage(a.status === "submitted" ? "results" : "exam");
    setConfirm(false);
    setNotice("");
  }, []);
  const refreshLibrary = useCallback(
    async () => setLibrary(await api.library()),
    [],
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [items, active] = await Promise.all([
          api.library(),
          api.active(),
        ]);
        if (!alive) return;
        setLibrary(items);
        if (active) await openAttempt(active);
      } catch (e) {
        if (alive)
          setError(`Cannot open the local examination library: ${String(e)}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [openAttempt]);
  useEffect(() => {
    const subscriptions = [
      listen<string>("storage-error", (e) =>
        setError(
          `Saving failed: ${e.payload}. Keep the application open and resolve the storage problem.`,
        ),
      ),
      listen("close-requested", () => {
        if (closing.current) return;
        closing.current = true;
        setBusy("Saving and closing…");
        (async () => {
          try {
            await flush();
            await api.close();
          } catch (e) {
            closing.current = false;
            setBusy("");
            setError(String(e));
          }
        })();
      }),
    ];
    return () => {
      subscriptions.forEach((p) =>
        p.then((unlisten) => unlisten()).catch(() => {}),
      );
    };
  }, [flush]);
  useEffect(() => {
    if (!attempt || attempt.status !== "active") return;
    let alive = true;
    let polling = false;
    const poll = async () => {
      if (polling || pending.current) return;
      polling = true;
      const captured = version.current;
      try {
        const a = await api.attempt(attempt.id);
        if (alive && captured === version.current && !pending.current) {
          if (a.status === "submitted") {
            if (failures.current.length)
              setError(
                "The examination ended with unsaved edits. Your result uses the last durably saved answers.",
              );
            failures.current = [];
            setDirty(false);
            await openAttempt(a);
          } else if (!failures.current.length) setAttempt(a);
          else
            setAttempt((old) =>
              old ? { ...old, elapsedMs: a.elapsedMs } : old,
            );
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(poll, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [attempt?.id, attempt?.status, openAttempt]);
  const mutate = useCallback(
    (change: Change) => {
      const a = attemptRef.current;
      if (!a || a.status !== "active" || closing.current) return;
      const seq = ++version.current;
      pending.current++;
      setSaving(true);
      // Immediate input feedback; durable writes run in order, and older replies cannot overwrite newer edits.
      setAttempt((old) =>
        old
          ? {
              ...old,
              currentQuestion: change.currentQuestion ?? old.currentQuestion,
              responses: old.responses.map((r) =>
                r.questionId === change.questionId
                  ? {
                      ...r,
                      ...(change.setChoice
                        ? { choice: change.choice ?? null }
                        : {}),
                      ...(change.flagged !== undefined
                        ? { flagged: change.flagged }
                        : {}),
                      ...(change.note !== undefined
                        ? { note: change.note }
                        : {}),
                    }
                  : r,
              ),
            }
          : old,
      );
      chain.current = chain.current.then(async () => {
        try {
          if (endedAttempt.current === a.id) return;
          if (failures.current.length) {
            failures.current.push({ id: a.id, change });
            return;
          }
          const updated = await api.change(a.id, change);
          if (seq === version.current) setAttempt(updated);
        } catch (e) {
          // A selection can race the authoritative deadline. Reveal the frozen result
          // instead of trapping the UI behind a retry that can never modify a submitted attempt.
          const final = await api.attempt(a.id).catch(() => null);
          if (final?.status === "submitted") {
            endedAttempt.current = a.id;
            failures.current = [];
            setDirty(false);
            await openAttempt(final);
            setError(
              "Time expired before the last edit could be saved. Your result uses the answers saved before submission.",
            );
            return;
          }
          failures.current.push({ id: a.id, change });
          setDirty(true);
          setError(`Changes need attention: ${String(e)}`);
        } finally {
          pending.current--;
          if (!pending.current) setSaving(false);
        }
      });
    },
    [openAttempt],
  );
  async function retry() {
    setBusy("Saving changes…");
    try {
      await chain.current;
      const failed = failures.current.splice(0);
      let latest: Attempt | null = null;
      for (let i = 0; i < failed.length; i++) {
        const item = failed[i];
        try {
          latest = await api.change(item.id, item.change);
        } catch (e) {
          failures.current.push(...failed.slice(i));
          throw e;
        }
      }
      if (latest) setAttempt(latest);
      setDirty(false);
      setError("");
    } catch (e) {
      setDirty(true);
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function start(id: string) {
    setBusy("Opening examination…");
    setError("");
    try {
      await flush();
      await openAttempt(await api.start(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function load(a: Attempt) {
    setBusy("Opening attempt…");
    try {
      await openAttempt(await api.attempt(a.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function importZip() {
    setError("");
    setNotice("");
    setBusy("Select ZIP · checking package structure and figures…");
    try {
      const raw = await api.stage();
      if (!raw) return;
      setBusy("Validating every mathematical expression…");
      await new Promise((r) => setTimeout(r, 0));
      const stage = validateStaged(raw);
      setBusy("Committing validated package…");
      setNotice(await api.commit(stage.token));
      await refreshLibrary();
    } catch (e) {
      await api.cancel().catch(() => {});
      setError(`Import rejected. ${String(e)}`);
    } finally {
      setBusy("");
    }
  }
  async function submit() {
    if (!attempt) return;
    setBusy("Saving and submitting…");
    try {
      await flush();
      await openAttempt(await api.submit(attempt.id));
      await refreshLibrary();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  const navigate = useCallback(
    (i: number) => {
      const a = attemptRef.current;
      if (!a || !exam || i < 0 || i >= exam.questions.length) return;
      mutate({
        questionId: exam.questions[a.currentQuestion].id,
        currentQuestion: i,
      });
      document.getElementById("question-start")?.focus();
      document.querySelector(".question-scroll")?.scrollTo({ top: 0 });
    },
    [exam, mutate],
  );
  const q = exam && attempt ? exam.questions[attempt.currentQuestion] : null;
  const response = attempt?.responses.find((r) => r.questionId === q?.id);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.repeat ||
        document.querySelector("dialog[open]") ||
        busy ||
        page !== "exam"
      )
        return;
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      const a = attemptRef.current;
      if (!a || !exam || a.status !== "active") return;
      const q = exam.questions[a.currentQuestion];
      const r = a.responses.find((r) => r.questionId === q.id)!;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate(a.currentQuestion - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate(a.currentQuestion + 1);
      } else if ("abcd".includes(e.key.toLowerCase()) && e.key.length === 1) {
        e.preventDefault();
        mutate({
          questionId: q.id,
          setChoice: true,
          choice: e.key.toUpperCase() as "A" | "B" | "C" | "D",
        });
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        mutate({ questionId: q.id, flagged: !r.flagged });
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [page, busy, exam, navigate, mutate]);
  const c = attempt ? counts(attempt) : null;
  const remaining =
    exam && attempt
      ? Math.max(0, exam.manifest.durationSeconds * 1000 - attempt.elapsedMs)
      : 0;
  if (loading)
    return (
      <main className="startup">
        <Atom size={34} />
        <h1>SPhO Exam Simulator</h1>
        <p>Opening your local library…</p>
      </main>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <Atom size={23} />
          </span>
          <div>
            <strong>
              SPhO <span>Exam Simulator</span>
            </strong>
            <small>PHYSICS · OVERLOAD PRACTICE</small>
          </div>
        </div>
        <div className="header-right">
          <span className="offline">
            <span /> Offline · Local storage
          </span>
          {page !== "exam" && (
            <button
              className="quiet"
              onClick={() => {
                setPage("library");
                refreshLibrary().catch((e) => setError(String(e)));
              }}
            >
              <Library size={16} /> Library
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="banner error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          {dirty && <button onClick={retry}>Retry saving</button>}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="banner success" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {page === "library" && (
        <main className="library">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>Examination library</h1>
              <p className="muted">
                A focused space for deliberate physics practice.
              </p>
            </div>
            <button className="primary" disabled={!!busy} onClick={importZip}>
              <FolderInput size={18} /> Import examination ZIP
            </button>
          </div>
          <div className="library-strip">
            <span>
              <BookOpen size={18} />
              {library.length} examinations
            </span>
            <span>
              <Clock3 size={18} />
              Standard session · 150 minutes
            </span>
            <span>
              <ShieldCheck size={18} />
              Progress saved automatically
            </span>
          </div>
          {!library.length ? (
            <div className="empty">
              <BookOpen size={36} />
              <h2>Your next examination starts here</h2>
              <p>
                Import a self-contained <code>spho-exam/1.0</code> ZIP package.
                <br />
                Questions, figures, and mathematics are checked before import.
              </p>
              <button className="primary" disabled={!!busy} onClick={importZip}>
                <FolderInput size={18} /> Choose a ZIP package
              </button>
              <p className="muted small">
                Try SPHO_SAMPLE_VALIDATION.zip from the fixtures folder.
              </p>
            </div>
          ) : (
            <div className="exam-list">
              {library.map((item) => {
                const m = item.manifest;
                const completed = item.attempts.filter(
                  (a) => a.status === "submitted",
                );
                const active = item.attempts.find((a) => a.status === "active");
                const best = completed.length
                  ? Math.max(...completed.map((a) => a.score ?? 0))
                  : null;
                return (
                  <article className="exam-card" key={m.examId}>
                    <div className="exam-card-main">
                      <span className="exam-symbol">
                        <FileText size={24} />
                      </span>
                      <div>
                        <div className="card-badges">
                          <span className="badge">OVERLOAD</span>
                          {m.questionCount !== 100 && (
                            <span className="badge neutral">
                              VALIDATION FIXTURE
                            </span>
                          )}
                          {m.title.includes("SYNTHETIC") && (
                            <span className="badge neutral">
                              SYNTHETIC · NOT A PRACTICE EXAM
                            </span>
                          )}
                          {active && (
                            <span className="badge amber">IN PROGRESS</span>
                          )}
                        </div>
                        <h2>{m.title}</h2>
                        <p className="muted">{m.description}</p>
                        <div className="exam-meta">
                          <span>{m.questionCount} questions</span>
                          <span>{m.durationSeconds / 60} minutes</span>
                          <span>{completed.length} completed attempts</span>
                        </div>
                      </div>
                      <div className="score-preview">
                        <small>BEST SCORE</small>
                        <strong>
                          {best === null ? "—" : best}
                          <span>
                            {best === null ? "" : ` / ${m.questionCount}`}
                          </span>
                        </strong>
                      </div>
                    </div>
                    <div className="exam-card-footer">
                      <span className="muted small">
                        {item.attempts[0]
                          ? `Last attempt · ${shortDate(item.attempts[0].startedAt)}`
                          : "Ready for your first attempt"}
                      </span>
                      <button
                        className="primary"
                        disabled={!!busy}
                        onClick={() =>
                          active ? load(active) : start(m.examId)
                        }
                      >
                        {active ? (
                          <>
                            <ArrowRight size={17} /> Resume examination
                          </>
                        ) : completed.length ? (
                          <>
                            <RotateCcw size={17} /> Retake examination
                          </>
                        ) : (
                          <>
                            <ArrowRight size={17} /> Start examination
                          </>
                        )}
                      </button>
                    </div>
                    {completed.length > 0 && (
                      <details className="attempt-history">
                        <summary>Previous results ({completed.length})</summary>
                        {completed.map((a) => (
                          <button
                            className="history-row"
                            key={a.id}
                            onClick={() => load(a)}
                          >
                            <span>{shortDate(a.submittedAt!)}</span>
                            <span>
                              {a.score} / {m.questionCount} ·{" "}
                              {formatTime(a.elapsedMs)}
                              <ArrowRight size={15} />
                            </span>
                          </button>
                        ))}
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <footer className="library-footer">
            <span>One point per correct answer. No negative marking.</span>
            <button className="quiet" onClick={() => setPage("qa")}>
              <FlaskConical size={16} /> Rendering validation
            </button>
            <button className="quiet" onClick={() => setAbout(true)}>
              About &amp; licenses
            </button>
          </footer>
        </main>
      )}
      {page === "exam" && exam && attempt && q && response && c && (
        <main className="exam-room" inert={!!busy}>
          <div className="exam-main">
            <div className="exam-topbar">
              <div>
                <p className="eyebrow">OVERLOAD EXAMINATION</p>
                <h1>{exam.manifest.title}</h1>
              </div>
              <span
                className={`save-status ${dirty ? "unsaved" : ""}`}
                role="status"
              >
                {dirty ? <AlertCircle size={14} /> : <Check size={14} />}{" "}
                {dirty
                  ? "Unsaved changes"
                  : saving
                    ? "Saving…"
                    : "All changes saved"}
              </span>
            </div>
            <div className="question-scroll">
              <div className="question-label">
                <span id="question-start" tabIndex={-1}>
                  Question {attempt.currentQuestion + 1}{" "}
                  <span className="muted">/ {exam.questions.length}</span>
                </span>
                <span className="topic-label">
                  {
                    exam.manifest.sections.find((s) => s.id === q.section)
                      ?.title
                  }{" "}
                  · {q.topic}
                </span>
              </div>
              <article className="question-content">
                <ScientificContent
                  blocks={q.stem}
                  examId={exam.manifest.examId}
                />
              </article>
              <div className="choices" role="group" aria-label="Answer choices">
                {[...q.choices]
                  .sort((a, b) => a.key.localeCompare(b.key))
                  .map((choice) => (
                    <div
                      key={choice.key}
                      className={`choice ${response.choice === choice.key ? "selected" : ""}`}
                    >
                      <button
                        className="choice-select"
                        aria-label={`Choose ${choice.key}`}
                        aria-pressed={response.choice === choice.key}
                        onClick={() =>
                          mutate({
                            questionId: q.id,
                            setChoice: true,
                            choice: choice.key,
                          })
                        }
                      >
                        <span className="choice-letter">{choice.key}</span>
                        {response.choice === choice.key && <Check size={14} />}
                      </button>
                      <div
                        className="choice-content"
                        onClick={(e) => {
                          if (
                            !(e.target as HTMLElement).closest("button,dialog")
                          )
                            mutate({
                              questionId: q.id,
                              setChoice: true,
                              choice: choice.key,
                            });
                        }}
                      >
                        <ScientificContent
                          blocks={choice.content}
                          examId={exam.manifest.examId}
                        />
                      </div>
                    </div>
                  ))}
              </div>
              <div className="question-tools">
                <button
                  className={response.flagged ? "flagged-button" : ""}
                  aria-pressed={response.flagged}
                  onClick={() =>
                    mutate({ questionId: q.id, flagged: !response.flagged })
                  }
                >
                  <Flag size={16} />
                  {response.flagged ? "Flagged for review" : "Flag for review"}
                  <kbd>F</kbd>
                </button>
                <button
                  className="quiet"
                  disabled={!response.choice}
                  onClick={() =>
                    mutate({ questionId: q.id, setChoice: true, choice: null })
                  }
                >
                  <X size={15} /> Clear answer
                </button>
              </div>
              <div className="note-box">
                <label htmlFor="question-note">
                  <FileText size={15} /> Personal note{" "}
                  <span>Saved with this attempt</span>
                </label>
                <textarea
                  id="question-note"
                  value={response.note}
                  maxLength={5000}
                  placeholder="Record an idea, an assumption, or something to revisit…"
                  onChange={(e) =>
                    mutate({ questionId: q.id, note: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="question-footer">
              <button
                disabled={attempt.currentQuestion === 0}
                onClick={() => navigate(attempt.currentQuestion - 1)}
              >
                <ArrowLeft size={16} /> Previous
              </button>
              <span className="shortcut-hint">
                <kbd>A</kbd>–<kbd>D</kbd> answer <span>·</span> <kbd>←</kbd>
                <kbd>→</kbd> navigate
              </span>
              <div>
                <button
                  className="quiet"
                  disabled={
                    attempt.currentQuestion === exam.questions.length - 1
                  }
                  onClick={() => navigate(attempt.currentQuestion + 1)}
                >
                  Skip
                </button>
                <button
                  className="primary"
                  disabled={
                    attempt.currentQuestion === exam.questions.length - 1
                  }
                  onClick={() => navigate(attempt.currentQuestion + 1)}
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
          <aside className="exam-sidebar">
            <div
              className={`timer-card ${remaining < 300000 ? "low-time" : ""}`}
            >
              <p>
                <Clock3 size={16} /> TIME REMAINING
              </p>
              <div className="timer" aria-label="Time remaining">
                {formatTime(remaining)}
              </div>
              <span>Closing the app pauses your time.</span>
            </div>
            <div className="progress-counts">
              <div>
                <strong>{c.answered}</strong>
                <span>Answered</span>
              </div>
              <div>
                <strong>{c.unanswered}</strong>
                <span>Unanswered</span>
              </div>
              <div>
                <strong>{c.flagged}</strong>
                <span>Flagged</span>
              </div>
            </div>
            <div className="progress-track">
              <div
                style={{
                  width: `${(100 * c.answered) / exam.questions.length}%`,
                }}
              />
            </div>
            <div className="navigator-heading">
              <h2>Question navigator</h2>
              <span>
                {attempt.currentQuestion + 1} / {exam.questions.length}
              </span>
            </div>
            <div className="question-grid">
              {exam.questions.map((question, i) => {
                const r = attempt.responses.find(
                  (r) => r.questionId === question.id,
                )!;
                return (
                  <button
                    key={question.id}
                    className={`${r.choice ? "answered" : ""} ${r.flagged ? "flagged" : ""} ${i === attempt.currentQuestion ? "current" : ""}`}
                    aria-label={`Question ${i + 1}, ${r.choice ? "answered" : "unanswered"}${r.flagged ? ", flagged" : ""}`}
                    aria-current={
                      i === attempt.currentQuestion ? "step" : undefined
                    }
                    onClick={() => navigate(i)}
                  >
                    {i + 1}
                    {r.flagged && <span className="flag-dot">◆</span>}
                    {r.choice && <span className="answer-mark">✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="grid-legend">
              <span>
                <i className="answered" /> Answered ✓
              </span>
              <span>
                <i className="current" /> Current
              </span>
              <span>
                <i className="flagged" /> Flagged ◆
              </span>
            </div>
            <div className="submit-area">
              <button
                className="primary"
                onClick={() => setConfirm(true)}
                disabled={!!busy || dirty}
              >
                <ListChecks size={18} /> Submit examination
              </button>
              <p>
                Review your answers before submitting.
                <br />
                Solutions unlock after submission.
              </p>
            </div>
          </aside>
        </main>
      )}
      {page === "results" && exam && attempt && (
        <Results
          exam={exam}
          attempt={attempt}
          solutions={solutions}
          onLibrary={() => {
            setPage("library");
            refreshLibrary().catch((e) => setError(String(e)));
          }}
          onRetake={() => start(exam.manifest.examId)}
        />
      )}
      {page === "qa" && (
        <main className="library">
          <p className="eyebrow">SCIENTIFIC RENDERING</p>
          <h1>Rendering validation</h1>
          <p className="muted">
            Import SPHO_SAMPLE_VALIDATION.zip, then open its questions. The ten
            cases are listed below; solutions are available after submission.
          </p>
          <ol className="qa-list">
            {[
              "Vietnamese text with complex diacritics",
              "Inline mathematics",
              "Display mathematics",
              "Long horizontally scrollable equation",
              "Matrices and cases",
              "Vector SVG physics diagram",
              "PNG scientific graph",
              "Interleaved text, SVG, and WebP figures",
              "Image-based answer choices",
              "Long explanations, tables, shortcuts, and pitfalls",
            ].map((s, i) => (
              <li key={s}>
                <strong>Q{String(i + 1).padStart(3, "0")}</strong>
                {s}
              </li>
            ))}
          </ol>
          <button className="primary" onClick={() => setPage("library")}>
            <ArrowLeft size={16} /> Back to library
          </button>
        </main>
      )}
      {confirm && attempt && c && (
        <Modal title="Submit examination?" onClose={() => setConfirm(false)}>
          <p className="muted">
            Your answers will be final. You can then review the complete
            solutions.
          </p>
          <div className="confirmation-stats">
            <div>
              <strong>{c.answered}</strong>Answered
            </div>
            <div>
              <strong>{c.unanswered}</strong>Unanswered
            </div>
            <div>
              <strong>{c.flagged}</strong>Flagged
            </div>
          </div>
          <p className="remaining-summary">
            <Clock3 size={17} /> {formatTime(remaining)} remaining
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirm(false)}>Continue exam</button>
            <button className="primary" disabled={!!busy} onClick={submit}>
              Confirm submission
            </button>
          </div>
        </Modal>
      )}
      {about && <About onClose={() => setAbout(false)} />}
    </div>
  );
}
