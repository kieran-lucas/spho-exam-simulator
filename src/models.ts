import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const blockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("markdown"),
      content: z.string().min(1).max(100000),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      src: z.string(),
      alt: z.string().min(1),
      caption: z.string().default(""),
    })
    .strict(),
]);
export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema).min(1).max(200);
export const questionSchema = z
  .object({
    id,
    section: id,
    topic: z.string().min(1),
    tags: z.array(z.string()),
    stem: blocksSchema,
    choices: z
      .array(
        z
          .object({ key: z.enum(["A", "B", "C", "D"]), content: blocksSchema })
          .strict(),
      )
      .length(4),
  })
  .strict();
export const solutionSchema = z
  .object({
    questionId: id,
    correctChoice: z.enum(["A", "B", "C", "D"]),
    explanation: blocksSchema,
    shortcut: blocksSchema.optional(),
    pitfalls: blocksSchema.optional(),
  })
  .strict();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal("spho-exam/1.0"),
    examId: id,
    title: z.string().min(1),
    description: z.string(),
    durationSeconds: z.number().int().min(1).max(86400),
    questionCount: z.number().int().min(1).max(500),
    sections: z
      .array(
        z
          .object({
            id,
            title: z.string().min(1),
            questionCount: z.number().int().min(1).max(500),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const stagedSchema = z.object({
  token: z.string(),
  manifest: manifestSchema,
  questions: z.array(questionSchema),
  solutions: z.array(solutionSchema),
  duplicate: z.string().nullable(),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Key = "A" | "B" | "C" | "D";
export interface Exam {
  manifest: Manifest;
  questions: Question[];
}
export interface Response {
  questionId: string;
  choice: Key | null;
  flagged: boolean;
  note: string;
  viewingMs: number;
}
export interface Attempt {
  id: string;
  examId: string;
  status: "active" | "submitted";
  startedAt: string;
  submittedAt: string | null;
  elapsedMs: number;
  currentQuestion: number;
  score: number | null;
  responses: Response[];
}
export interface LibraryExam {
  manifest: Manifest;
  hash: string;
  importedAt: string;
  attempts: Attempt[];
}
export interface Change {
  questionId: string;
  setChoice?: boolean;
  choice?: Key | null;
  flagged?: boolean;
  note?: string;
  currentQuestion?: number;
}
