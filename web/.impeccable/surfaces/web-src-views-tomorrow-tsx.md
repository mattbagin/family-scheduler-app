---
version: 1
slug: "web-src-views-tomorrow-tsx"
primary_target: "web/src/views/Tomorrow.tsx"
related_targets: ["web/src/views/Today.tsx"]
---

# Tomorrow board

Mode: Operate. Audience: a parent in the evening, passing the kitchen hub or on their phone, asking "is tomorrow sorted?". Kids are not the audience.

Scope: the hub's Today tab becomes this board from the hub's "Evening starts at" time (default 7:30 PM, can be off) until night mode ends; before midnight it shows tomorrow, after midnight the day just begun. Phones reach it at /tomorrow from a "Tomorrow →" link on Today. Driver gaps are fixed in place (a parent PIN on the hub; just that day by default). Clashes are flagged and open the event sheet. Untouched: Today by day, kid mode, nudges, ambient and night screens. Anti-goals: a mini week grid, editing beyond drivers, anything a kid must read.

States: nothing planned ("A slow morning ☕"), all sorted ("All set ✓"), typical 3 to 8 events, busy 12+, feed events included.

## Direction contract

THESIS: Tomorrow as a morning run-sheet: the first moment someone has to be out the door leads, then only what still needs a decision, then who drives where. Refuses the category default of a day-calendar column with tomorrow's events at equal weight.

OWN-WORLD: DESIGN.md's Family Sticker Chart unchanged: Mist board, white panels with the one board lift, Fredoka for times and names, person color only through faces and tints, warn/bad status pills. After night mode starts the whole screen swaps its tokens to bedside amber on black, no shadows.

STORY: The parent sees when tomorrow starts and who's going, sees at once whether anything is unsorted, taps a face to fix a driver gap, and leaves knowing the morning is covered.

FIRST VIEWPORT: Tablet: left column holds the day heading with tomorrow's weather, then the leave-by hero (clock-sized time, driver face, "Dad leaves for School at 7:55"), then Needs sorting (or All set ✓). Right column: Who drives where list, then Packing. Phone: one column in that order; the hero fits above the fold.

FORM: Extension inside the established world, confirmed in shape; no concept roll (composition was settled with the user). Seed key: none (shape-confirmed brief).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
