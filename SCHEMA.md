# Canonical question package: `spho-exam/1.0`

This contract is implemented by the Rust importer and the shared frontend Markdown/math validator. It is intended to be provided to an independent ChatGPT question generator. Working reference: `fixtures/SPHO_SAMPLE_VALIDATION.zip`. Machine-readable shapes: `schema/manifest.schema.json`, `schema/questions.schema.json`, and `schema/solutions.schema.json`. Cross-file relationships, file safety, and mathematical renderability also require the checks below; JSON Schema alone cannot verify them.

## ZIP structure

```text
EXAM.zip
├── manifest.json
├── questions.json
├── solutions.json
└── assets/
    ├── figure.svg
    ├── plot.png
    └── image.webp
```

All JSON files are UTF-8, without a BOM. Files are at the ZIP root (do not wrap them in another directory). Only these three root JSON files and assets beneath `assets/` with lowercase `.svg`, `.png`, or `.webp` extensions are accepted. Directory entries are optional. Extra files, unknown JSON fields, unknown content block types, duplicate file entries, symlinks, and encrypted ZIP entries are rejected. Use ordinary stored or Deflate ZIP compression.

All IDs (`examId`, question `id`, section `id`) contain 1–100 ASCII letters/digits/underscore/hyphen: `[A-Za-z0-9_-]{1,100}`. IDs are case sensitive and stable, independent of position. Asset paths are case sensitive and relative to the ZIP root. Paths must be at most 240 characters, must not contain backslashes, colons, percent signs, control characters, absolute paths, empty components, `.` or `..` components, or components ending in a space or dot.

## manifest.json

```json
{
  "schemaVersion": "spho-exam/1.0",
  "examId": "spho-mock-01",
  "title": "SPhO Mock Examination 01",
  "description": "Overload Physics Practice",
  "durationSeconds": 9000,
  "questionCount": 100,
  "sections": [
    { "id": "physics-1", "title": "Vật lý 1", "questionCount": 50 },
    { "id": "physics-2", "title": "Vật lý 2", "questionCount": 50 }
  ]
}
```

All fields shown are required. The schema identifier is exact; unsupported versions are rejected. `title` is nonempty and at most 500 UTF-8 bytes; `description` can be empty and is at most 10,000 bytes. Duration is an integer from 1 to 86,400 seconds; question count is an integer from 1 to 500. **Production SPhO packages should use 100 questions and 9000 seconds.** Smaller development/validation packages use the identical schema and execution mode. Sections must be nonempty, have unique valid IDs and nonempty titles, and each declare the exact positive count of questions that reference it. Actual total and section counts must match the declarations.

## questions.json

A JSON array, in the exact order students should see questions:

```json
[
  {
    "id": "Q001",
    "section": "physics-2",
    "topic": "Electrostatics",
    "tags": ["capacitor", "energy"],
    "stem": [
      {
        "type": "markdown",
        "content": "Tụ đã ngắt nguồn. Ta có $U=Q^2/(2C)$. Nếu $d$ tăng gấp đôi thì $U$ thay đổi thế nào?"
      },
      {
        "type": "image",
        "src": "assets/q001.svg",
        "alt": "Sơ đồ tụ điện phẳng",
        "caption": ""
      }
    ],
    "choices": [
      {
        "key": "A",
        "content": [{ "type": "markdown", "content": "Giảm một nửa" }]
      },
      {
        "key": "B",
        "content": [{ "type": "markdown", "content": "Không đổi" }]
      },
      {
        "key": "C",
        "content": [{ "type": "markdown", "content": "Tăng gấp đôi" }]
      },
      {
        "key": "D",
        "content": [{ "type": "markdown", "content": "Tăng gấp bốn" }]
      }
    ]
  }
]
```

Every field is required. Each question has a unique ID, a known section ID, a nonempty topic (at most 500 bytes), and a tags array (may be empty; at most 100 tags, each at most 500 bytes). There are exactly four choices with unique keys A, B, C, D. The interface presents choices in A/B/C/D order. Question order and the order of blocks within each stem/choice are preserved. IDs never depend on display order. This example shows one item only; actual file length must match `questionCount`.

## Content blocks

Exactly two block shapes are supported in version 1:

```json
{ "type": "markdown", "content": "Văn bản và $E=mc^2$." }
```

```json
{
  "type": "image",
  "src": "assets/figure.svg",
  "alt": "Mô tả hình",
  "caption": "Chú thích tùy chọn"
}
```

All content arrays contain 1–200 blocks. Markdown must not be blank and is at most 100,000 UTF-8 bytes per block. Image `src` and nonblank `alt` are required. `caption` can be absent or an empty string (default empty). Alt text is at most 2,000 bytes; caption at most 5,000 bytes. Captions and alt text are plain text, without Markdown/math parsing. Use a separate Markdown block for mathematical captions. Empty optional solution arrays should be omitted instead of supplied as `[]`.

Use multiple ordered blocks to interleave prose, display equations, and figures. The same blocks are supported in stems, choices, explanations, shortcuts, and pitfalls. Do not encode diagrams as plain text. Do not add new block types without a new schema version.

## solutions.json

```json
[
  {
    "questionId": "Q001",
    "correctChoice": "C",
    "explanation": [
      {
        "type": "markdown",
        "content": "Ngắt nguồn nên $Q$ không đổi. Vì $C\\propto 1/d$ và $U=Q^2/(2C)$ nên $U\\propto d$."
      }
    ],
    "shortcut": [
      {
        "type": "markdown",
        "content": "Nhận diện điều kiện **ngắt nguồn**: $Q$ không đổi."
      }
    ],
    "pitfalls": [
      {
        "type": "markdown",
        "content": "Không dùng điều kiện $V$ không đổi của tụ vẫn nối nguồn."
      }
    ]
  }
]
```

`questionId`, `correctChoice`, and `explanation` are required. Every question has exactly one solution; no extra, duplicate, or missing references are allowed. Correct choice is exactly A/B/C/D. `shortcut` and `pitfalls` are optional nonempty content arrays, not strings and not null. All explanation fields use the same ordered content block format. Solutions are validated transiently during import but not displayed in import metadata or active exam screens; normal backend solution retrieval requires a submitted attempt.

## Markdown and math

The app uses React Markdown with Remark GFM, Remark Math, and Rehype KaTeX. Supported prose: paragraphs, bold/italic, lists, basic GFM tables, and Markdown hard line breaks (two spaces before newline or backslash-newline). Separate paragraphs with a blank line. HTML, links, Markdown image syntax, and reference links/images are forbidden. Figures use image blocks. Plain text that looks like an HTTP URL may be autolinked by GFM and rejected; omit URLs entirely.

Use `$...$` for inline math and `$$...$$` for display math. Put display delimiters on their own lines with blank lines around the block. Escape backslashes in JSON: `"$\\frac{a}{b}$"` represents `\frac{a}{b}`. Unmatched unescaped dollar delimiters in ordinary text are rejected. Escape a literal dollar sign as `\$` in Markdown (JSON `"\\$"`).

Supported KaTeX subset includes fractions, roots, limits, derivatives, sums, integrals, Greek symbols, vectors, subscripts/superscripts, matrices, cases, and aligned/gathered equations supported by KaTeX. Examples:

```text
$E=\\frac12mv^2$

$$
\\oint_S \\mathbf E\\cdot d\\mathbf S=\\frac{Q}{\\varepsilon_0}
$$

$$
\\begin{aligned} F&=ma \\\\ E&=mc^2 \\end{aligned}
$$

$v=3\\,\\mathrm{m\\,s^{-1}}$, $^{14}_{6}\\mathrm{C}$
```

The examples in this text block show **JSON-escaped** backslashes; after JSON decoding they become ordinary single-backslash math commands (row breaks become `\\`). In JSON strings newlines are `\n`. The working fixture is the definitive escaping example.

KaTeX runs in strict error mode, with at most 1,000 macro expansions and a maximum explicit size of 50 em. No whole LaTeX documents, packages, TikZ, PSTricks, external resources, HTML-producing commands, trusted URL commands, arbitrary CSS, or global user-defined macros across blocks. Use SVG/PNG/WebP for plots and circuits. Write Vietnamese prose outside formulas, or put Vietnamese words inside `\text{...}`. For example `$W_\text{đ}$` works; `$W_\mathrm{đ}$` is rejected as Unicode text in math mode. Use LaTeX symbol commands such as `\Omega`, `\alpha`, and `\varepsilon_0`.

The importer parses each Markdown block with the same unified/Remark/Rehype/KaTeX implementation and options used by display. An unrenderable expression rejects the whole package with question ID and field/block location. It is not silently shown as raw source. Long display formulas scroll horizontally within the content column.

## Assets and security limits

Every referenced image must exist. External references, executable content, malformed images, unsafe SVG, or missing figures reject the package. All assets, including unreferenced ones, are validated. Limits:

| Resource                                | Limit              |
| --------------------------------------- | ------------------ |
| Compressed ZIP                          | 64 MiB             |
| Total uncompressed ZIP                  | 128 MiB            |
| ZIP entries                             | 2,000              |
| Each JSON file                          | 8 MiB              |
| Each asset                              | 16 MiB             |
| Compression ratio for files above 1 MiB | 200:1              |
| Raster width/height                     | 12,000 pixels each |
| Raster pixels                           | 16 megapixels      |
| Raster decoder allocation               | 64 MiB             |
| SVG XML nodes                           | 50,000             |

PNG and WebP are signature-checked and decoded with bounds; extension must match format. SVG must be UTF-8 XML with a `svg` root. DTD/entities, scripts, event handlers, embedded HTML, external resources, style elements/attributes, images embedded inside SVG, animation, and filters are rejected. Use presentation attributes (`fill`, `stroke`, `font-size`, etc.), not `style="..."`. SVG text falls back to local fonts: use `font-family="serif"`/`sans-serif` or a locally available font, and plain SVG text; convert intricate labels to paths when necessary.

Allowed SVG elements: `svg`, `g`, `defs`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, `title`, `desc`, `marker`, `clipPath`, `mask`, `linearGradient`, `radialGradient`, `stop`, `use`, `symbol`. Only geometric/presentation attributes listed in `src-tauri/src/importer.rs` are accepted. `href` must be a local `#id`. Resource-valued attributes may use a simple `url(#id)` with an ASCII alphanumeric/underscore/hyphen ID; no external or encoded URLs. SVG elements use the SVG namespace (or no namespace); only standard XLink `href` is accepted as a namespaced attribute.

Assets are immutable SQLite blobs rendered as image elements. There is no inline injection of SVG markup. Zoom preserves vector source and original raster pixels.

## Package identity and revisions

Imports stage in bounded memory and commit all rows in one SQLite transaction after every structural, asset, and math check passes. A failure leaves no usable partial exam. Identity is SHA-256 over sorted file names and uncompressed file bytes with length framing. Identical content reimport is a safe no-op. The same `examId` with different content is rejected to preserve history. To revise an authored exam, use a new stable `examId`, such as `spho-mock-01-rev2`.
