# Draft intake — 2026-09-10

Scope: static inspection of the imported Archi and Istio HTML files. No browser
verification or external factual validation was performed. Both remain drafts.
File hashes are recorded in `2026-09-10-draft-hashes.json` alongside this review.

## Archi: 12 modules

- `wireQuiz` unconditionally sets `st.done['m'+mi] = true` after submission,
  regardless of score. `quizHTML` explicitly says any attempt marks completion.
- Submission reveals every correct option and rationale, including failed attempts.
- The selected answers and score are not persisted by `wireQuiz`; only completion
  is written. There is no explicit retake action in that quiz renderer.

Brief: adapt the quiz to the repository completion contract while preserving
`archi-course-v1` and existing learner state. Add hub/back navigation and progress
integration. Preserve the lesson content and diagram styling during this change.
Separately review ArchiMate claims and their sources before publication.

## Istio: 13 modules, including Orientation and Atlas

- The `doneBtn` click handler toggles `S.done` independently of quiz results.
- Clicking an answer immediately exposes the correct option and explanation.
- The saved state contains completion, lab/theme preferences and last module;
  quiz choices and scores are not saved by the answer handler.

Brief: implement submit-all grading, earned completion, persisted attempts and
explicit retakes, retaining `istio-course-v1`, lab/theme preferences and navigation.
Add hub/back navigation and progress integration. Review the course's stated Istio
1.31 baseline and version-sensitive recommendations against primary sources before
release; this intake has not confirmed those claims.

## Acceptance for each implementation

1. A below-60% attempt cannot newly complete a module or expose missed answers.
2. A passing attempt completes the module and reveals feedback.
3. Reload restores the attempt and corresponding feedback; an explicit retake
   presents a blank answer sheet. Document how historical completion is preserved.
4. Navigation is unrestricted; hub progress matches course progress.
5. Browser evidence covers pass/fail/retake/reload, narrow screens and diagrams.
6. Course content changes are separately identified for factual review.

Publication classification: new course, human review required under the existing
Curate design. No job submitted, course changed or publication performed by intake.
