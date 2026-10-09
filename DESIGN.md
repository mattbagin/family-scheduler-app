---
name: Homebase
description: A family sticker chart grown into a whole-household calendar hub.
colors:
  ink-navy: "#18203A"
  slate-muted: "#5B6583"
  mist-bg: "#EEF1F7"
  paper-white: "#FFFFFF"
  cloud-surface: "#F5F7FB"
  soft-line: "#DCE1EC"
  focus-blue: "#2569C9"
  amber-warn: "#9A5B00"
  amber-warn-bg: "#FFF0D2"
  berry-bad: "#B7263F"
  berry-bad-bg: "#FDE3E8"
  pine-good: "#17704A"
  pine-good-bg: "#DDF4E7"
  night-bg: "#10141F"
  night-surface: "#1A1F2E"
  night-surface-2: "#222839"
  night-ink: "#EEF1F8"
  night-muted: "#9AA3BD"
  night-line: "#2E3549"
  night-focus: "#6AA6F5"
  night-warn: "#F5C06A"
  night-warn-bg: "#3A2C12"
  night-bad: "#FF8599"
  night-bad-bg: "#3D1A22"
  night-good: "#62D8A0"
  night-good-bg: "#143325"
  person-rose: "#D9487A"
  person-blue: "#2F7DE1"
  person-marigold: "#DB8616"
  person-green: "#1F9C62"
  person-violet: "#8B5CF6"
  person-tomato: "#E0533D"
  person-teal: "#0E9AA7"
  person-ochre: "#B7791F"
  bedside-amber: "#B98F63"
  bedside-muted: "#9C7A55"
typography:
  display:
    fontFamily: "Fredoka, Nunito, Trebuchet MS, system-ui, sans-serif"
    fontSize: "clamp(3.2rem, 8vw, 5.6rem)"
    fontWeight: 600
    lineHeight: 0.9
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Fredoka, Nunito, Trebuchet MS, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 4vw, 2.2rem)"
    fontWeight: 600
    lineHeight: 1.1
  title-lg:
    fontFamily: "Fredoka, Nunito, Trebuchet MS, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.1
  title:
    fontFamily: "Fredoka, Nunito, Trebuchet MS, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  title-sm:
    fontFamily: "Fredoka, Nunito, Trebuchet MS, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  small:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  xs: "10px"
  sm: "12px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  sheet: "26px"
  hero: "32px"
  pill: "999px"
spacing:
  2xs: "4px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  2xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.ink-navy}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
  button-icon:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  button-mini:
    backgroundColor: "{colors.cloud-surface}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  tab-active:
    backgroundColor: "{colors.ink-navy}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  tab-idle:
    textColor: "{colors.slate-muted}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  panel:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.xl}"
    padding: "18px"
  chip:
    backgroundColor: "{colors.cloud-surface}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  pill-warn:
    backgroundColor: "{colors.amber-warn-bg}"
    textColor: "{colors.amber-warn}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  pill-bad:
    backgroundColor: "{colors.berry-bad-bg}"
    textColor: "{colors.berry-bad}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  pill-good:
    backgroundColor: "{colors.pine-good-bg}"
    textColor: "{colors.pine-good}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  input-field:
    backgroundColor: "{colors.cloud-surface}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  sheet:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.sheet}"
    padding: "22px"
    width: "min(560px, 100%)"
  fab:
    backgroundColor: "{colors.ink-navy}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    size: "64px"
---

# Design System: Homebase

## Overview

**Creative North Star: "The Family Sticker Chart"**

Homebase is the chart on the fridge, grown up into the whole household's calendar. Its heart is the moment a kid presses a tile and a star stamps on, or the last job of the day sets off confetti. Everything else (the timeline, the week grid, bills and plans) is laid out tidily around that heart on a calm, cool-grey board, so parents can scan it in a glance and kids can find their own face.

The board itself is quiet: a misty blue-grey background, white rounded panels, one dark navy for actions, and soft rounded type. The color comes from the people. Each member's color rings their face, tints their events and fills their tiles, so "who" reads before "what". Emoji do the work of illustration, which means a picture always sits next to the words for children who can't read yet.

Play is placed deliberately. Kid mode, the chore tiles and the celebrations are chunky, bouncy and big. Parent tools (forms, settings, the week grid, the nudge feed) keep the same rounded shapes but stay orderly and restrained. It must never look like a corporate calendar (thin lines, grey boxes, dense text) or like a toy (primary-color clutter on the parents' screens).

**Key Characteristics:**
- A calm, cool board. The only strong color belongs to people, plus a few status colors.
- Rounded everything: pill buttons and tabs, 18 to 32px cards, circular faces.
- Fredoka for anything you'd read from across the room; Figtree for everything you read up close.
- Emoji as the picture layer, beside text and never instead of it for adults.
- Shadows that are soft and low, used to lift panels off the board rather than to stack layers.
- Motion that rewards: stamps, pops and confetti on completion, with all of it off under reduced motion.

## Colors

A cool, quiet neutral board that the family's own colors and three status colors sit on.

### Primary
- **Ink Navy** (`ink-navy`): the one action color. Primary buttons, the active tab, the + button, toasts and body text. In dark mode it flips to Night Ink, so actions become light pills.

### Secondary
- **Focus Blue** (`focus-blue`): keyboard focus rings (3px, offset 2px), links, today's column in the week grid and today's date in the month view. It means "you are here" or "this is interactive". It's never decoration.

### Tertiary: the person palette
- **Rose, Blue, Marigold, Green, Violet, Tomato, Teal, Ochre** (`person-*`): one per family member, picked in Settings. Applied through the `--pc` variable: avatar rings, the timeline dot, event tints (7 to 20% mixed into the surface), tile fills, the "now" ring and checkboxes. Used as text, a person color is mixed with Tint Ink (black in light mode, white in dark) so it passes AA.

### Status
- **Amber Warn / Berry Bad / Pine Good** with their pale backgrounds: heads-up alerts, pills, conflict outlines on events, nudge icon tiles, and the swipe-to-finish/postpone backdrop. Bad means conflict, late or delete. Warn means a missing driver, a bill coming due or offline. Good means done or unlocked.

### Neutral
- **Mist** (`mist-bg`): the page background behind everything.
- **Paper White** (`paper-white`): panels, sheets, tabs and avatars' inner fill.
- **Cloud** (`cloud-surface`): the second surface inside a panel: chips, tasks, timeline cards, inputs, segmented controls.
- **Slate Muted** (`slate-muted`): secondary text, labels, times, idle tabs.
- **Soft Line** (`soft-line`): hairline dividers, button borders, idle input borders, progress-bar tracks.

### Dark mode
Follows the system (`prefers-color-scheme`). The `night-*` tokens replace their light twins one for one. The person palette stays the same. The ambient screen ignores both themes: white type over photos, and at night pure black with **Bedside Amber** (`bedside-amber`) type at 55% opacity.

### Bedside night
When the hub's night mode is on, anything still awake on the hub goes amber on black instead of the dark theme: the ambient clock, nudge banners, the kid-mode nudge chip and the Tomorrow board. On the Tomorrow board the whole screen swaps its tokens: near-black surfaces (#0d0a07, #16110c) on pure black, **Bedside Amber** as ink and as the action color, **Bedside Muted** (`bedside-muted`) for secondary text, and amber hairlines (`rgba(185,143,99,.2)`). Person colors are all forced to Bedside Amber, decorative emoji and faces are filtered (`grayscale(.6) brightness(.8)`), and shadows are off. Status keeps its meaning through dimmed warm pairs (warn #D6A35F on #1F160B, bad #E08A6E on #22100C, good #B5B87A on #12160C).

### Named Rules
**The People Own the Color Rule.** Saturated hues on screen belong to a person or a status. Never add a brand accent, decorative gradient or category color to the app shell. Categories show as emoji, not color.

**The Mixed, Not Painted Rule.** Person colors reach surfaces only through `color-mix` with the surface (7 to 22%). Full-strength person color is kept for rings, dots, borders and the "done" star.

**The Solo Tint Rule.** An event row takes its person's tint (11 to 12%) only when exactly one person goes. A shared event stays neutral Cloud and its faces say who. Who and kind are never shown with a colored side stripe. This holds for the Today timeline, the Month agenda and the Tomorrow board.

**The Bedside Rule.** After night mode starts, nothing on the hub glows: amber on black, no person colors, no solid fills and no shadows. Actions (the active tab, the + button, "Got it") become amber outlines (`inset 0 0 0 1.5px`, amber at 60%) instead of solid pills.

## Typography

**Display Font:** Fredoka (with Nunito, Trebuchet MS)
**Body Font:** Figtree (with Segoe UI, system-ui)

**Character:** Fredoka's soft, round geometry is the sticker-chart voice: friendly and readable from the far side of the kitchen. Figtree is a clean, slightly warm grotesque that keeps forms, notes and settings calm.

### Hierarchy
- **Display** (Fredoka 600, clamp 3.2 to 5.6rem, line-height 0.9, tabular numbers): the Today clock and the Tomorrow board's leave-by time (which starts slightly larger, at 3.4rem). The ambient clock scales it up to 10rem, and kid-mode "now" emoji and words sit at a similar size.
- **Headline** (Fredoka 600, clamp 1.5 to 2.2rem, 1.1): page titles (h1), with balanced wrapping.
- **Large title** (Fredoka 600, 1.5rem, `--fs-title-lg`): the wordmark, day numbers in the week grid, timeline times, the Tomorrow hero sentence.
- **Title** (Fredoka 600, 1.25rem, `--fs-title`): panel headings (h2), timeline event titles, kid-mode labels, the PIN prompt.
- **Small title** (Fredoka 600, 1.125rem, `--fs-title-sm`): card and row titles (plans, countdowns, nudges, agenda and Tomorrow rows), h3, quick add's box.
- **Body** (Figtree 400/500, 1rem / 16px, 1.45, `--fs-body`): everything else, and every form field.
- **Small** (Figtree, 0.875rem, `--fs-small`): secondary lines in Slate Muted: notes, field labels, chips, the dense week grid, legends.
- **Label** (Figtree 700, 0.75rem, 0.08em tracking, uppercase, Slate Muted, `--fs-label`): section labels, weekday headers, pills, badges, countdown units. Nothing on screen is smaller.

Big numbers (counts, sleeps, the PIN keys, weather) and display sizes keep their own sizes on their elements; emoji and avatars are pictures and sit outside the type scale.

### Named Rules
**The Across-the-Room Rule.** Anything meant to be glanced at (times, names, titles, counts, the clock, kid-mode words) is set in Fredoka. Anything meant to be read up close (notes, form labels, settings copy) is Figtree.

**The Tabular Time Rule.** Clocks and counts use tabular numbers so they don't jitter as they tick.

**The Six Sizes Rule.** Text takes one of six role sizes (label, small, body, small title, title, large title) through the `--fs-*` variables; a new screen picks a role, never a new number. Body and form fields never go below 16px, so phones don't zoom into a field when it's tapped.

## Layout

A single centered column up to 1400px, with a 16px side gutter, an 18px gap between major blocks and 14px inside panels. The bottom keeps 96px clear (plus the safe area) for the floating + button and nudge banners.

- **Today:** a hero row (clock and date | weather | faces), then a 1.7 : 1 two-column split (timeline left, chores/heads-up/countdowns right).
- **Week:** a horizontally scrolling grid: a 104px person column, then 7 day columns of at least 128px (1000px minimum). People run down the side and days across the top, so conflicts line up.
- **Month:** a 7-column grid of 88px day buttons with a dot per busy person. It shrinks to 64px days and 9px dots on phones.
- **Tomorrow board:** a 1 : 1.25 split. On the left are the day heading with tomorrow's weather, the leave-by hero, and Needs sorting (or All set). On the right are "Who's going where" and Packing. It's a single column below 900px. Below 520px a row's ride drops under its title and its faces hide.
- **Kid mode:** its own top row (the kids' faces to switch between, then the hold-to-leave 🏠 at the far right) and no parent header. Below that is a 1.3 : 1 split. The big Now/Next cards are on the left; job tiles in two columns and sleep countdowns are on the right.
- **Breakpoints:** at 900px every two-column split stacks and the hero stacks. At 700px the month view and nudge banners compact. At 520px the tabs tighten, the ambient tab hides and the timeline narrows.
- Spacing comes from a small set of steps (4, 6, 8, 10, 14, 18, 22px). Gaps are 6 to 10px inside a component and 14 to 18px between components.

## Elevation & Depth

Mostly flat, with one soft lift. Panels, tabs, the week grid, the month view, kid cards and alerts sit on the Mist board under a single low, two-part shadow (`--shadow`). Inside a panel, depth comes from tone instead: Cloud surfaces on Paper White, and person tints over Cloud. Things that float above the page (sheets, nudge banners, the + button, toasts) get a deeper, darker shadow so they read as temporary.

### Shadow Vocabulary
- **Board lift** (`0 1px 2px rgba(24,32,58,.06), 0 6px 20px rgba(24,32,58,.07)`; dark mode uses black at .3/.25): panels, tabs, kid cards, profile buttons.
- **Floating** (`0 10px 30px rgba(0,0,0,.25)` to `0 12px 36px rgba(0,0,0,.28)`): the + button, toasts and nudge banners. Phones soften it for stacked nudges (`0 6px 18px rgba(0,0,0,.22)`).
- **Frosted** (`rgba(10,14,24,.45)` with `blur(10px)` for weather and person pills; `.55` with `blur(14px)` for nudges): weather, person pills and nudge banners over ambient photos.
- **None at night:** in the bedside night look every shadow is off. Lines and outlines in amber do the separating.
- **Sheet** (`0 30px 80px rgba(0,0,0,.3)` over a 45% navy scrim): dialogs.
- **State ring** (`inset 0 0 0 2px <color>`): "now" on timeline cards and chips, conflict and warning outlines on events, today in the month view. It's a border drawn as a shadow so the layout doesn't shift.

### Named Rules
**The One Lift Rule.** Content sits one level above the board, never more. Stacked cards-in-cards with their own shadows are not allowed; nested surfaces change tone instead.

## Shapes

Soft and round at every scale. Interactive controls (buttons, tabs, segmented controls, toggles, pills, the skip link, toasts) are full pills (999px). Containers grow rounder as they grow bigger: 10px for week events, 12px for chips and inputs, 14px for tasks and month days, 18px for timeline cards and tiles, 24px for panels, 26px for sheets and 32px for kid-mode Now cards. Faces are always circles with a person-colored ring (2 to 4px, thicker as they grow).

Chore tiles have one special shape language: a **dashed** person-colored border while waiting, which turns **solid** with a stamped ★ badge when done.

## Components

### Buttons
Friendly but tidy: one strong button per area, the rest quiet.
- **Shape:** full pill (999px).
- **Primary:** Ink Navy with white text, 12px 22px, weight 800, 1rem. Used once per sheet or panel for the main action.
- **Icon / secondary:** Paper White with a Soft Line border, 8px 14px, weight 600, emoji plus a word.
- **Mini:** Cloud with a border, 4px 10px, 0.78rem, weight 700, for inline row actions.
- **Danger:** a secondary button with Berry Bad text and a border tinted 40% berry. Destructive actions confirm in a pale berry panel first.
- **Link button:** Focus Blue, underlined, no box.
- **Floating +:** a 64px Ink Navy circle at the bottom right with a floating shadow. It scales to 1.06 on hover.
- **Focus:** a 3px Focus Blue outline with a 2px offset, on everything.

### Tabs and segmented controls
- **Tabs:** a white pill tray with the board lift, holding pill tabs in Slate Muted. The active tab fills Ink Navy.
- **Segmented:** a Cloud tray. The selected segment becomes a white pill with the board lift.

### Chips and pills
- **Agenda row (Month):** a Cloud row (14px radius) with the time, a big emoji, the title and faces. It follows the Solo Tint Rule: 12% person tint when one person goes, neutral with faces when it's shared.
- **Event chip:** a Cloud row (12px radius) with a muted time column, tinted 10% person color when that person is driving, and a 2px person ring when it's happening now. Past chips fade to 50%.
- **Status pill:** a small pill in the warn, bad, good or muted pair.
- **Person toggle:** a pill with a 2px border holding a face and a name. When pressed, the border becomes the person color and the fill a 16% tint.

### Cards / Containers
- **Panel:** Paper White, 24px corners, the board lift, 18px padding, and a Fredoka heading row.
- **Timeline card:** Cloud (or a 11% person tint when it's one person's), 18px corners, a big emoji, a Fredoka title and stacked faces at the end. A person-colored dot on a hairline spine sits beside it, and it pulses while the event is happening.
- **Alert (heads-up):** a white or status-tinted card, 16px corners, with an emoji, a bold line and a small Ink Navy action pill.

### Inputs / Fields
- **Style:** Cloud fill, 2px Soft Line border, 12px corners, 9px 12px padding. The label sits above in small bold Slate Muted.
- **Big input** (quick add): 1.15rem text, 16px corners, 14px 16px padding.
- **Focus:** the global Focus Blue ring. **Errors:** a pale berry block with berry text that says what to do next.
- Date and time fields reset their iOS appearance so they don't overflow on iPhones (44px minimum height).

### Navigation
The top bar is the Homebase wordmark (Fredoka 700, 1.5rem) with a muted subtitle, then the tab tray, then round icon buttons. Below 520px the tabs tighten and the ambient tab hides. There's no bottom nav. The + button and nudge banners own the bottom edge.

### Chore tile (signature)
The sticker chart itself. A tile has a big emoji (2 to 3.2rem) over a short label, a 7% person-tinted fill, a dashed person-colored border and 18px corners. Pressing it scales it to 0.95. When done, the border goes solid, the fill deepens to 20%, and a ★ badge in a darkened person color stamps onto the corner (a 0.35s overshoot rotate-in). Finishing the last job brings up a full-screen celebration: a 9rem emoji spins in, a white pill caption appears, and confetti falls.

### Faces
A circle with an emoji avatar, a person-colored ring and a pale person tint inside. They come in sizes from 24px (in rows) up to 84px (sign-in). Overlapping stacks of faces show who's going. A berry count badge marks unfinished things.

### Nudge banner
A white card with an 18px radius, pinned to the bottom center above the ambient screen, kept to one line: a 40px icon tile (12px radius) whose background shows the kind (pale berry for leave-by, pale amber for bills, pale green for briefings, Cloud for anything else), a Fredoka title that truncates (tap it to expand), faces, and a "Got it" pill. It pops in over 0.25s. Over ambient photos it's frosted with white text and a white pill. At night it's black with Bedside Amber text and a 1px amber border, with no shadow and no pop, and the pill becomes an amber outline. On phones the banners sit above the + button, wrap titles to two lines and scroll if they stack up.

### Kid mode top row
Kid mode has no parent header. Its top row holds the kids' faces (big pill buttons; the current one gets a person-colored border and a 16% tint), a quiet "note for grown-ups" chip when a nudge is up (a white pill in Slate Muted with nothing to press; black and amber at night), and the 🏠 way out: a 64px circle you hold, which fills from the bottom over 1.2s before leaving. Sleeps-to-go show a Fredoka number plus 🌙 moons grouped in fives, so 9 and 10 look different at a glance.

### Tomorrow board (signature)
The evening run-sheet for a parent asking "is tomorrow sorted?".
- **Leave-by hero:** a 24px-radius card with the board lift, tinted 14% in the driver's color. The leave-by time is clock-sized Fredoka in the driver's color mixed 70% with Tint Ink. The driver's face (44px, 3px ring) leads the sentence ("Dad leaves for School"), with who's going and the drive time below in muted text.
- **Needs sorting:** each driver gap is an 18px Warn-background tile with the event's emoji, a Fredoka question ("Who's driving Emma to Soccer?") and parent person toggles to answer it in place. Clashes are pale-berry rows with a bad pill that open the event.
- **All set:** the panel turns Good-background with no lift, and a 36px ★ stamp (the sticker chart's star, in Pine Good) stamps in beside the Fredoka line.
- **Who's going where:** rows like the Month agenda (the Solo Tint Rule), with the ride at the end: 🚗, the driver's face and the leave-by time, or a warn "Needs a ride" pill.

### Ambient screen
A full-bleed photo (or a slowly drifting gradient scene) under a dark bottom-up shade. A giant white Fredoka clock sits top-left with frosted weather beside it, and frosted pills along the bottom show each person's next thing. Night mode drops the photos and turns everything to dim Bedside Amber on black.

## Do's and Don'ts

### Do:
- **Do** give every person-related element the person's color through `--pc` (set with `pc()`), mixed 7 to 22% into the surface for fills.
- **Do** pair every item with an emoji, and mark decorative emoji `aria-hidden` when text sits beside it.
- **Do** use Fredoka for anything glanceable and Figtree for anything read up close.
- **Do** keep one Ink Navy primary action per sheet or panel, as a full pill.
- **Do** show "now" and conflicts with a 2px inset ring, not by changing size or layout.
- **Do** celebrate completion (stamp, pop, confetti) and turn all motion off under `prefers-reduced-motion`.
- **Do** keep touch targets big: 64px number keys, 104px or larger tiles, 64px + button.
- **Do** tint an event row with its person's color only when one person goes; leave shared events neutral and let the faces say who.
- **Do** switch anything left on at night to Bedside Amber on black, with amber outlines for actions.

### Don't:
- **Don't** drift toward a corporate calendar: no thin-ruled dense grids, no grey boxed cells packed with small text, no square corners.
- **Don't** go babyish on the parents' screens: no rainbow fills, extra colors, bouncing or confetti in Settings, forms, the week grid or the nudge feed. Keep the play for kid mode, tiles and completion.
- **Don't** introduce a brand color, gradient or category color into the shell. Saturated color is for people and status only.
- **Don't** stack shadowed cards inside shadowed panels. Nest with tone (Cloud on Paper White) instead.
- **Don't** rely on text alone on kid-facing screens. A picture, a face or a color has to carry the meaning too.
- **Don't** use full-strength person color as small text. Mix it with Tint Ink first so it stays readable.
- **Don't** mark who or what kind with a colored side stripe on cards or rows. Use a tint, faces or an icon tile.
- **Don't** let person colors, solid fills or shadows glow on the hub at night.
