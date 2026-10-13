import { invoke } from "@tauri-apps/api/core";
import type { Attempt, Change, Exam, LibraryExam, Solution } from "./models";
export const api = {
  library: () => invoke<LibraryExam[]>("library"),
  active: () => invoke<Attempt | null>("active_attempt"),
  exam: (examId: string) => invoke<Exam>("load_exam", { examId }),
  attempt: (attemptId: string) =>
    invoke<Attempt>("load_attempt", { attemptId }),
  start: (examId: string) => invoke<Attempt>("start_attempt", { examId }),
  change: (attemptId: string, change: Change) =>
    invoke<Attempt>("change_attempt", { attemptId, change }),
  submit: (attemptId: string) =>
    invoke<Attempt>("submit_attempt", { attemptId }),
  solutions: (attemptId: string) =>
    invoke<Solution[]>("load_solutions", { attemptId }),
  asset: (examId: string, path: string) =>
    invoke<string>("load_asset", { examId, path }),
  stage: () => invoke<unknown | null>("stage_import"),
  commit: (token: string) => invoke<string>("commit_import", { token }),
  cancel: () => invoke<void>("cancel_import"),
  close: () => invoke<void>("finish_close"),
};
