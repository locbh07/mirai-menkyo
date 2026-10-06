# Question Bank Audit

Source: data/karimen-honmen-vi/all.json (SHA-256: d3b143057a53ae80bee13884eac82e02c6b697befca13b6547e9c643b6d9bcdd).

Exact normalized Japanese prompt, ordered choice text, correct answers and SHA-256 image contents. NFKC and whitespace normalization only. Image filenames, question IDs, explanations and translated wording are not part of the Japanese key. Missing images retain distinct unresolved references. Similar meanings with different wording are not merged.

Counts refer to main questions; a three-statement illustration question counts as one question. Translations are not additional questions.

| Type | Sets | Occurrences | Unique Japanese | Unique Vietnamese |
| --- | ---: | ---: | ---: | ---: |
| karimen | 16 | 800 | 798 | 796 |
| honmen | 16 | 1520 | 1516 | 1519 |
| gentsuki | 5 | 250 | 250 | 248 |
| All | 37 | 2570 | 2564 | 2562 |

Global counts are recomputed across all types, not added from per-type counts. Exact wording differs between translations; this report does not establish semantic uniqueness or complete syllabus coverage.

## Exact Japanese Duplicates

- karimen-9-20 = karimen-14-40
- karimen-9-34 = karimen-10-45
- honmen-2-79 = honmen-2-89
- honmen-8-24 = honmen-9-38
- honmen-10-62 = honmen-12-77
- honmen-13-1 = honmen-14-77

There are 5 groups shared between different exam sets and 1 groups repeated within one exam set.

## Exact Vietnamese Duplicates

- karimen-7-27 = karimen-9-19
- karimen-7-38 = karimen-15-18
- karimen-9-34 = karimen-10-45
- karimen-14-50 = karimen-15-1
- honmen-1-8 = gentsuki-1-4
- honmen-2-79 = honmen-2-89
- gentsuki-2-19 = gentsuki-4-22
- gentsuki-2-38 = gentsuki-3-26

The Vietnamese text has one duplicate shared by Honmen and Gentsuki. Its global unique count is therefore one less than the sum of unique counts within the three types.

## Data Quality

- Conflicting answer groups for otherwise identical Japanese content and images: 0.
- Vietnamese explanations present: 1564/2570.
- Missing image: honmen-5-48, assets/honmen/exams/5/images/48.png.

## Exam Coverage Assessment

The 16 Karimen sets have 50 true/false questions each. The 16 Honmen sets have 90 true/false questions and five three-statement illustration questions each. The five Gentsuki sets currently have 50 true/false questions each, without compound illustration questions.

Official Gentsuki exams have 46 text questions and two three-statement illustration questions (48 main questions total). Current Gentsuki sets are practice material, not format-accurate mock exams. Quantity alone cannot prove topic coverage, correctness, current-law compliance or readiness to pass.

References:

- [Official exam formats, Hiroshima Police](https://www.pref.hiroshima.lg.jp/site/police1/061-u-jyuken-309sikensyubetu2.html)
- [NPA exam format and coverage standard](https://www.npa.go.jp/laws/notification/koutuu/menkyo/menkyo20230330_46.pdf)
- [NPA residential-road speed rules effective September 1, 2026](https://www.npa.go.jp/bureau/traffic/seikatsudouro/seikatsudoro.html)

Legal and topic coverage have not been exhaustively audited. Current source material must be reviewed against these standards before claiming complete exam coverage.

The existing speeding knowledge article still presents a general car limit of 60 km/h without distinguishing the updated residential-road classes. It needs review against the September 2026 rule change; this audit does not automatically rewrite answers or legal guidance.
