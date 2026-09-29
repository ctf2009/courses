# Course catalogue and review records

This directory holds the course catalogue, authoring briefs, recorded reviews and
the durable course-work contract. Learner pages stay in `public/`; imported drafts
stay in `drafts/` until deliberately published. Validate catalogue integrity with
`npm run curate:check`.

Curator's runtime has moved to the separate
[zora-domain-curator repository](https://github.com/ITF-Solutions/zora-domain-curator).
That package owns the authoring contract, renderer, browser checks, inbox worker,
discovery readiness and immutable draft reader. This website does not install or
run it and does not need private package credentials to build or publish.

Operators install `@itf-solutions/zora-domain-curator` separately through Zora's
plugin installer. The worker requires an absolute `CURATOR_COURSES_DIR` pointing
at a read-only checkout of this repository and `DOMAIN_INBOX_DIR` pointing at its
shared durable inbox. Worker deployment and test instructions live in its own repo.

The extraction preserves the `curator-courses` domain identity, existing request
IDs, `course-work-v1` jobs and saved candidate hashes. It does not regenerate
drafts, grant new authoring permissions or publish any learner content. Saved
candidate paths are private worker artifacts, not website URLs.
