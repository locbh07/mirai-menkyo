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

## Question Bank Audit

`npm run audit:questions` writes `reports/question-audit.json` and
`reports/question-audit.md`. It counts exact duplicates using normalized text,
correct answers, ordered choices and image-content hashes, with separate counts
for each language. It does not merge semantically similar wording or change data.
