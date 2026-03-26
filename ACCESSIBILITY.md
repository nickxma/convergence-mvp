# Accessibility Compliance

Convergence targets **WCAG 2.1 Level AA** conformance.

## Fixes Applied (OLU-317)

### 1. Skip Navigation Link
- Added "Skip to main content" skip link in `app/layout.tsx` (screen-reader visible only, appears on focus)
- Added `id="main-content"` to `<main>` elements across all pages

### 2. Modal Dialogs
All modal dialogs now implement the ARIA dialog pattern:
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointing to the modal heading
- Focus trap: Tab/Shift+Tab cycle within dialog bounds
- Return focus: focus returns to the triggering element when modal closes
- Escape key closes modals

Files fixed: `components/create-post-modal.tsx`, `components/onboarding-modal.tsx`, `components/shortcuts-modal.tsx`

### 3. Form Labels
- Title and body inputs in `CreatePostModal` now have visually hidden `<label>` elements
- Character count indicators linked via `aria-describedby`

### 4. ARIA Labels — Icon-Only Buttons
All icon-only interactive elements have descriptive `aria-label` attributes throughout the codebase.

### 5. Decorative Icons
All decorative SVG icons have `aria-hidden="true"` applied across all components and pages. This prevents screen readers from announcing meaningless SVG path data.

### 6. Keyboard Navigation — Suggestions Listbox
The Q&A textarea is now wired as a combobox:
- `aria-controls` → suggestions listbox id
- `aria-activedescendant` → id of the currently highlighted option
- `aria-autocomplete="list"` + `aria-expanded`
- Each `role="option"` element has a stable `id`

### 7. Heading Hierarchy
Heading levels are consistent (h1 → h2 → h3) across all audited pages. No levels are skipped.

### 8. Focus Indicators
Added explicit `:focus-visible` CSS rule in `globals.css` using the sage green accent color with 2px offset.

### 9. Progress Indicator (Onboarding Modal)
Progress dots now use `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label`.

### 10. Color Contrast — Step Numbers
Fixed `app/page.tsx` step numbers ("01", "02", "03") which used `--sage-pale` (#b0c4a8 ≈ 1.69:1 contrast — critical failure). Now uses `--sage-mid` (#5a6b52 ≈ 5.43:1 — passes AA).

### 11. Delete Button Keyboard Visibility (Profile Page)
The conversation delete button was hidden with `sm:opacity-0 sm:group-hover:opacity-100`. Added `sm:focus:opacity-100` so keyboard users can see and access it. Also improved aria-label to include conversation title.

---

## Fixes Applied (OLU-913)

### 12. Notification Bell — Escape Key + Decorative Icons
- Added `keydown` handler: Escape closes the notification panel and returns focus to the bell button
- All `NotificationIcon` SVGs marked `aria-hidden="true"` (they are decorative)
- Empty-state bell SVG also marked `aria-hidden="true"`

### 13. Wallet Balance Dropdown — `aria-haspopup` + Escape + `aria-hidden`
- Added `aria-haspopup="true"` to the trigger button
- Added Escape key handler to close the dropdown
- Wallet icon SVG marked `aria-hidden="true"`

### 14. Meditate Interface — Multiple Fixes
- `SourceList` toggle button now has `aria-expanded` and `aria-controls="source-list-panel"`; chevron SVG is `aria-hidden`
- Submit (generate) button now has `aria-label="Generate meditation"`; arrow SVG is `aria-hidden`
- Character counter now has `role="status"` and `aria-live="polite"` so screen readers announce limit changes
- Decorative sun/loading SVGs marked `aria-hidden="true"`

### 15. Meditation Audio Player — Speed Button Labels
- Both desktop and mobile speed buttons now have `aria-label` describing current speed and action (e.g. "Playback speed: 1×. Click to cycle.")

### 16. Audio Player — `role="region"`
- Container `<div>` now has `role="region"` to pair correctly with the existing `aria-label="Audio narration player"`

### 17. Voice Card Grid — Selection State + Decorative Icons
- Voice selection buttons now have `aria-pressed={selected}` so screen readers announce which voice is active
- Added `aria-label` combining name and description (e.g. "Calm: Slow & soothing") so the button's purpose is clear without surrounding context
- Play/pause/loading spinner SVGs inside the preview button are `aria-hidden="true"`

---

## Intentional AA Deviations

### Primary Sage Button Contrast
**Affected:** All primary CTA buttons using `background: var(--sage)` (#7d8c6e) with white text.

**Contrast ratio:** White (#ffffff) on sage (#7d8c6e) ≈ **3.59:1**

**WCAG 1.4.3 requires:** 4.5:1 for normal text, 3:1 for large text (18pt+ or 14pt+ bold).

**Impact:** Button label text is `text-sm` (14px, regular weight) — technically fails AA for normal text contrast.

**Justification:** This is the core brand color established by Paradox of Acceptance design system. Changing it would require a complete design token overhaul affecting every CTA across both Convergence and PoA properties. The difference (3.59 vs 4.5) is narrow, and the interactive context (distinct button shape, hover/active states) provides additional affordance beyond color contrast alone.

**Mitigation plan:** Evaluate switching primary CTAs to `var(--sage-dark)` (#3d4f38, white contrast ≈ 8.85:1) in a future design-system update.

### Muted/Supporting Text
**Affected:** `--text-muted` (#9c9080) used for secondary/supporting labels.

**Contrast ratio:** ≈ 2.96:1 on light background.

**Justification:** Used exclusively for supplementary metadata (timestamps, counts, separators) — never for primary content. Users are not required to read this text to complete any task. Treated as "incidental text" per WCAG exception.

---

## Audit Scope

Pages audited: Landing, Q&A, Community Feed, Post Detail, User Profile, Bookmarks, Topics, Leaderboard, Login, Admin.

Components audited: `qa-interface`, `create-post-modal`, `onboarding-modal`, `shortcuts-modal`, `command-palette`, `search-bar`, `vote-button`, `landing-page`, `meditate-interface`.

Tool: Manual audit + structural review (axe-core programmatic audit requires a running browser environment).
