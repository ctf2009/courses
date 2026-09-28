# Course curation

Zora owns priorities and communication. Curator owns catalogue maintenance, course
review and actionable briefs. The catalogue and reviews are inputs to a separate
local worker; the learner site does not execute this tooling.

## Catalogue

`catalogue.json` lists every course page in `public/` and `drafts/`. `served` means
the file belongs to the static site's publish directory, not that a live deployment
was checked. `reviewStatus` is independent of placement. Existing courses start as
`not-reviewed` for this intake; that does not discard their previous curation work.
Audience and objective are initial editorial summaries to refine during review.

Run `npm run curate:check` to check catalogue integrity. This checks inventory and
references only, not lesson correctness, browser behaviour or publication readiness.

## Review standards

- Explain a clear mental model, practical examples, trade-offs and failure cases.
- Exercises should test judgement as well as recall.
- Record primary sources, the version/date they apply to, and which claims they
  support. Treat unsupported or time-sensitive claims as open review items.
- Follow the completion contract in the repository README: 60% pass, saved attempts,
  no answer disclosure before submission, limited disclosure on failure, explicit
  retakes and restored progress. Preserve existing storage keys and learner state.
- Keep course navigation and hub progress consistent. Verify desktop and mobile
  rendering, diagrams, keyboard interaction and downloadable assets in a browser.
- Keep runtime libraries inline or same-origin. Dependency checks must distinguish
  actual resource loads from code examples in lessons. Preserve course identity.

Each review records the source revision or file hashes, findings with evidence,
checks actually performed, outstanding checks and a bounded next brief. A coding
agent's completion statement alone is not verification evidence.

## Deployment and execution direction agreed 2026-09-10

Updated 2026-09-28: the standalone authoring lane described below does not depend
on Ralph. The earlier remote-Ralph notes remain historical direction, not a
prerequisite for requesting bounded candidate work.

- Curator runs on the Zora box. Zora and Curator continue using the existing local
  file inbox/report bridge until a future discovery service is ready.
- Ralph will run on its own server once its execution lifecycle is mature enough.
  No shared filesystem with remote Ralph is assumed.
- Curator can review courses and prepare briefs before Ralph is connected.
- A future Ralph adapter submits a brief and tracks its job identifier; transport
  selection is deferred. Discovery must not define course-review semantics.
- Retain the existing design's split between low-risk automatic publishing and
  human review for new courses or substantive content changes. Neither publishing
  lane is implemented here. Both imported courses require review before release.

## Local file worker

`npm run curate:run` processes one batch using an explicitly configured absolute
`DOMAIN_INBOX_DIR`. It consumes the existing Zora domain envelope from
`requests/pending/curator-courses/` and writes origin-bound reports under
`reports/pending/curator-courses/`. Supported request types:

- `catalogue`, payload `{}`: returns the catalogue, without a deployment claim.
- `review_course`, payload `{"courseId":"archi"}`: returns a saved review and source
  hash comparison, or `review-needed`. It does not perform a new factual review.
- `fresh_review_course`, payload `{"courseId":"archi"}`: runs the fixed
  `archi-browser-v1` structural/browser profile, with top-level `origin: "owner-request"`
  required. No other course/profile, supplied script, URL or filesystem path is accepted.
  Host tools derive the owner identity and delivery conversation from authenticated
  context, never model arguments.

Run `npm run curate:test` for file-bridge and handler tests. The worker has no editing,
Ralph submission or publishing capability. This repository contains the worker;
deployment and authenticated Zora tool registration remain separate work.

Completed reports have deterministic IDs. Interrupted read-only requests in `started`
can resume without re-enqueuing a report already pending, delivered, rejected or
retained. A directory lock prevents concurrent batches. The inbox is a trusted
local directory shared with the host, not an unauthenticated upload endpoint.

## Supervised local worker

`npm run curate:watch` runs continuous batches every 15 seconds. After each
successful pass and catalogue read, it writes `workers/curator-courses.json` in
the inbox. Zora accepts new requests only while this heartbeat is at most 45
seconds old and its local process is alive. A normal shutdown removes the
heartbeat; a crashed or stalled worker becomes unavailable. Saved reports remain
readable while the worker is offline.

`curator-courses.service` is a systemd unit for the gateway. Install the reviewed
repository at `/home/chris/curator-courses`, create the inbox owned by `chris`, and install
the unit under `/etc/systemd/system/`. Both Zora and the worker must use the same
absolute `DOMAIN_INBOX_DIR`. Enable `builtin:curator` in Zora's tool manifest;
the owner-only tools additionally require `curator.read`. No website deployment
or course publication is part of worker installation.

The service holds a kernel `flock` for its lifetime and enables `--recover-stale-lock`.
On restart it can recover a batch lock only if the same user's recorded process
has disappeared. A live PID, uncertain permissions or an older unlabelled lock
fails closed. For those cases, stop the service, verify no worker is running,
remove that one `.curator-courses.lock` directory, and restart. Never use the
recovery flag outside the supplied exclusive `flock` wrapper. Reports contain
saved evidence, not authority to execute code.

## Fresh Archi review

`request_fresh_course_review` is separate from saved-review retrieval. The worker
snapshots the current Archi source and runs a new disposable Chromium context with
no owner profile or credentials. The profile visits every module on desktop and
checks rendered content, inline diagram counts, overflow, hub navigation and runtime
resource elements. It exercises one quiz with all-wrong and all-correct answers,
keyboard selection, answer disclosure, completion, reload persistence and explicit
retake availability. Module 0 also gets a mobile-width check. There is no LLM or
arbitrary command execution in the worker.

Reports retain check outcomes and observations, findings, dates, source hashes before
and after, browser version and four screenshots. `browserVerified: true` means the
browser checks executed, not that every check passed. Factual claims and primary
sources are **not** independently reviewed. The exact 60% boundary, other quizzes,
mobile modules beyond module 0, human visual inspection, hub progress integration,
downloads and live publication remain outstanding.

Evidence lives outside the installation in
`$DOMAIN_INBOX_DIR/evidence/curator-courses/<requestId>/`: `snapshot.json`, immutable
`source.html`, `review.json`, `report.md`, and screenshots. The snapshot manifest
binds the original requester/conversation, request type, start time and source hash.
Interrupted work reuses that snapshot; changed current source becomes an explicit
finding rather than silently changing the reviewed version. Completed evidence is
reused only after origin and artifact hashes are checked. Preserve this directory
across worker upgrades. `get_curator_request` retrieves the full result/report text
from the original conversation; evidence locations are private operator paths, not
public download links. The worker never edits or publishes learner courses.

### Browser runtime and isolation

Install runtime dependencies with `npm ci --omit=dev --ignore-scripts`. The lockfile
pins `playwright-core` **1.60.0**, whose matching Chromium is revision **1223**, version
**148.0.7778.96**. Provision it as the worker user before starting the isolated unit:

```sh
node node_modules/playwright-core/cli.js install chromium
```

The expected Linux full-browser executable is
`/home/chris/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`. An operator can
set `CURATOR_CHROMIUM_EXECUTABLE` to a separately approved compatible executable;
this is not a tool argument. Verify any override with `npm run curate:test:browser`
under the deployed service restrictions. Do not silently disable Chromium's sandbox.

The supplied systemd unit uses `PrivateNetwork=true` and `PrivateTmp=true`, so even
browser background requests have no external network namespace. The harness also
uses a dead local proxy, blocks page network and WebSocket routes and service workers,
and serves only the exact in-memory snapshot navigation with a restrictive CSP.
There is no filesystem HTTP server. External fonts are blocked, so screenshots use
fallback fonts. Browser startup is bounded at 15 seconds and checks at 60 seconds;
at most 30 modules and a 2 MB source are accepted. No download or publication is allowed.

Worker heartbeat version **1.3.0** includes `reviewProfiles: ["archi-browser-v1"]`
only after sandboxed Chromium successfully starts. If it cannot start, catalogue
and saved reviews still work, while the host refuses fresh requests without queuing
them. A later browser failure produces a failed report, never a successful review.
During a long/stalled batch the heartbeat can expire; this prevents new admissions
until another successful pass. The process ID is also checked, so a crash cannot
leave a healthy service claim behind.

Run `npm run curate:test` for bridge/handler tests and `npm run curate:test:browser`
for real browser evidence, origin/recovery, immutable snapshot and blocked-network
checks. The latter requires the installed matching Chromium. Both operate on temporary
inboxes and leave learner course sources unchanged.

## Follow-on implementation

Standalone draft creation and behaviour-only Archi revision now use the
[course work contract](course-work-contract.md). Zora's host owns model calls,
durable task state and continuation; this worker renders and verifies candidates
under the existing inbox. It never edits the original course or publishes.
Heartbeat 1.3.0 advertises `workProfiles: ["course-work-v1"]` once its fixed source
API and browser are ready. Candidate inputs and all resulting evidence stay in
`course-work/jobs/<requestId>/candidates/<version>/` across upgrades.

After installing the worker and host tools, verify a real request/report. Do not
mark Curator available until a worker can actually accept its requests.

For eventual execution, a brief needs course IDs, source revision, objective,
acceptance criteria, allowed paths, execution limits and publication classification.
A result needs the job ID, exact resulting revision, verification evidence, unresolved
findings and publication state. Persist job state separately from the prose handover;
restart recovery must not submit the same editing job twice.

## Work board

Vikunja project `curator-courses` is project 16, Kanban view 72. Its columns are
Backlog, Queue, Running, Review, Error and Done. Ralph's current adapter only claims
cards in Queue carrying the `approved` label. Backlog is not execution approval.
Ralph still needs a registered `courses` repository and `courses-default` verification
profile, its own server deployment and this project/view configured. Existing Ralph
self-development configuration has not been changed.
