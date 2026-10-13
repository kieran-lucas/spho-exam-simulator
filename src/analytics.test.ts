import { describe, it, expect } from "vitest";
import { analyze, counts, formatTime } from "./analytics";
import type { Exam, Attempt, Solution } from "./models";
const exam = {
  manifest: { sections: [{ id: "one", title: "Vật lý 1" }] },
  questions: [
    { id: "Q9", section: "one", topic: "Mechanics" },
    { id: "Q1", section: "one", topic: "Mechanics" },
    { id: "Q4", section: "one", topic: "Electricity" },
  ],
} as Exam;
const a = {
  responses: [
    { questionId: "Q1", choice: "C", flagged: false },
    { questionId: "Q4", choice: null, flagged: true },
    { questionId: "Q9", choice: "B", flagged: true },
  ],
} as Attempt;
const s = [
  { questionId: "Q4", correctChoice: "A" },
  { questionId: "Q9", correctChoice: "B" },
  { questionId: "Q1", correctChoice: "A" },
] as Solution[];
describe("results linkage and timer presentation", () => {
  it("links by stable IDs, preserves order, and includes unanswered in accuracy", () => {
    const d = analyze(exam, a, s);
    expect(d.rows.map((r) => r.q.id)).toEqual(["Q9", "Q1", "Q4"]);
    expect([d.correct, d.incorrect, d.unanswered]).toEqual([1, 1, 1]);
    expect(d.topics[0].accuracy).toBe(50);
    expect(d.flaggedCorrect).toBe(1);
    expect(d.flagged).toBe(2);
  });
  it("counts flagged answered and unanswered independently", () =>
    expect(counts(a)).toEqual({ answered: 2, unanswered: 1, flagged: 2 }));
  it.each([
    [9000000, "02:30:00"],
    [1, "00:00:01"],
    [0, "00:00:00"],
    [-50, "00:00:00"],
    [61000, "00:01:01"],
  ])("formats %i milliseconds without premature zero", (ms, expected) =>
    expect(formatTime(ms)).toBe(expected),
  );
});
