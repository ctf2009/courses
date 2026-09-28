# Course curation

Zora owns priorities and communication. Curator owns catalogue maintenance, course
review and actionable briefs. These files are the first local inputs to that domain;
they do not activate a worker or give Zora tools yet.

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

Run `npm run curate:test` for file-bridge and handler tests. The worker has no editing,
Ralph submission or publishing capability. This repository contains the worker;
deployment and authenticated Zora tool registration remain separate work.

Completed reports have deterministic IDs. Interrupted read-only requests in `started`
can resume without re-enqueuing a report already pending, delivered or rejected.
A directory lock prevents concurrent workers. After an abrupt process termination,
an operator must confirm no worker is running before removing
`DOMAIN_INBOX_DIR/.curator-courses.lock` and restarting. The inbox is a trusted local
directory shared with the host, not an unauthenticated upload endpoint.

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

If an abrupt termination leaves `.curator-courses.lock`, stop the service,
verify no worker is running, remove that one lock directory, and restart. Existing
pending, delivered, rejected **and retained** reports suppress replay during
request recovery. Reports contain saved evidence, not authority to execute code.

## Follow-on implementation

Wire authenticated Zora tools to the local handler using the existing domain
envelopes, then deploy the worker on the Zora box and verify a real request/report.
Do not mark Curator available until a worker can actually accept its requests.

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
