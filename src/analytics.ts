import type { Attempt, Exam, Solution } from "./models";
export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function counts(a: Attempt) {
  return {
    answered: a.responses.filter((r) => r.choice !== null).length,
    unanswered: a.responses.filter((r) => r.choice === null).length,
    flagged: a.responses.filter((r) => r.flagged).length,
  };
}
export function analyze(exam: Exam, a: Attempt, solutions: Solution[]) {
  const sm = new Map(solutions.map((s) => [s.questionId, s]));
  const rm = new Map(a.responses.map((r) => [r.questionId, r]));
  const rows = exam.questions.map((q, i) => {
    const r = rm.get(q.id)!;
    const s = sm.get(q.id)!;
    return {
      q,
      r,
      s,
      index: i,
      status:
        r.choice === null
          ? "unanswered"
          : r.choice === s.correctChoice
            ? "correct"
            : "incorrect",
    };
  });
  function group(key: "topic" | "section") {
    const map = new Map<
      string,
      { name: string; correct: number; total: number; accuracy: number }
    >();
    for (const row of rows) {
      const id = row.q[key];
      const name =
        key === "section"
          ? exam.manifest.sections.find((s) => s.id === id)!.title
          : id;
      const v = map.get(id) ?? { name, correct: 0, total: 0, accuracy: 0 };
      v.total++;
      if (row.status === "correct") v.correct++;
      v.accuracy = (100 * v.correct) / v.total;
      map.set(id, v);
    }
    return [...map.values()];
  }
  return {
    rows,
    topics: group("topic"),
    sections: group("section"),
    correct: rows.filter((r) => r.status === "correct").length,
    incorrect: rows.filter((r) => r.status === "incorrect").length,
    unanswered: rows.filter((r) => r.status === "unanswered").length,
    flagged: rows.filter((r) => r.r.flagged).length,
    flaggedCorrect: rows.filter((r) => r.r.flagged && r.status === "correct")
      .length,
  };
}
