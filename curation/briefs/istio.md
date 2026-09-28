# Prepare Istio for catalogue review

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
objective: Prepare the imported Istio course for catalogue review, preserving lessons, lab controls and visual identity.
acceptance:
  - Replace manual completion and immediate answer disclosure with the README quiz contract and a 60 percent pass mark.
  - Persist submitted attempts and explicit retakes while preserving istio-course-v1, preferences and learner state.
  - Failed attempts withhold missed answers and rationales; reload restores the attempt.
  - Add hub navigation and matching progress; preserve unrestricted module navigation.
  - Retain browser evidence for passing, failing, retaking, reloading, lab controls and narrow screens.
  - Record primary-source review of version-sensitive claims including the stated Istio 1.31 baseline, with unresolved claims explicit.
  - Update catalogue placement and review records accurately; do not deploy or modify unrelated courses or publication configuration.
verify:
  profile: courses-default
limits:
  max_passes: 4
  max_minutes: 90
  retry_policy: none
pr:
  title: Prepare Istio course for catalogue review
  draft: true
```

Evidence and detailed findings: curation/reviews/2026-09-10-draft-intake.md.
Publication requires human review. A passing inventory check alone is insufficient.
