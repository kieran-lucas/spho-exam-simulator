// Production EXE verification via WebView2 CDP. No mock IPC, no test features, no frontend server.
import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const exe = resolve("src-tauri/target/release/spho-exam-simulator.exe");
const output = resolve("test-results/native");
mkdirSync(output, { recursive: true });
const env = {
  ...process.env,
  SPHO_DATA_DIR: resolve(output, `data-${Date.now()}`),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222",
  WEBVIEW2_USER_DATA_FOLDER: resolve(output, `webview-${Date.now()}`),
};
const run = () => spawn(exe, [], { env, windowsHide: true, stdio: "pipe" });
let child = run();
let browser;
async function attach() {
  for (let i = 0; i < 100; i++) {
    try {
      const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
      const p = b.contexts()[0].pages()[0];
      if (p) {
        await p.waitForLoadState();
        return { b, p };
      }
      await b.close();
    } catch {}
    await delay(200);
  }
  throw new Error("Cannot attach to the native WebView2 instance");
}
async function nativeClose(page) {
  const closed = new Promise((r) => child.once("exit", r));
  const helper = spawn(
    "python",
    [resolve("scripts/native-picker.py"), String(child.pid), "--close"],
    { windowsHide: true, stdio: "inherit" },
  );
  await new Promise((res, rej) => {
    helper.once("error", rej);
    helper.once("exit", (code) =>
      code === 0 ? res() : rej(Error("Native close helper failed")),
    );
  });
  await Promise.race([
    closed,
    delay(10000).then(() => {
      throw Error("Native close was not acknowledged");
    }),
  ]);
}
async function pick(page, fixture) {
  await page.getByRole("button", { name: "Import examination ZIP" }).click();
  const picker = spawn(
    "python",
    [resolve("scripts/native-picker.py"), String(child.pid), resolve(fixture)],
    { windowsHide: true, stdio: "inherit" },
  );
  await new Promise((res, rej) => {
    picker.once("error", rej);
    picker.once("exit", (code) =>
      code === 0 ? res() : rej(Error("Native picker failed")),
    );
  });
}
async function windowAction(action) {
  const helper = spawn(
    "python",
    [resolve("scripts/native-picker.py"), String(child.pid), action],
    { windowsHide: true, stdio: "inherit" },
  );
  await new Promise((res, rej) => {
    helper.once("error", rej);
    helper.once("exit", (code) =>
      code === 0 ? res() : rej(Error(`Native ${action} failed`)),
    );
  });
}
try {
  ({ b: browser, p: globalThis.nativePage } = await attach());
  let page = globalThis.nativePage;
  page.on("console", (m) => {
    if (m.type() === "error") console.error("WebView:", m.text());
  });
  await expect(
    page.getByRole("heading", { name: "Examination library" }),
  ).toBeVisible();
  await pick(page, "fixtures/SPHO_SAMPLE_VALIDATION.zip");
  await expect(
    page.getByRole("heading", {
      name: "SPhO — Scientific Rendering Validation",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start examination" }).click();
  await page.getByRole("button", { name: "Choose B", exact: true }).click();
  await page.keyboard.press("f");
  await page
    .getByLabel("Personal note")
    .fill("Native Windows close and resume verification.");
  await expect(page.getByText("All changes saved")).toBeVisible();
  const before = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("active_attempt"),
  );
  await nativeClose(page);
  await browser.close();
  await delay(1500);
  child = run();
  ({ b: browser, p: page } = await attach());
  await expect(
    page.getByRole("button", { name: "Question 1, answered, flagged" }),
  ).toBeVisible();
  await expect(page.getByLabel("Personal note")).toHaveValue(
    "Native Windows close and resume verification.",
  );
  const after = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("active_attempt"),
  );
  expect(after.elapsedMs - before.elapsedMs).toBeLessThan(1400);
  await windowAction("--minimize");
  await delay(1600);
  const minimized = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("active_attempt"),
  );
  expect(minimized.elapsedMs - after.elapsedMs).toBeGreaterThanOrEqual(1500);
  await windowAction("--restore");
  await browser.contexts()[0].setOffline(true);
  await page.getByRole("button", { name: /^Question 8,/ }).click();
  await expect(page.locator(".science-figure img")).toHaveCount(2);
  for (const img of await page.locator(".science-figure img").all())
    await expect(img).toHaveJSProperty("complete", true);
  await page.screenshot({ path: resolve(output, "offline-exam.png") });
  await page.getByRole("button", { name: "Submit examination" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(page.getByTestId("score")).toHaveText("1 / 10");
  await page.screenshot({ path: resolve(output, "results.png") });
  await browser.contexts()[0].setOffline(false);
  await page.getByRole("button", { name: "Back to library" }).click();
  await pick(page, "fixtures/SPHO_TIMEOUT_VALIDATION.zip");
  await page
    .getByRole("article")
    .filter({ hasText: "Timer QA — 3 second timeout" })
    .getByRole("button", { name: "Start examination" })
    .click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  await delay(4000);
  const durable = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        "import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute(\"SELECT status,elapsed_ms,score FROM attempts WHERE exam_id='spho-timeout-validation'\").fetchone()))",
        resolve(env.SPHO_DATA_DIR, "spho.sqlite3"),
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(durable).toEqual(["submitted", 3000, 0]);
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  // Disabling execution can discard an IPC callback in WebView2. Reload the view
  // to verify crash-style recovery from the durable result, then test a normal live timeout.
  await page.reload();
  const timeoutCard = page
    .getByRole("article")
    .filter({ hasText: "Timer QA — 3 second timeout" });
  await timeoutCard.locator("summary").click();
  await timeoutCard.locator(".history-row").first().click();
  await expect(page.getByTestId("score")).toHaveText("0 / 10");
  await page.getByRole("button", { name: "Retake examination" }).click();
  await expect(page.getByTestId("score")).toHaveText("0 / 10", {
    timeout: 15000,
  });
  await nativeClose(page);
  await browser.close();
  writeFileSync(
    resolve(output, "verification.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        executable: exe,
        launch: true,
        nativePicker: true,
        gracefulClose: true,
        resume: true,
        offlineExam: true,
        score: 1,
        timeoutSubmission: true,
        minimizedTimer: true,
        timeoutWithoutJavaScript: true,
        dataDirectory: env.SPHO_DATA_DIR,
      },
      null,
      2,
    ),
  );
  console.log(
    "Native production EXE: launch, picker, persistence, close/resume, offline figures, scoring, timeout — PASS",
  );
} catch (e) {
  if (browser) {
    try {
      const p = browser.contexts()[0]?.pages()[0];
      if (p) {
        console.error(await p.locator("body").innerText());
        await p.screenshot({ path: resolve(output, "failure.png") });
      }
    } catch {}
  }
  throw e;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
