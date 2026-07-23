# How It Actually Works — courses

A small, growing set of **self-contained, interactive, build-from-zero** technical
courses. Each course is a single HTML page you can open in a browser (or email to
someone) and it just works — no server, no build step, no accounts, no tracking.
Progress is saved locally in the browser (`localStorage`).

Live (planned): `courses.chrisflaherty.au`

The served site lives in `public/`; everything else is repo tooling.

## The courses

| File | Title | Modules | Progress key |
|------|-------|---------|--------------|
| `public/index.html` | Hub — "How It Actually Works" | — | reads the three below |
| `public/llm-course.html` | How Does an LLM Work? | 12 + bonus | `llm-course-done` (flat) |
| `public/rag-course.html` | How RAG Actually Works | 18 | `rag-course-done` (flat) |
| `public/websec-course.html` | Web Security — Cookies, CORS, CSRF & Token Auth | 10 | `websec-progress-v1` (`.done`) |

## The invariant (please keep it)

**Every course must be a single, self-contained HTML file with no external runtime
dependencies.** The only outbound request any course makes is the shared Google Fonts
stylesheet (part of the design system). No script/style CDNs, no bundlers, no imports.
This is what makes the courses portable and durable — vendor anything you need
*inline* instead of linking a CDN.

Shared design system: CSS variables (`--ink`, `--bg`, `--accent`, …), Space Grotesk
for display, IBM Plex Sans/Mono for body/code. Each course carries an accent colour
(LLM = indigo, RAG = green, Web Security = red).

## Adding a course

1. Create `public/your-course.html` as a single self-contained page following the
   shared design system. Vendor any library inline (see below).
2. Give it a stable `localStorage` progress key.
3. Add a card to `public/index.html` (topic label, title, one-line arc, module count,
   and wire its progress bar).

## Curation log

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
