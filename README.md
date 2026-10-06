# Mirai Menkyo

Static exam-practice web app for Japanese driving-license theory practice.

## Local

```bash
npm run build
npm run dev
```

Open `http://localhost:8788`.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Suggested domain: `menkyo.miraivn.com`

## Data

The build script reads bundled scraped data from:

```text
data/karimen-honmen-vi
```

It writes optimized static files to `dist/data`.

The complete scraped snapshot, including all seven JSON/JSONL exports and assets,
is stored in this repository. No sibling backend repository is required to build.

Exam questions, choices and available explanations contain Vietnamese, Japanese,
English, Simplified Chinese, Traditional Chinese and Portuguese translations.
The build lists only languages with complete question and choice coverage in the
manifest. Knowledge articles currently contain Vietnamese text; their language
is displayed when another interface language is selected. Location names and
addresses are available in Japanese and romaji.

## UI Checks

```bash
npm install
npx playwright install chromium
npm run test:ui
```

Checks six viewport widths from 320px to 1920px, all available languages, question
navigation bounds and 44px touch targets, images, grading, language persistence,
knowledge tables and location search. Screenshots are saved under `dist/ui-check`.

The home page separates Karimen, Honmen and Gentsuki into independent sections.
UI checks also cover section shortcuts, flag images and keyboard navigation in
the language picker. Flag PNGs are hosted locally under `src/assets/flags` and
were downloaded from [Flagpedia/FlagCDN](https://flagpedia.net/download/api).

`npm run test:knowledge` checks the full-width knowledge list, accent-insensitive
search, single article titles, preserved subheadings, tables, images and return
scroll position on six viewport widths and all interface languages.

Answers advance after a short selection feedback. Multi-part questions advance
only when all statements are answered. The final question waits for manual
grading, and graded review does not advance. `npm run test:auto-advance` checks
these behaviors, double-click protection and cancellation on navigation or exit.

`npm run test:images` checks large, centered, uncropped exam images above question
text and confirms automatic progression brings the next image into view.

The interface uses a light, system-inspired theme with translucent navigation,
segmented tabs and compact exam controls. Previous/next are labelled icon buttons
with hover and keyboard-focus tooltips; exit sits above the question, while
grading remains one explicit button. Multi-part answers use separated rows.
Icons come from [Lucide](https://lucide.dev), bundled locally at build time from
`lucide-static`; only the selected SVGs and their ISC license are deployed.
UI checks also verify localized icon labels and 44px question-control targets.
`npm run test:controls` checks compact navigation, disabled first/last arrows,
multi-part answer states, hover contrast and grading on all six languages and
viewport widths.

`npm run test:locations` checks sequential typing, cursor edits, selected-text
replacement, Japanese composition and clear/no-match results at six widths in
all languages. Location filtering updates only the result list, never replacing
the active search input.

## Local Image Upscale Preview

This is an offline, non-destructive experiment, not part of the Cloudflare build.
Original question images and JSON references are not changed. No API is called.

Download the official [Waifu2x Windows release 20250915](https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/20250915/waifu2x-ncnn-vulkan-20250915-windows.zip)
and extract it under `tools/waifu2x`. Keep the executable and `models-cunet`
directory together. The archive SHA-256 is
`7425be94b94e4c8f37a1e433ac0e0100c43790e2c37418f4b65d8235adfbdc87`.

Requires Python 3.11 or later. From the repo root on Windows:

```powershell
py -m venv .venv-images
.\.venv-images\Scripts\python.exe -m pip install -r scripts/requirements-images.txt
.\.venv-images\Scripts\python.exe scripts/upscale-exam-images.py --limit 10
```

Open `output/upscale-preview/index.html` to compare originals with 2x and 4x
versions. `manifest.json` records source hashes, references, dimensions, output
hashes, elapsed times and cache hits. The script deduplicates identical bytes,
skips animated/corrupt images, and creates original RGBA PNG previews without
altering sources. Only RGB, composited on white, is passed into Waifu2x; alpha is
resized separately from the original using Lanczos and reattached afterward.
This bypasses the backend's RGBA corruption observed in the initial experiment.
Fully opaque sources stay opaque. Pipeline version 2 invalidates earlier caches.
The script checks exact alpha-mask equality, output dimensions, source hashes,
blank/flat results and visible-color differences across an 8x8 region grid before
saving or accepting an output. These checks detect lost content, not semantic
correctness of traffic signs or text; visual review is still required.
Outputs are cached by source content, tool/model hashes and processing settings.
Only use output paths listed in the current manifest; older experimental cache
files can remain on disk but are not referenced by the regenerated preview.
The preview includes the reported blurry police diagram and a multi-part driving
scene, plus samples from Karimen, Honmen and Gentsuki.

After visual review, generate the eligible full batch with:

```powershell
npm run backup:images
.\.venv-images\Scripts\python.exe scripts/upscale-exam-images.py --all --scales 4 --continue-on-error --output output/upscale-batch
node scripts/check-upscale-preview.mjs output/upscale-batch
```

Backups are timestamped under `output/backups` and include all original images
and JSON data. The backup command verifies every copied SHA-256 against the
source, checks that the source stayed unchanged during copying, and records
`backup-manifest.json`. Existing backups are never overwritten.
The full batch keeps originals untouched and writes accepted outputs separately.
`--continue-on-error` records failed images in `manifest.json` and the comparison
page, without accepting bad outputs. Changes to a source during processing remain
fatal. The manifest records whether the full run completed and selected/accepted/
rejected counts. Review rejected images before considering production replacement.

## Enhanced Images On The Website

After the completed batch passes `check-upscale-preview.mjs`, promote it with
`npm run promote:images`, then run `npm run build` and `npm run test:enhanced-data`.
Promotion requires the checker's matching validation stamp and rechecks every
source/output hash before creating `data/enhanced-exam-images`. Only accepted
outputs are promoted; rejected sources keep their original image references.

The build matches originals by SHA-256, so duplicate files across exams reuse one
enhanced PNG. Original exported JSON and images remain unchanged. PNG filenames
use output-content hashes for immutable caching. Exam JSON paths in the manifest
include the image-pack version to avoid stale image references; legacy exam JSON
filenames remain available. The frontend, all six languages and grading data use
the same image pack, without runtime upscaling or API calls.

To build with original images instead, set `MENKYO_ORIGINAL_IMAGES=1` for the build.
This does not delete originals or the enhanced pack. `test:enhanced-data` verifies
both modes, unchanged text/answers/explanations and all image-path mappings.

Images with an original edge above 600px are excluded by default; override with
`--max-edge`. Use `--tool` for another executable location or `--gpu -1` for CPU.
Vulkan/GPU inference is automatic otherwise. Binaries, virtual environment and
preview outputs are gitignored. Review arrows, signs and small text before any
production image replacement; upscaling cannot recover missing original detail.
`npm run test:upscale-preview` verifies all source/output hashes, deduplication,
dimensions, browser canvas pixels (color and alpha by region), loaded preview
images and containment at 390px and 1440px. It saves a screenshot of every row.
Run regression tests for blank, invisible and partially missing content with:

```powershell
.\.venv-images\Scripts\python.exe scripts/test-upscale-exam-images.py
```

## Question Bank Audit

`npm run audit:questions` writes `reports/question-audit.json` and
`reports/question-audit.md`. It counts exact duplicates using normalized text,
correct answers, ordered choices and image-content hashes, with separate counts
for each language. It does not merge semantically similar wording or change data.
