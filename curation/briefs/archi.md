# Prepare Archi for catalogue review

Blocked on the courses repository and courses-default verification profile being
registered in Ralph, and the courses baseline (including this draft) being committed
and available remotely. Keep in Backlog without approved until those are ready.
This is a draft-PR job; it must not deploy the new course.

```yaml
ralph: 1
mode: ticket
repo: courses
base: main
agent: codex
objective: Prepare the imported Archi course for catalogue review, preserving lesson content and diagram styling.
acceptance:
  - Implement the README quiz contract with 60 percent pass, submit-all grading, saved attempts and explicit retakes.
  - Preserve archi-course-v1 and document migration of historical completion without losing learner state.
  - Failed attempts withhold missed answers and rationales; reload restores the recorded attempt.
  - Add hub navigation and matching progress; preserve unrestricted module navigation.
  - Retain browser evidence for passing, failing, retaking, reloading, narrow screens and diagrams.
  - Update catalogue placement and review records accurately; identify factual review still required before release.
  - Do not deploy or modify other courses, runtime credentials or publication configuration.
verify:
  profile: courses-default
limits:
  max_passes: 4
  max_minutes: 90
  retry_policy: none
pr:
  title: Prepare Archi course for catalogue review
  draft: true
```

Evidence and detailed findings: curation/reviews/2026-09-10-draft-intake.md.
Publication requires human review. A passing inventory check alone is insufficient.
