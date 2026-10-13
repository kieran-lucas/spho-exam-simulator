import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { ScientificContent } from "./components/ScientificContent";
import { validateMarkdown, validateStaged } from "./science";
vi.mock("./api", () => ({
  api: { asset: vi.fn(async () => `data:image/svg+xml;base64,PHN2Zy8+`) },
}));
const sample = unzipSync(
  new Uint8Array(readFileSync("fixtures/SPHO_SAMPLE_VALIDATION.zip")),
);
const parse = (key: string) => JSON.parse(strFromU8(sample[key]));
const staged = {
  token: "test",
  manifest: parse("manifest.json"),
  questions: parse("questions.json"),
  solutions: parse("solutions.json"),
  duplicate: null,
};
describe("canonical package and shared scientific renderer", () => {
  it("validates all sample stems, choices and solutions using the display pipeline", () =>
    expect(validateStaged(staged).questions).toHaveLength(10));
  it.each([
    [
      "Vietnamese",
      "Nguyễn chuyển động trong điện trường; ngưỡng, quỹ đạo, nguồn.",
    ],
    ["inline", "$E=\\frac12mv^2$"],
    [
      "display",
      "$$\n\\oint_S\\mathbf E\\cdot d\\mathbf S=Q/\\varepsilon_0\n$$",
    ],
    ["matrix", "$$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$$"],
    ["cases", "$$f(x)=\\begin{cases}x&x>0\\\\0&x\\le0\\end{cases}$$"],
    ["units", "$v=3\\,\\mathrm{m\\,s^{-1}}$"],
    ["atomic", "$^{14}_{6}\\mathrm{C}$"],
    ["aligned", "$$\\begin{aligned}F&=ma\\\\E&=mc^2\\end{aligned}$$"],
  ])("renders %s", (_, text) => {
    const html = validateMarkdown(text, "Q001 stem");
    expect(html).not.toContain("katex-error");
    if (text.includes("$")) expect(html).toContain('class="katex"');
  });
  it.each([
    "$\\notReal{1}$",
    "$\\frac{1}$",
    "$\\href{https://example.com}{x}$",
    "$\\htmlClass{evil}{x}$",
    "unfinished $x+1",
    "$$\\begin{matrix}1&2$$",
    "<script>alert(1)</script>",
    "![x](https://evil.test/x.png)",
    "[x](https://evil.test)",
    "<img src=x onerror=alert(1)>",
  ])("rejects unsafe or unrenderable content: %s", (text) =>
    expect(() => validateMarkdown(text, "Q007 choice B")).toThrow(
      /Q007 choice B/,
    ),
  );
  it("permits escaped literal dollars", () =>
    expect(validateMarkdown("Cost: \\$1.", "Q1")).toContain("$1"));
  it("preserves interleaved content order and image alt text", async () => {
    render(
      <ScientificContent
        examId="sample"
        blocks={[
          { type: "markdown", content: "Văn bản trước $E=mc^2$" },
          {
            type: "image",
            src: "assets/circuit.svg",
            alt: "Sơ đồ vật lý",
            caption: "Chú thích hình",
          },
          { type: "markdown", content: "Văn bản sau" },
        ]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Sơ đồ vật lý" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Chú thích hình")).toBeInTheDocument();
    expect(
      screen
        .getByText("Văn bản sau")
        .compareDocumentPosition(screen.getByRole("img")) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });
  it("handles image-based answer choices", async () => {
    render(
      <ScientificContent
        examId="sample"
        blocks={staged.questions[8].choices[0].content}
      />,
    );
    expect(
      await screen.findByRole("img", {
        name: "Các đường sức hướng ra xa điện tích dương",
      }),
    ).toBeInTheDocument();
  });
  it("renders long solution tables, math, and Vietnamese", () => {
    const { container } = render(
      <ScientificContent
        examId="sample"
        blocks={staged.solutions[9].explanation}
      />,
    );
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(5);
    expect(container.textContent).toContain("Kiểm tra thứ nguyên");
  });
  it("keeps long equations within the math overflow container", () => {
    const { container } = render(
      <ScientificContent examId="sample" blocks={staged.questions[3].stem} />,
    );
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
  });
  it("rejects invalid LaTeX fixture at the correct question location", () => {
    const zip = unzipSync(
      new Uint8Array(readFileSync("fixtures/negative/invalid-latex.zip")),
    );
    expect(() =>
      validateStaged({
        ...staged,
        questions: JSON.parse(strFromU8(zip["questions.json"])),
      }),
    ).toThrow(/Q001 stem, block 1/);
  });
});
