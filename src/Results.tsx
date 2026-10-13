import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Flag,
  RotateCcw,
  Clock3,
} from "lucide-react";
import type { Attempt, Exam, Solution } from "./models";
import { analyze, formatTime } from "./analytics";
import { ScientificContent } from "./components/ScientificContent";
type Filter = "all" | "incorrect" | "unanswered" | "flagged" | "correct";
export function Results({
  exam,
  attempt,
  solutions,
  onLibrary,
  onRetake,
}: {
  exam: Exam;
  attempt: Attempt;
  solutions: Solution[];
  onLibrary: () => void;
  onRetake: () => void;
}) {
  const data = useMemo(
    () => analyze(exam, attempt, solutions),
    [exam, attempt, solutions],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [index, setIndex] = useState(0);
  const [tab, setTab] = useState<"summary" | "review">("summary");
  const rows = data.rows.filter(
    (r) =>
      filter === "all" ||
      (filter === "flagged" ? r.r.flagged : r.status === filter),
  );
  const row = rows[Math.min(index, rows.length - 1)];
  return (
    <main className="results">
      <div className="page-heading">
        <div>
          <p className="eyebrow">EXAMINATION COMPLETE</p>
          <h1>{exam.manifest.title}</h1>
          <p className="muted">
            Submitted {new Date(attempt.submittedAt!).toLocaleString("vi-VN")} ·
            Attempt saved locally
          </p>
        </div>
        <div className="button-row">
          <button onClick={onLibrary}>Back to library</button>
          <button className="primary" onClick={onRetake}>
            <RotateCcw size={16} /> Retake examination
          </button>
        </div>
      </div>
      <nav className="tabs" aria-label="Results views">
        <button
          aria-current={tab === "summary" ? "page" : undefined}
          className={tab === "summary" ? "active" : ""}
          onClick={() => setTab("summary")}
        >
          Results summary
        </button>
        <button
          aria-current={tab === "review" ? "page" : undefined}
          className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >
          Question review
        </button>
      </nav>
      {tab === "summary" ? (
        <>
          <div className="result-scorecard">
            <div className="score-main">
              <p className="eyebrow">YOUR SCORE</p>
              <strong data-testid="score">
                {attempt.score}
                <span> / {exam.questions.length}</span>
              </strong>
              <p>
                {((100 * data.correct) / exam.questions.length).toFixed(1)}%
                correct
              </p>
            </div>
            <div className="result-metrics">
              <div>
                <CheckCircle2 className="text-green" size={20} />
                <strong>{data.correct}</strong>
                <span>Correct</span>
              </div>
              <div>
                <XCircle className="text-red" size={20} />
                <strong>{data.incorrect}</strong>
                <span>Incorrect</span>
              </div>
              <div>
                <MinusCircle size={20} />
                <strong>{data.unanswered}</strong>
                <span>Unanswered</span>
              </div>
              <div>
                <Clock3 size={20} />
                <strong className="metric-time">
                  {formatTime(attempt.elapsedMs)}
                </strong>
                <span>Active exam time</span>
              </div>
            </div>
          </div>
          <div className="analytics-grid">
            <section className="panel">
              <h2>Accuracy by topic</h2>
              <p className="muted small">
                Correct answers as a percentage of all questions in each topic.
              </p>
              <div
                className="chart"
                style={{
                  height: Math.max(220, Math.min(600, data.topics.length * 45)),
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.topics}
                    layout="vertical"
                    margin={{ left: 10, right: 25 }}
                  >
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v) => `${Number(v).toFixed(1)}%`}
                      cursor={{ fill: "#eff6ff" }}
                    />
                    <Bar
                      dataKey="accuracy"
                      name="Accuracy"
                      fill="#2563eb"
                      radius={[0, 5, 5, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>Correct / total</th>
                    <th>Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topics.map((g) => (
                    <tr key={g.name}>
                      <td>{g.name}</td>
                      <td>
                        {g.correct} / {g.total}
                      </td>
                      <td>{g.accuracy.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <div>
              <section className="panel">
                <h2>Accuracy by section</h2>
                {data.sections.map((g) => (
                  <div className="section-stat" key={g.name}>
                    <div>
                      <span>{g.name}</span>
                      <strong>
                        {g.correct} / {g.total}{" "}
                        <span className="muted">
                          · {g.accuracy.toFixed(1)}%
                        </span>
                      </strong>
                    </div>
                    <div className="progress-track">
                      <div style={{ width: `${g.accuracy}%` }} />
                    </div>
                  </div>
                ))}
              </section>
              <section className="panel flag-performance">
                <Flag size={22} />
                <h2>Flagged-question performance</h2>
                <p>
                  <strong>
                    {data.flaggedCorrect} / {data.flagged}
                  </strong>{" "}
                  flagged questions answered correctly
                </p>
                <span className="muted small">
                  {data.flagged
                    ? `${((100 * data.flaggedCorrect) / data.flagged).toFixed(1)}% accuracy`
                    : "No questions were flagged in this attempt."}
                </span>
              </section>
              <button
                className="primary review-cta"
                onClick={() => {
                  setTab("review");
                  setFilter("incorrect");
                  setIndex(0);
                }}
              >
                Review incorrect answers <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <section className="review-panel" key="review">
          <div className="review-toolbar">
            <div
              className="filter-buttons"
              role="group"
              aria-label="Review filters"
            >
              {(
                [
                  "all",
                  "incorrect",
                  "unanswered",
                  "flagged",
                  "correct",
                ] as Filter[]
              ).map((f) => (
                <button
                  aria-pressed={filter === f}
                  className={filter === f ? "active" : ""}
                  key={f}
                  onClick={() => {
                    setFilter(f);
                    setIndex(0);
                  }}
                >
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <span className="muted small">{rows.length} questions</span>
          </div>
          {!row ? (
            <div className="empty">
              <CheckCircle2 size={30} />
              <h2>No questions in this filter</h2>
              <p>Choose another filter to continue your review.</p>
            </div>
          ) : (
            <>
              <div className="review-navigation">
                <button
                  disabled={index === 0}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  <ArrowLeft size={16} /> Previous
                </button>
                <select
                  aria-label="Review question"
                  value={row.q.id}
                  onChange={(e) =>
                    setIndex(rows.findIndex((r) => r.q.id === e.target.value))
                  }
                >
                  {rows.map((r) => (
                    <option key={r.q.id} value={r.q.id}>
                      Question {r.index + 1} · {r.q.topic}
                    </option>
                  ))}
                </select>
                <button
                  disabled={index >= rows.length - 1}
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
              <div className="review-body" key={row.q.id}>
                <div className="question-label">
                  <span>
                    Question {row.index + 1}{" "}
                    <small className="muted">{row.q.id}</small>
                  </span>
                  <span className={`status-pill ${row.status}`}>
                    {row.status === "correct" ? (
                      <CheckCircle2 size={15} />
                    ) : row.status === "incorrect" ? (
                      <XCircle size={15} />
                    ) : (
                      <MinusCircle size={15} />
                    )}{" "}
                    {row.status}
                    {row.r.flagged && <Flag size={14} />}
                  </span>
                </div>
                <ScientificContent
                  blocks={row.q.stem}
                  examId={exam.manifest.examId}
                />
                <div className="review-choices">
                  {[...row.q.choices]
                    .sort((a, b) => a.key.localeCompare(b.key))
                    .map((c) => (
                      <div
                        className={`review-choice ${c.key === row.s.correctChoice ? "correct" : ""} ${c.key === row.r.choice && row.status === "incorrect" ? "incorrect" : ""}`}
                        key={c.key}
                      >
                        <strong>{c.key}</strong>
                        <ScientificContent
                          blocks={c.content}
                          examId={exam.manifest.examId}
                        />
                        <span>
                          {c.key === row.s.correctChoice
                            ? "Correct answer"
                            : ""}
                          {c.key === row.r.choice ? " · Your answer" : ""}
                        </span>
                      </div>
                    ))}
                </div>
                <p className="muted small">
                  Your answer: {row.r.choice ?? "Unanswered"} · Correct answer:{" "}
                  {row.s.correctChoice} · Observed viewing time:{" "}
                  {row.r.viewingMs > 0
                    ? formatTime(row.r.viewingMs)
                    : "Unavailable"}
                </p>
                <div className="solution-block">
                  <h3>Full explanation</h3>
                  <ScientificContent
                    blocks={row.s.explanation}
                    examId={exam.manifest.examId}
                  />
                </div>
                {row.s.shortcut && (
                  <div className="solution-block shortcut">
                    <h3>Shortcut / recognition</h3>
                    <ScientificContent
                      blocks={row.s.shortcut}
                      examId={exam.manifest.examId}
                    />
                  </div>
                )}
                {row.s.pitfalls && (
                  <div className="solution-block pitfalls">
                    <h3>Common pitfalls</h3>
                    <ScientificContent
                      blocks={row.s.pitfalls}
                      examId={exam.manifest.examId}
                    />
                  </div>
                )}
                <div className="review-note">
                  <h3>Your original note</h3>
                  <p>{row.r.note || "No note recorded."}</p>
                </div>
                <p className="muted small">
                  Viewing time measures foreground question viewing, not
                  cognitive effort.
                </p>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
