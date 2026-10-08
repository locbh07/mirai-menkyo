# Mirai Menkyo

Static exam-practice web app for Japanese driving-license theory practice.

## Local

```bash
npm run build
npm run dev
```

Open `http://localhost:8788`.

## Cloudflare Workers (Static Assets)

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Static assets directory: `dist`, configured in `wrangler.jsonc`
- Suggested domain: `menkyo.miraivn.com`

## Data

The build script reads bundled scraped data from:

```text
data/karimen-honmen-vi
```

It writes optimized encrypted data packets to `dist/data/content`, alongside the
static image assets. Original JSON exports are not changed.

### Data Pack And Shortcut Deterrent

Runtime catalog, exam sets, knowledge and locations are AES-256-GCM packets with
fresh 96-bit IVs and 128-bit authentication tags. Packet names are ciphertext
SHA-256 hashes. No plaintext runtime JSON/JSONL or legacy exam JSON files are
deployed. `dist/data-config.js` is generated at build time with the catalog path
and the public browser decryption key; it is served without caching. The browser
uses native Web Crypto, requiring HTTPS or localhost.

This is a casual-download deterrent, **not access control, DRM or Premium data
protection**. The browser must decrypt these packets, so a determined visitor can
recover the data and answers. The key is public, not a credential. The bundled
original JSON is still in this repository: make the repository private if it
should not be publicly downloadable. Existing clones/downloads cannot be revoked.

While the page has keyboard focus, cancelable F12, Ctrl+Shift+I/J/C, Ctrl+U and
corresponding Mac shortcuts are intercepted. Normal copy/paste, find, print,
context menus and IME composition are retained. Browser menus, extensions,
disabled JavaScript and detached DevTools can bypass this. A page cannot close
the browser's DevTools or prevent viewing its delivered source.

A desktop-only geometry heuristic samples every 500ms and requires three
consecutive dock-like readings before displaying a blocking, localized dialog.
The dialog explains the pause and offers Try again; it does not pretend to load.
It clears after two normal readings, or immediately after a successful retry.
Initial data requests wait for the check; exam time pauses and answers remain
in memory while blocked. Native touch/mobile devices, small desktop windows,
fullscreen, changed zoom/scaling and ambiguous two-axis size gaps are excluded
from the docked-panel geometry check.
Device-mode checks separately flag mobile user agents with desktop platforms,
or a screen-size change combined with newly enabled touch/mobile signals after
a trusted desktop visit. A per-tab desktop baseline in sessionStorage survives
reloads; unavailable storage falls back to memory. Touch alone and iPadOS
desktop-site mode are not treated as emulation.
Browser sidebars can still cause false positives, and detached tools may be missed.
Device mode opened before any trusted desktop visit can bypass these checks if
it keeps a desktop user agent or fully spoofs native mobile metrics.
This is not a reliable DevTools detector or data-access boundary. There are no
`debugger` loops, forced window closing, or destructive state resets.

`npm run test:data-pack` verifies decoding, packet hashes, lack of deployed
plaintext exports, tamper/wrong-key rejection, keyboard handling and browser
workflows. For Premium, move access checks and grading to a server/API, with
authentication, authorization and abuse limits; do not rely on this pack.
See [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#verify-that-authorization-checks-are-performed-in-the-right-location).

`npm run test:guard` verifies the geometry policy, six translated dialogs,
startup fetch gating, retry/focus behavior, paused exam time, retained answers,
native touch-device exclusions and narrow layouts. Tests include simulated
geometry plus actual Chromium CDP mobile/touch/DPR emulation, reload and recovery.
Passing these checks does not prove reliable DevTools detection.

The complete scraped snapshot, including all seven JSON/JSONL exports and assets,
is stored in this repository. No sibling backend repository is required to build.

Exam questions, choices and available explanations contain Vietnamese, Japanese,
English, Simplified Chinese, Traditional Chinese and Portuguese translations.
The build lists only languages with complete question and choice coverage in the
manifest. Knowledge has Japanese PDF-derived lessons, their Vietnamese edition
and the original scraped Vietnamese references, selectable independently of the
interface language.
Location names and addresses are available in Japanese and romaji.

### Japanese PDF Lessons

`data/knowledge-ja/source.pdf` is the untouched, 148-page Japanese manual supplied
by the user, byte-identical to the NPA's
[published PDF](https://www.npa.go.jp/bureau/traffic/20241113kyousoku.pdf).
`lessons.json` contains 71 source-ordered lessons/reference sections: all 11
chapters, glossary, appendices, front matter and effective-date provisions.
It retains the original 2024 content; newer amendments are deliberately not
applied. A user-supplied Vietnamese translation is available alongside it.
Changing the interface to Vietnamese/Japanese selects the corresponding library;
other interface languages fall back to Japanese, with an independent study-language
selector. Existing scraped references remain in a supplemental section. Book
pagination and logical lesson counts do not double-count translations.

`data/knowledge-vi/lessons-vi.json` is bound to the exact Japanese dataset hash.
Its text values are per body block or whole table cell. The build applies each
aggregate cell translation once, not once per original paragraph. Eight multi-image
cells have explicit paragraph mappings in `editorial-overrides.json` to preserve
image/caption order. A stray Japanese fragment in the crossing rule was corrected
from the source. The original and supplied translation remain separate; the reader
identifies the Vietnamese edition as AI-assisted, not a certified/current-law text.

The import records every non-footer source character with an audit ID, retains
furigana and line geometry, joins paragraph continuations using the manual's
first-line/hanging indents, and maps all 277 original monochrome illustrations
into their original cells/positions. All 87 source table fragments are retained
for auditing and regrouped into 34 logical tables with reviewed page-break
relationships, shared cells and headers. The missing rule on p128 is repaired
using the adjacent numbered columns, separating item 4 from item 3. `Same as
above` cells retain the original Japanese and expose their actual referenced
cell. Multi-image examples interleave captions and pictures in source order.
All fragments have 2x original-layout previews, individually labelled by page.
The previews improve the legibility of PDF text/borders, not the detail or color
of the original raster illustrations. Native HTML reading, chapter filtering,
IME-safe search, previous/next lessons and image enlargement are available.
Simple three/four-column sign tables reflow on narrow screens; paired kind/color tables are not
mislabelled as kind/number/meaning/color. Complex merged tables remain
scrollable inside their own region.

`color-source.pdf` is a pinned copy of MLIT's official
[color sign poster](https://www.mlit.go.jp/road/sign/sign/douro/ichiran.pdf).
`scripts/prepare-knowledge-colors.py` renders reviewed vector crops locally;
`color-manifest.json` records the first pack's hashes/crops (67 references).
The active `color-applied-manifest.json` covers **151 of 277 image instances**,
incorporating the user's MLIT/Commons pack. Twenty-two crops were re-extracted
from the pinned vector poster to remove poster rules/captions and repair the blue
climbing-lane and white-background emergency-phone examples. The bare clover for
p141-image03 was rejected because the source has dimension labels; its original
is retained. Standard monochrome supplementary signs stay monochrome. These are
reference illustrations of the same reviewed
sign type/direction, not restorations of the original grayscale drawings.
Differences such as explanatory wording/pictogram styling can remain. Combined
variants, unmatched numeric examples and unreviewed drawings keep the original image.
MLIT's [sign design guidance](https://www.mlit.go.jp/road/soudan/soudan_04a_04.html)
is recorded in the manifest. Source attribution is shown in the reader.

The default view uses available color references; `PDF original` switches back
without changing content or table structure. The preference persists locally.
Missing/failed color requests fall back to the untouched image, including in
the enlargement dialog. Original PDF previews always stay unchanged. The build
does not call translation APIs, AI colorization or image upscaling.
Before this restructuring, the Japanese dataset was backed up under
`output/backups/knowledge-ja-before-structure-color-*`.

To regenerate and verify the checked-in import:

```bash
python -m pip install -r scripts/requirements-pdf.txt
npm run import:knowledge-ja
npm run prepare:knowledge-colors
npm run test:knowledge-ja-source
npm run test:knowledge-ja
npm run test:knowledge-vi
```

The Python source check compares every imported character to the original PDF,
checks ordered source glyphs/lines, complete page/image coverage, non-overlapping
table grids, each regrouped cell's provenance, ditto references and specific
cross-page regression cases. It also verifies all 67 color sources by hash,
dimensions and actual colored pixels. Browser
checks read all 71 lessons at 320px, 390px and 1440px, compare the full Japanese
paragraph/table text and caption/image sequence, load all 277 illustrations and
check nonblank canvas pixels, all 151 active reference replacements, reference contents,
color/original switching, real HTTP failure fallback, navigation, IME, source
previews and the preserved Vietnamese library. Screenshots and the color
original/reference contact sheet are saved under `output` for visual review.
These checks strengthen structural fidelity; they do not certify current legal
correctness or replace Japanese editorial review of the 2024 source.

Cloudflare only needs Node for deployment: the import is bundled in Git. The
build strips per-character audit IDs and packs lessons into the existing
encrypted runtime data; it deploys only image assets, not the original PDFs or
plaintext source/audit JSON. Only color files referenced by the manifest are
deployed. Filenames are content hashes for immutable caching.
Stable article/block IDs and source-page references support later translations
without recreating the shared illustrations.
The Japanese reader uses a locally hosted, approximately 600KB variable-weight
subset of Noto Sans JP, renamed `Mirai Knowledge JP`, with SIL OFL 1.1 notices.
See `src/assets/fonts/README.md`; no remote font service is needed.

## UI Checks

### AI Translation Handoff

`npm run export:knowledge-handoff -- --locale vi` creates a new, timestamped
offline handoff under `output/translation-handoff`. It never overwrites returned
translations or modifies the source dataset. Supported targets also include
`en`, `zh-Hans`, `zh-Hant`, and `pt`.

The package includes 71 per-lesson source/response templates, 3,117 translation
units (paragraphs, titles and editorial alt labels), all 277 original image
instances, the 151 active references, 87 source-table facsimiles, source PDFs,
integrity hashes and the Vietnamese brief/prompt for another AI.
The authoritative layout carries exact cell spans, page relationships, ditto
targets and interleaved caption/image order independently of translation text.

Open its `index.html` directly after extraction to compare Japanese and draft
translations side-by-side (stacked on mobile). Returned JSON is read locally;
no API, external upload, paid translation or production publishing is performed.
Untranslated units remain Japanese in this **review-only** view.

`node scripts/validate-knowledge-handoff.mjs <package-folder> <returned.json>`
checks identity/source hashes, statuses, collisions and source asset hashes;
`--complete` also requires every unit to be translated. Changed numbers and
diagram letters produce warnings requiring review. Add the returned image plan
as another argument to check all 277 image decisions and candidate file hashes.
No candidate image is applied automatically; semantic correctness, licensing,
SVG sanitization and human acceptance remain separate publication prerequisites.

See [AI handoff instructions](docs/knowledge-ai-handoff.md) and
[the detailed Muse prompt](docs/knowledge-ai-prompt.md).
`npm run test:knowledge-handoff` checks the contract, invalid/partial/conflicting
returns, numeric warnings, image proposals, asset hashes, all 71 source layouts
and 277 nonblank images at 320/390/1440px, plus offline-file preview behavior.

### Main Website

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
use output-content hashes for immutable caching. Encrypted exam-packet paths in
the catalog incorporate their contents, including the image references. Legacy
plaintext exam JSON files are no longer deployed. The frontend, all six languages and grading data use
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
