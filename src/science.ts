import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { stagedSchema, type Block } from "./models";

export const mathOptions = {
  strict: "error" as const,
  trust: (context: { command: string }) => {
    throw new Error(
      `Active or external math command forbidden: ${context.command}`,
    );
  },
  maxExpand: 1000,
  maxSize: 50,
  output: "htmlAndMathml" as const,
};
export const remarkPlugins = [remarkGfm, remarkMath];
export const rehypePlugins: [[typeof rehypeKatex, typeof mathOptions]] = [
  [rehypeKatex, mathOptions],
];
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex, mathOptions)
  .use(rehypeStringify);
interface Node {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
export function validateMarkdown(content: string, location: string) {
  const tree = processor.parse(content) as Node;
  function visit(node: Node) {
    if (
      ["html", "image", "link", "imageReference", "linkReference"].includes(
        node.type,
      )
    )
      throw new Error(
        `${location}: HTML, links and Markdown images are forbidden. Use image blocks for figures.`,
      );
    // Unmatched math delimiters otherwise become ordinary text. Check only text nodes after full parsing.
    if (node.type === "text" && node.position) {
      const raw = content.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "\\") {
          i++;
          continue;
        }
        if (raw[i] === "$")
          throw new Error(
            `${location}: unmatched math delimiter. Use $…$ or $$…$$, or escape a literal dollar sign.`,
          );
      }
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  let result;
  try {
    result = processor.processSync(content);
  } catch (e) {
    throw new Error(`${location}: invalid mathematics — ${String(e)}`);
  }
  if (result.messages.length)
    throw new Error(
      `${location}: invalid mathematics — ${result.messages.map((m) => `${m.reason}${m.cause instanceof Error ? `: ${m.cause.message}` : ""}`).join("; ")}`,
    );
  return String(result);
}
export function validateStaged(raw: unknown) {
  const staged = stagedSchema.parse(raw);
  const check = (blocks: Block[], loc: string) =>
    blocks.forEach((b, i) => {
      if (b.type === "markdown")
        validateMarkdown(b.content, `${loc}, block ${i + 1}`);
    });
  for (const q of staged.questions) {
    check(q.stem, `${q.id} stem`);
    for (const c of q.choices) check(c.content, `${q.id} choice ${c.key}`);
  }
  for (const s of staged.solutions) {
    check(s.explanation, `${s.questionId} explanation`);
    if (s.shortcut) check(s.shortcut, `${s.questionId} shortcut`);
    if (s.pitfalls) check(s.pitfalls, `${s.questionId} pitfalls`);
  }
  return staged;
}
