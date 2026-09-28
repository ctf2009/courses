# Archi candidate review — 2026-09-28

Archi remains a draft, with `reviewStatus: changes-needed` until factual review,
human review and public-hub integration are resolved. This change updates its
player behaviour and review records; it does not publish a course.

## Authorship and source

Zora's durable task discovered Curator and commissioned the owner's saved Archi
brief. Standalone Curator used Zora's configured model to author the accepted
candidate. Zora then assessed the returned checks in the same task. An operator
copied the accepted source and sanitized evidence into this branch without
editing the candidate. These are results from the actual delegated work, not
the earlier operator-authored test fixture. Human approval remains outstanding.

- Reviewed file: [`drafts/archi-course.html`](../../drafts/archi-course.html).
- Accepted source SHA-256: `4388ed5adb903de1c7f91728a925f606dc5bb72b6fe7c98424efd358bf0d4ff4`.
- Original source SHA-256: `bd1be35965b6e21e920630bb10fbc449445cfeb35135031796b9e3c267117074`.
- Checked: **2026-09-28 10:38:41 UTC** (20:38:41 AEST).
- Profile: `course-work-v1`; Chromium **148.0.7778.96**.

## Recorded verification

The accepted candidate passed all **22** recorded structural/browser checks.
The profile rendered all 12 modules at desktop 1280px and mobile 390px, exercised
each quiz immediately below and at its passing boundary (including exact 3/5),
and checked reload, blank retake, keyboard selection and saved-state preservation.
All five lesson-bearing script suffixes remained byte-identical to the baseline.

The [sanitized verification record](2026-09-28-archi-evidence/verification.json)
lists every check and the selected artifact hashes. In that exported manifest,
`draft.html` identifies the exact bytes now stored as `drafts/archi-course.html`;
`screenshots/` resolves relative to the verification record. The
[catalogue hash record](2026-09-28-archi-hashes.json) binds the repository path.

Selected browser evidence:

- [Desktop module 0](2026-09-28-archi-evidence/screenshots/desktop-module-00.png).
- [Mobile module 11 and diagrams](2026-09-28-archi-evidence/screenshots/mobile-module-11.png).
- [Passing threshold](2026-09-28-archi-evidence/screenshots/quiz-threshold-pass.png).
- [Failing threshold](2026-09-28-archi-evidence/screenshots/quiz-threshold-fail.png).
- [Private hub progress preview](2026-09-28-archi-evidence/screenshots/hub-progress.png).

The hub preview reads the candidate's real browser storage. It proves draft
storage compatibility, not a change to the public hub. Reload and retake checks
are recorded in the verification result; the five selected screenshots are not
an exhaustive visual record. Raw owner, conversation, task and request metadata
is retained privately and is not included here.

## Historical learner state

The original player marked completion after any submitted attempt and did not
save quiz answers. Existing completion flags are preserved without inventing a
score or a passing attempt. Historical completion therefore cannot retrospectively
establish a passing score, and learners are not forced to discard that progress.

The storage key remains `archi-course-v1`. Other saved fields and existing attempts
are preserved. New submitted attempts live in `quiz.mN` with `picks`, `score`,
`max` and `passed`. A score of at least 60% earns completion. Failure and retake
preserve prior earned or historical completion; retake removes only that module's
saved attempt and starts with no selected answers or revealed feedback.

## Remaining review

- Independently verify ArchiMate claims, quiz answers and primary sources.
- Complete human review of the draft, including diagram styling, accessibility
  and content quality. Browser success and retained screenshots are not approval.
  The selected mobile screenshot fits the viewport, but dense diagram labels are
  small at 390px; review their legibility and zoom behaviour on a real small screen.
- Check failed-attempt feedback against the README: this candidate withholds all
  rationales until passing, whereas the README describes explaining correctly
  answered questions on a failed attempt. The bounded profile verifies that
  missed answers stay hidden; it does not require that additional feedback.
- Integrate and verify the real public hub only when publication is approved.
- Assess downloadable assets and any other release requirements not covered by
  this bounded profile.

No files in `public/`, other course sources or hosting configuration are changed.
The September 10 shared intake and hashes remain unchanged for historical review
and Istio's current catalogue references.
