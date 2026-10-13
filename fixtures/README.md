# Question packages

- `SPHO_SAMPLE_VALIDATION.zip`: ten logically checked demonstration questions covering Vietnamese, mathematics, SVG, PNG, WebP, interleaved figures, image choices, and full explanations with tables/shortcuts/pitfalls. 9000 seconds. A rendering fixture, not a full practice exam.
- `SPHO_SYNTHETIC_100.zip`: exactly 100 synthetic arithmetic questions, two sections, 9000 seconds. For navigation, persistence, and scoring stress tests only; not SPhO preparation material.
- `SPHO_TIMEOUT_VALIDATION.zip`: the ten sample questions with a three-second duration. For automatic-submission QA only.
- `negative/`: fourteen intentionally invalid packages, rejected for malformed ZIP, absent files, unsupported schema, duplicate/missing questions, incorrect section counts, invalid/missing solutions, missing figures, traversal, unsafe SVG, invalid math, external assets, or HTML injection.

Every positive package uses the exact `spho-exam/1.0` contract from `../SCHEMA.md`. `source/` is the unpacked sample. Regenerate with `npm run fixtures`; original raster assets are checked in. Optional asset regeneration uses `python scripts/create-assets.py` with Pillow installed.
