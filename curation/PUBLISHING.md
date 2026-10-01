# Publishing a course

A publication is one release containing the exact reviewed course, its main index card, saved-progress display, catalogue entry and review record. Repository scripts own this assembly. Curator never chooses a shell command or deployment target from model output.

`scripts/publication.mjs` prepares the files without changing GitHub or the live site. Existing browser progress keys must be preserved. New cards support array and map completion records without writing learner storage. Courses with existing unmanaged index cards require an explicit repository adapter before their first managed update.

Zora can prepare a release after the latest retained candidate passes its browser checks and has a completed or partial factual research report. Preparation records the reviewed findings and limitations; neither factual research completion nor publication certifies every claim. Publishing requires a direct, authenticated owner instruction for that prepared release. Authoring and overnight grants do not authorize it.

## Release path

1. Curator reads the immutable candidate and the repository's current main revision. It runs that pinned revision's trusted publication builder and retains a plan with file hashes, metadata, base revision and owner conversation.
2. On owner-authorized publication, Curator creates `curator-publication/<publication-id>` and dispatches `publication.yml` from main with the exact commit. It records dispatch intent first; ambiguous responses are never automatically retried.
3. Actions checks the prepared branch, permitted paths, source hashes, catalogue and current live baseline. Only course, index, catalogue and review files may differ. The workflow and deployment scripts must remain unchanged.
4. Wrangler deploys the complete site to `courses-chrisflaherty`. The workflow verifies every public file, the root index URL and the publication marker. It then advances main without force and retains a receipt.
5. Curator reports published URLs only after Actions succeeds and the live marker matches the prepared commit.

The workflow is manual-dispatch only: a repository push never publishes a course. Production jobs are serialized. Do not manually deploy or update main during a publication.

## One-time activation

The existing local Wrangler OAuth login is suitable for operator use, not a shared unattended CI secret. Configure the courses repository with:

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare token for the existing courses Worker deployment, including Workers Scripts and Workers KV write access and the account/zone access required by its custom-domain route. This repository currently uses Workers Sites.
- Variable `CLOUDFLARE_ACCOUNT_ID`: `e219ecbec12d7d86738a8b257c82ef6f`.
- Variable `CURATOR_PUBLICATION_ENABLED`: leave `false` until the baseline and credentials have been verified; then set `true`.
- Curator's GitHub token: access to this repository with Contents read/write, Actions read/write (workflow dispatch and monitoring), and Variables read (readiness). It does not need the Cloudflare token or repository-secret access.

The first live baseline must be deployed from the exact tooling main commit, retaining the same four existing public courses. In a clean checkout of that commit, run `npm ci`, run the repository checks, generate a marker with:

```sh
node --input-type=module -e 'import {writeRelease} from "./scripts/release-site.mjs"; import {execFileSync} from "node:child_process"; await writeRelease("bootstrap",execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim())'
npx wrangler deploy
node --input-type=module -e 'import {verifyRelease} from "./scripts/release-site.mjs"; import {readFile} from "node:fs/promises"; console.log(await verifyRelease(JSON.parse(await readFile("public/publication.json","utf8"))))'
```

Only enable publication after verification succeeds and main matches the marker. Do not add draft courses during bootstrap. The generated marker is ignored by Git to avoid a commit-hash cycle. After any later infrastructure change to main, perform the same synchronized baseline deployment before publishing another course.

Cloudflare setup reference: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

## Failure recovery

Deploy or verification failures trigger redeployment of the complete previous Git snapshot and its marker, followed by live hash verification. This restores the previous Workers Sites assets instead of relying on old KV keys surviving a deployment. A failed restoration is reported separately; never claim rollback succeeded without the receipt's `rollbackVerified: true`.

If GitHub's main update has an ambiguous response, the runner reads main again. A confirmed successful update completes the release. If main cannot be read, rollback is withheld to avoid reverting a site whose Git record may already have advanced; inspect both before recovering. Operator cancellation or runner loss can also interrupt recovery. Use the retained workflow receipt, prepared branch, live marker and GitHub main to reconcile before retrying. A stale plan must be prepared again with a new preparation key.

The receipt is retained as an Actions artifact for 90 days. This version provides automatic failure recovery, not a conversational tool for rolling back an already successful release.

## Checks

`node --test scripts/*.test.mjs` covers assembly, saved-progress reads, live verification and failure recovery. `node --test scripts/*.browser-test.mjs` covers six-card mobile/desktop layout, navigation and saved progress. Set `CURATOR_CHROMIUM_EXECUTABLE` to a system Chromium when necessary. CI installs Chromium with its sandbox enabled. `node scripts/check-catalogue.mjs` checks repository consistency.

Actions are pinned to verified upstream release commits with version comments; Dependabot checks their GitHub Actions updates weekly.
