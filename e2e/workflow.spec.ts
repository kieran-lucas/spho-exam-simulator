import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
class NativeBridge {
  process!: ChildProcessWithoutNullStreams;
  queue: { resolve: (v: any) => void; reject: (v: any) => void }[] = [];
  fixture = resolve("fixtures/SPHO_SAMPLE_VALIDATION.zip");
  failNextChange = false;
  expireNextChange = false;
  constructor(public database: string) {
    this.start();
  }
  start() {
    this.process = spawn(resolve("src-tauri/target/debug/spho-qa.exe"), [
      this.database,
    ]);
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      const pending = this.queue.shift()!;
      const v = JSON.parse(line);
      if (v.error) pending.reject(new Error(v.error));
      else pending.resolve(v.ok);
    });
    this.process.stderr.on("data", (v) => process.stderr.write(v));
  }
  call(cmd: string, args: Record<string, unknown> = {}) {
    if (cmd === "change_attempt" && this.expireNextChange) {
      this.expireNextChange = false;
      return this.call("qa_advance", { ms: 9_001_000 }).then(() =>
        this.call(cmd, args),
      );
    }
    if (cmd === "change_attempt" && this.failNextChange) {
      this.failNextChange = false;
      return Promise.reject(new Error("Injected transient write failure"));
    }
    if (cmd === "stage_import") args = { ...args, fixture: this.fixture };
    return new Promise<any>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.process.stdin.write(JSON.stringify({ cmd, args }) + "\n");
    });
  }
  async stop() {
    if (this.process.exitCode !== null) return;
    await new Promise<void>((r) => {
      this.process.once("exit", () => r());
      this.process.stdin.end();
    });
  }
}
let bridge: NativeBridge;
let temp: string;
async function install(page: Page) {
  await page.exposeFunction(
    "__nativeInvoke",
    (cmd: string, args: Record<string, unknown>) => {
      if (cmd.startsWith("plugin:event|")) return 1;
      return bridge.call(cmd, args ?? {});
    },
  );
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: any) =>
        (window as any).__nativeInvoke(cmd, args),
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  });
}
test.beforeEach(async ({ page }) => {
  mkdirSync(resolve("test-results"), { recursive: true });
  temp = mkdtempSync(join(resolve("test-results"), "db-"));
  bridge = new NativeBridge(join(temp, "qa.sqlite3"));
  await install(page);
});
test.afterEach(async () => {
  await bridge.stop();
  rmSync(temp, { recursive: true, force: true });
});
async function importSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await expect(
    page.getByRole("heading", {
      name: "SPhO — Scientific Rendering Validation",
    }),
  ).toBeVisible();
}
test("real Rust/SQLite workflow: import, autosave, close/reopen, score, review, retake history", async ({
  page,
}) => {
  await importSample(page);
  await page.getByRole("button", { name: "Start examination" }).click();
  await page.getByRole("button", { name: "Choose B", exact: true }).click();
  await page.keyboard.press("f");
  await page
    .getByLabel("Personal note")
    .fill("Giữ điện tích không đổi — ghi chú bền vững");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  let before = await bridge.call("active_attempt");
  expect(
    before.responses.find((r: any) => r.questionId === "Q001"),
  ).toMatchObject({
    choice: "B",
    flagged: true,
    note: "Giữ điện tích không đổi — ghi chú bền vững",
  });
  await page.goto("about:blank");
  await bridge.call("finish_close");
  await bridge.stop();
  await page.waitForTimeout(1200);
  bridge.start();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Question 1, answered, flagged" }),
  ).toBeVisible();
  const restored = await bridge.call("active_attempt");
  expect(restored.elapsedMs - before.elapsedMs).toBeLessThan(1100);
  expect(restored.currentQuestion).toBe(1);
  await page
    .getByRole("button", { name: "Question 1, answered, flagged" })
    .click();
  await expect(page.getByLabel("Personal note")).toHaveValue(
    "Giữ điện tích không đổi — ghi chú bền vững",
  );
  await page.getByRole("button", { name: "Submit examination" }).click();
  await expect(page.getByRole("dialog")).toContainText("9");
  await page.getByRole("button", { name: "Continue exam" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit examination" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByTestId("score")).toHaveText("1 / 10");
  await page.getByRole("button", { name: "Question review" }).click();
  await expect(
    page.getByRole("heading", { name: "Full explanation" }),
  ).toBeVisible();
  await expect(
    page.getByText("Giữ điện tích không đổi — ghi chú bền vững"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unanswered", exact: true }).click();
  await expect(page.getByText("9 questions", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Incorrect", exact: true }).click();
  await expect(page.getByText("No questions in this filter")).toBeVisible();
  await page.getByRole("button", { name: "Retake examination" }).click();
  await expect(
    page.getByRole("button", { name: "Question 1, unanswered", exact: true }),
  ).toBeVisible();
  const items = await bridge.call("library");
  expect(items[0].attempts).toHaveLength(2);
  expect(
    items[0].attempts.filter((a: any) => a.status === "submitted")[0].score,
  ).toBe(1);
});
test("timeout automatically freezes and scores an attempt once", async ({
  page,
}) => {
  bridge.fixture = resolve("fixtures/SPHO_TIMEOUT_VALIDATION.zip");
  await page.goto("/");
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await page.getByRole("button", { name: "Start examination" }).click();
  await page.getByRole("button", { name: "Choose B", exact: true }).click();
  await bridge.call("qa_advance", { ms: 4000 });
  await expect(page.getByTestId("score")).toHaveText("1 / 10");
  const items = await bridge.call("library");
  expect(items[0].attempts).toHaveLength(1);
  expect(items[0].attempts[0].elapsedMs).toBe(3000);
});
test("invalid math and unsafe SVG never leave a partial library entry; duplicates preserve history", async ({
  page,
}) => {
  await page.goto("/");
  bridge.fixture = resolve("fixtures/negative/invalid-latex.zip");
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await expect(page.getByRole("alert")).toContainText("Q001 stem");
  expect(await bridge.call("library")).toHaveLength(0);
  bridge.fixture = resolve("fixtures/negative/unsafe-svg.zip");
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await expect(page.getByRole("alert")).toContainText("Q006");
  expect(await bridge.call("library")).toHaveLength(0);
  bridge.fixture = resolve("fixtures/SPHO_SAMPLE_VALIDATION.zip");
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await expect(
    page.getByRole("heading", {
      name: "SPhO — Scientific Rendering Validation",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await expect(page.getByRole("status")).toContainText("identical");
  expect(await bridge.call("library")).toHaveLength(1);
});
test("all ten rendering cases, image zoom, keyboard safety and full-size layout screenshots", async ({
  page,
}, testInfo) => {
  await importSample(page);
  await page.getByRole("button", { name: "Start examination" }).click();
  for (let i = 1; i <= 10; i++) {
    await page
      .getByRole("button", { name: new RegExp(`^Question ${i},`) })
      .click();
    await expect(
      page.locator(".question-content .scientific-content"),
    ).toBeVisible();
    await expect(page.locator(".katex-error,.figure-error")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    for (const image of await page.locator(".question-scroll img").all())
      await expect(image).toHaveJSProperty("complete", true);
    await page.screenshot({
      path: testInfo.outputPath(`case-${String(i).padStart(2, "0")}.png`),
    });
  }
  await page.getByRole("button", { name: /^Question 6,/ }).click();
  await page.getByRole("button", { name: /Enlarge figure/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit to window" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Personal note").fill("abcd f");
  await expect(
    page.getByRole("button", { name: "Choose A", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Personal note").press("ArrowRight");
  await expect(
    page.getByText("Question 6", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit examination" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await page.getByRole("button", { name: "Question review" }).click();
  await page.getByLabel("Review question").selectOption("Q010");
  await expect(page.locator(".review-body table")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("long-explanation.png") });
  await page.getByRole("button", { name: "Back to library" }).click();
  bridge.fixture = resolve("fixtures/SPHO_SYNTHETIC_100.zip");
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: "SYNTHETIC — 100-item stress test" })
    .getByRole("button", { name: "Start examination" })
    .click();
  await expect(page.locator(".question-grid button")).toHaveCount(100);
  for (const [width, height] of [
    [1366, 768],
    [1536, 864],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("button", { name: "Submit examination" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: /^Question 100,/ }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`stress-${width}.png`) });
  }
});
test("normal operation makes no external network requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:1420") &&
      !r.url().startsWith("data:")
    )
      requests.push(r.url());
  });
  await importSample(page);
  await page.getByRole("button", { name: "Start examination" }).click();
  await page.getByRole("button", { name: /^Question 8,/ }).click();
  await expect(page.locator(".science-figure img")).toHaveCount(2);
  await page.getByRole("button", { name: "Submit examination" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByTestId("score")).toBeVisible();
  expect(requests).toEqual([]);
});

test("an edit racing the deadline still opens the immutable result", async ({
  page,
}) => {
  await importSample(page);
  await page.getByRole("button", { name: "Start examination" }).click();
  bridge.expireNextChange = true;
  await page.getByRole("button", { name: "Choose B", exact: true }).click();
  await expect(page.getByTestId("score")).toHaveText("0 / 10");
  await expect(page.getByRole("button", { name: "Retry saving" })).toHaveCount(
    0,
  );
  const items = await bridge.call("library");
  expect(items[0].attempts[0].status).toBe("submitted");
});

test("scientific content stays readable at common display scale factors", async ({
  browser,
}, testInfo) => {
  for (const factor of [1.25, 1.5, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: factor,
    });
    const page = await context.newPage();
    await install(page);
    if (factor === 1.25) {
      await importSample(page);
      await page.getByRole("button", { name: "Start examination" }).click();
    } else await page.goto("/");
    await page.getByRole("button", { name: /^Question 5,/ }).click();
    await expect(
      page.locator(".question-content .katex-display"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit examination" }),
    ).toBeInViewport();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`scale-${factor}.png`) });
    await context.close();
  }
});

test("failed edits block submission and retry in order without losing newer changes", async ({
  page,
}) => {
  await importSample(page);
  await page.getByRole("button", { name: "Start examination" }).click();
  bridge.failNextChange = true;
  await page.getByRole("button", { name: "Choose A", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Injected transient write failure",
  );
  await page.getByRole("button", { name: "Choose B", exact: true }).click();
  await page.getByLabel("Personal note").fill("Newest note stays intact");
  await expect(
    page.getByRole("button", { name: "Submit examination" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await bridge.call("active_attempt");
  expect(
    saved.responses.find((r: any) => r.questionId === "Q001"),
  ).toMatchObject({ choice: "B", note: "Newest note stays intact" });
  await expect(
    page.getByRole("button", { name: "Choose B", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
