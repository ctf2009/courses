# How It Actually Works — courses

A small, growing set of **interactive, build-from-zero** courses — mostly "how does
this actually work under the bonnet", plus one professional certification course. No
server, no build step, no accounts, no tracking. Progress is saved locally in the
browser (`localStorage`).

Live: <https://courses.chrisflaherty.au>

The served site lives in `public/`; everything else is repo tooling.

## The courses

| File | Title | Modules | Completion key | Attempt key |
|------|-------|---------|----------------|-------------|
| `public/index.html` | Hub — "How It Actually Works" | — | reads the four below | — |
| `public/llm-course.html` | How Does an LLM Work? | 12 + bonus | `llm-course-done` (flat) | `llm-course-quiz` |
| `public/rag-course.html` | How RAG Actually Works | 18 | `rag-course-done` (flat) | `rag-course-quiz` |
| `public/websec-course.html` | Web Security — Cookies, CORS, CSRF & Token Auth | 10 | `websec-progress-v1` (`.done`) | same key, `.quiz` |
| `public/togaf-course.html` | TOGAF 10 — Certification Course | 17 | `togaf10:v1` (`.progress[id].passed`) | same key, `.picks` |

Supporting assets: `public/vendor/` (shared libraries) and `public/artifacts/`
(downloadable worked deliverables, currently TOGAF's two `.docx` files).

## The invariant (please keep it)

**No course may depend on a third-party host at runtime.** The only outbound request
any course makes is the shared Google Fonts stylesheet. No CDNs, no bundlers, no
imports — a course must still work years from now when cdnjs has moved on.

Libraries are satisfied one of two ways:

- **Inline** — paste it into the page. Right for small ones; `websec-course.html`
  carries `marked@12.0.2` this way.
- **Shared, in `public/vendor/`** — a same-origin `<script src="vendor/…">`. Right for
  anything large or wanted by more than one course. `mermaid@10.9.0` (3.3MB) and
  `marked@12.0.2` live here; `togaf-course.html` uses both, and any course is free to.

> Superseded 2026-07-24: the original rule also required each course to be a *single
> file you could email to someone*. TOGAF broke that regardless — it links downloadable
> `.docx` artifacts — and inlining 3.3MB of mermaid per course to preserve it was the
> worse trade. Courses are now same-origin-portable rather than single-file-portable.

Design system: the three how-it-works courses share CSS variables (`--ink`, `--bg`,
`--accent`, …), Space Grotesk for display and IBM Plex Sans/Mono for body/code. TOGAF
deliberately keeps its own drafting-vellum identity (Archivo / Source Serif 4 /
JetBrains Mono) and is tied into the set through the hub card and a shared back-link
rather than a reskin. Each course carries an accent colour used on its hub card:
LLM = indigo, RAG = green, Web Security = red, TOGAF = ink blue.

## How completion works (please keep this too)

**A module is completed by passing its quiz — never by self-declaring it.** All four
courses use the same model:

1. Select an answer to every question. Nothing is revealed while you choose.
2. Submit. Everything grades at once, correct answers and rationales reveal, and the
   attempt is **saved** — `{picks, score, max, passed}`.
3. Pass mark is **60%**. Passing ticks the module and advances the progress bar.
4. Retake is unlimited and explicit.

Saving the picks is the point of step 2: previously a wrong answer lived only in the
DOM, so reloading the page silently wiped it and you could re-answer as if nothing had
happened. Now a reload replays the graded attempt, and clearing it takes a deliberate
Retake.

Two things to be careful of when adding or editing a course:

- **A module with no quiz can never be passed**, so it would strand the progress bar
  below 100% forever. Both such modules (`websec` m00, `togaf` overview) are marked
  complete on read instead. TOGAF records those as `max: 0` so they stay out of the
  score averages — check `refreshScorechip` if you add another.
- **Don't widen the completion key's shape.** The hub reads these keys directly and
  counts them two different ways (see below); attempts live alongside, not inside.

## Adding a course

1. Create `public/your-course.html` following the shared design system (or a
   deliberate one of its own, as TOGAF does). Satisfy any library inline or via
   `public/vendor/` — never from a CDN.
2. Give it a stable `localStorage` progress key.
3. Add a card to `public/index.html` (topic label, title, one-line arc, module count,
   and wire its progress bar). Note the hub's two counting helpers: `count()` for flat
   `{id: true}` keys, `countPassed()` for TOGAF-style `{id: {score, max, passed}}`.

## Curation log

- **2026-07-24 — earned completion + a way back to the hub** (both from reader feedback).
  Every course now has an "← All courses" back-link; there was previously no way home
  from inside a course. And the honour-system "Mark module complete" button is gone from
  LLM, RAG and Web Security — completion is earned by passing the quiz, which those three
  converted from instant-reveal to submit-then-reveal to make meaningful. All four now
  persist the attempt, closing the reported loophole where refreshing the page wiped a
  wrong answer. See "How completion works" above.
- **2026-07-24 — absorbed the TOGAF 10 course.** It previously lived in its own repo
  (`ctf2009/togaf-10`) on GitHub Pages; that Pages site has been taken down and the
  course now serves from here. Brought its two `.docx` artifacts across, moved its
  `marked` + `mermaid` off cdnjs into `public/vendor/`, and amended the invariant above
  to allow shared vendored assets. Widened the hub umbrella to admit a certification
  course alongside the three how-it-works ones. TOGAF's own visual identity was kept
  intentionally — see Design system.
- **2026-07-23 — first manual curation pass** (the pattern the Zora "Curate Domain"
  will later automate): promoted the hub from a hardcoded "two-course set" to a
  count-free, extensible "How It Actually Works" umbrella; un-orphaned
  `websec-course.html` (it existed but was linked from nowhere); and vendored
  `marked@12.0.2` **inline** into the web-security course, removing its lone `cdnjs`
  dependency so it once again satisfies the zero-external-dependency invariant.

## Hosting

Cloudflare Workers static site (mirrors `chrisflaherty-site`): `worker.js` serves
`public/` via `@cloudflare/kv-asset-handler`. `wrangler.toml` declares the
`courses.chrisflaherty.au` custom domain, so a single `wrangler deploy` provisions
the DNS + cert (the `chrisflaherty.au` zone must be in the same Cloudflare account).

```
npm install
npm run dev      # local preview
npm run deploy   # publish to courses.chrisflaherty.au
```
