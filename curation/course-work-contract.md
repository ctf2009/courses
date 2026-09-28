# Standalone candidate work contract, version 1

Zora owns the brief, durable task, model calls, bounded revisions and owner-facing
review. This worker supplies a trusted renderer and browser verifier. It has no
Ralph, model credentials, arbitrary shell tool, GitHub write or deployment action.
It does not edit `public/`, `drafts/`, the catalogue or publication configuration.

The host admits `requestType: "course_work"`, `domainName: "curator-courses"`,
`origin: "owner-request"`. Its payload contains host-bound `taskId`, `mode`
(`create` or `revise`) and `courseId`. Identity, channel and conversation are taken
from the owner admission, never generated content. The ordinary file worker leaves
these parent requests for the host to manage.

## Fixed source and candidate input

Before advertising work readiness, the worker atomically writes
`course-work/sources/archi.json` under the configured `DOMAIN_INBOX_DIR`:
`{schemaVersion:1, courseId:"archi", sourceSha256, sourceHtml, preparedAt}`.
This is the only editable existing course in this slice. The host captures its
exact hash and applies exact patches to that immutable base when requesting a revision.
The verifier retains its own baseline and refuses drift from the installed source.

For a new course the model returns `{document: ...}`. The strict document schema is:

- `title`: 1–120 characters; `subtitle`: 1–400.
- `modules`: 2–16 objects, each with `title` (1–120), `sections` (1–8) and `quiz`.
- A section has `heading` (1–160), `paragraphs` (1–8 strings, each 1–2500), optional
  `bullets` (0–12 strings, each 1–500) and optional `code` (1–8000, displayed as text).
- A quiz has exactly five questions. Each has `question` (1–600), `options` (2–6
  strings, each 1–500), zero-based integer `answer`, and `explanation` (1–1500).
- Optional `sources`: up to 30 `{title,url}` objects. Title is 1–160; URL is an HTTPS
  URL of at most 2000 characters with no embedded credentials. These are supplied
  references, not independent factual verification.
- Unknown fields and non-whitespace control characters are rejected. All model
  prose is escaped. Only the repository's trusted player supplies HTML behaviour.

For an Archi revision, the host sends `{candidateHtml: "..."}` after applying its
bounded patch list. All Archi lesson/quiz source bytes must remain identical, and
`archi-course-v1`, existing completion and saved state must survive. This lane can
repair quiz/navigation/layout behaviour, but cannot rewrite factual lessons.

The host writes immutable UTF-8 JSON to
`course-work/jobs/<requestId>/candidates/<version>/candidate.json`. Its SHA-256 is
computed over those exact bytes. IDs match `^req_[A-Za-z0-9_-]{1,120}$`; candidate
versions are integers 1–3. The entire JSON is at most 2 MiB. Course IDs match
`^[a-z][a-z0-9-]{1,63}$`; new IDs must not already exist in the catalogue.

## Check queue and binding

The host writes `course-work/checks/pending/<requestId>-v<version>.json`:

```json
{
  "schemaVersion": 1,
  "requestId": "req_example",
  "taskId": "curator-example",
  "zoraId": "authenticated-owner-id",
  "chatId": "origin-conversation-id",
  "channel": "discord",
  "mode": "create",
  "courseId": "example-course",
  "version": 1,
  "candidateSha256": "64-lowercase-hex-characters"
}
```

Revision envelopes additionally require `baseSha256`; create envelopes omit it.
There are no supplied filesystem paths or executable commands. The worker derives
every location, rejects symlinks and checks identity/mode/course/task against the
active top-level host request. It atomically claims into `checks/processing`,
recovers processing before pending, then publishes `checks/completed` atomically.
Malformed envelopes are moved to `checks/rejected`. A correctly bound but invalid
candidate returns a failed result with a reason and no successful-review claim.

Results echo the whole envelope plus `profile: "course-work-v1"`, `status`
(`passed`/`failed`), `checkedAt`, optional rendered `sourceSha256`, `checks`,
`findings`, `artifacts`, `evidenceLocation`, `limitations`, `reportText`,
`browserVerified`, `factualReviewPerformed:false`, `publicationVerified:false`,
and optional `error`. Completed browser runs also include `browserVersion`,
`limits` and `screenshots`. Each check has `{id,status,evidence}`; evidence is
structured JSON. Source hash may be absent only when rendering failed.

Host acceptance must verify the full envelope, all artifact hashes and mandatory
check IDs, not just trust a producer's `passed` string. Recovery verifies retained
origin and artifact hashes before returning an existing result. `draft.html` and
input/manifest records are immutable within a candidate version. Interrupted
verification can regenerate screenshots/report before an atomic final review.

## Verification and limitations

The trusted renderer provides 60% pass, submit-all grading, saved attempts,
reload replay, explicit blank retakes, preserved earned completion, course-hub
navigation and unrestricted module navigation. Browser checks exercise **every**
module on desktop and at 390px, every quiz immediately below its pass boundary
and at its minimum passing score, with an actual 3/5 (60%) case. They also seed
historical done/quiz/extra state and check it survives a new attempt.

Mandatory checks for both modes:

`stable-storage-key`, `runtime-resource-policy`, `hub-navigation`,
`all-module-rendering`, `all-module-overflow`, `free-module-navigation`,
`navigation-controls-work`, `existing-state-preserved`, `keyboard-selection`,
`existing-state-survives-new-attempt`, `progress-count-matches-completion`,
`hub-progress-compatible`, `meaningful-60-percent-boundary`,
`answers-hidden-before-submit`, `failed-attempt-hides-missed-answers`,
`attempts-persist-after-reload`, `explicit-retake-starts-blank`,
`javascript-runtime-errors`, `candidate-input-unchanged`, `draft-source-unchanged`.

Revisions also require `lesson-source-preserved` and `installed-source-unchanged`.
Preservation compares every lesson-bearing script suffix, from its first module
through its closing script, byte-for-byte and in the original count and order.
The current five-script Archi source is covered through its final module.
Any failed or missing required check prevents a passing result.

Artifacts retained in the candidate directory include `draft.html`, input and
check manifest, `review.json`, `report.md`, desktop/mobile screenshots for every
module, threshold screenshots and a trusted `hub-preview.html` plus screenshot.
The preview reads the candidate's real localStorage in the same isolated browser
context; it proves draft progress compatibility. **The public hub is not changed,
and live hub integration is not claimed.** Private evidence paths are not download URLs.

The same sandboxed Chromium harness, blocked service workers/WebSockets/network,
dead proxy, CSP and private systemd network namespace are used as fresh reviews.
Only the candidate and one fixed, trusted hub preview are served from memory;
there is no filesystem web server. Browser startup is limited to 15 seconds and
checks to 120 seconds. At most 30 modules, 20 questions per module and 10 options
per question are accepted for revisions. Factual accuracy, source quality,
complete human visual inspection, actual hub integration and publication remain
outside this mechanical check. Existing historical completion is preserved;
it is not retroactively represented as a newly earned quiz pass.

Worker heartbeat version 1.3.0 exposes `workProfiles:["course-work-v1"]` only when
the source API is ready and sandboxed Chromium has started successfully. The host
owns task continuation and can request the next candidate version; a report alone
does not authorize new work. Stop after version 3 and retain useful partial evidence.
