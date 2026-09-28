import { mkdir, readFile, writeFile, rename, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewArchiInBrowser } from './archi-browser-review.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const descriptions = {
  'failed-attempt-does-not-complete': 'An all-wrong quiz attempt marked the module complete.',
  'failed-attempt-hides-missed-answers': 'A failed attempt disclosed missed answers or their explanations.',
  'failed-attempt-persists-on-reload': 'Reload did not restore the failed answer selections and score.',
  'passing-attempt-persists-on-reload': 'Reload did not restore the passing answer selections and score.',
  'explicit-retake-available': 'No explicit quiz retake control was available.',
  'hub-navigation': 'No course-hub navigation link was found.',
  'source-matches-retained-snapshot': 'The current course differs from the immutable snapshot retained for this request.',
  'source-unchanged-during-review': 'The course source changed while browser checks were running.',
};

function assertOrigin(saved, expected) {
  if (Object.entries(expected).some(([key, value]) => saved?.[key] !== value)) throw new Error('Fresh review evidence origin mismatch');
}

async function readEvidence(directory, name) {
  if (!/^[a-z0-9.-]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid evidence filename');
  const filename = path.join(directory, name);
  if (!(await lstat(filename)).isFile()) throw new Error('Evidence must be a regular file');
  return readFile(filename);
}

async function retainSnapshot(directory, origin, currentSource) {
  let manifest;
  try { manifest = JSON.parse(await readEvidence(directory, 'snapshot.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    manifest = { origin, startedAt: new Date().toISOString(), sourceSha256: sha256(currentSource) };
    await writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  }
  assertOrigin(manifest.origin, origin);
  let source;
  try { source = await readEvidence(directory, 'source.html'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (sha256(currentSource) !== manifest.sourceSha256) throw new Error('Interrupted snapshot cannot be restored from changed course source');
    await writeFile(path.join(directory, 'source.html'), currentSource, { mode: 0o600, flag: 'wx' });
    source = currentSource;
  }
  if (sha256(source) !== manifest.sourceSha256) throw new Error('Retained source snapshot hash mismatch');
  return { source, snapshotAt: manifest.startedAt };
}

export async function createFreshReview(request, repository, course, inbox) {
  if (course.id !== 'archi') throw new Error('Fresh browser review currently supports only the Archi profile');
  if (!path.isAbsolute(inbox) || !/^req_[A-Za-z0-9_-]{1,120}$/.test(request.id)) throw new Error('Invalid fresh review evidence location');
  const directory = path.join(inbox, 'evidence', 'curator-courses', request.id);
  const origin = { requestId: request.id, zoraId: request.zoraId, chatId: request.chatId, channel: request.channel,
    domainName: request.domainName, requestType: request.requestType, requestOrigin: request.origin, courseId: course.id };
  await mkdir(directory, { recursive: true });
  const evidenceRoot = await realpath(inbox);
  const evidenceRelative = path.relative(evidenceRoot, await realpath(directory));
  if (evidenceRelative.startsWith(`..${path.sep}`) || evidenceRelative === '..' || path.isAbsolute(evidenceRelative)) throw new Error('Evidence directory leaves inbox');
  const completedFile = path.join(directory, 'review.json');
  let saved;
  try {
    saved = JSON.parse(await readEvidence(directory, 'review.json'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved) {
    assertOrigin(saved.origin, origin);
    if (saved.payload?.requestId !== request.id || !Array.isArray(saved.payload.artifacts) || !saved.payload.artifacts.length) throw new Error('Incomplete retained review evidence');
    for (const artifact of saved.payload.artifacts) {
      if (sha256(await readEvidence(directory, artifact.name)) !== artifact.sha256) throw new Error('Retained evidence hash mismatch');
    }
    return saved.payload;
  }
  const root = await realpath(repository);
  const filename = await realpath(path.resolve(root, course.path));
  const relative = path.relative(root, filename);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Course source leaves repository');
  const currentSource = await readFile(filename);
  if (currentSource.length > 2 * 1024 * 1024) throw new Error('Course source exceeds the 2 MB review limit');
  const { source, snapshotAt } = await retainSnapshot(directory, origin, currentSource);
  const result = await reviewArchiInBrowser(source.toString('utf8'), directory);
  const sourceSha256 = sha256(source);
  const sourceSha256BeforeReview = sha256(currentSource);
  const sourceSha256After = sha256(await readFile(filename));
  result.checks.push({ id: 'source-matches-retained-snapshot', status: sourceSha256 === sourceSha256BeforeReview ? 'passed' : 'failed', evidence: { sourceSha256, sourceSha256BeforeReview } });
  result.checks.push({ id: 'source-unchanged-during-review', status: sourceSha256BeforeReview === sourceSha256After ? 'passed' : 'failed', evidence: { sourceSha256BeforeReview, sourceSha256After } });
  const findings = result.checks.filter(check => check.status === 'failed').map(check => ({
    checkId: check.id, summary: descriptions[check.id] ?? `Check failed: ${check.id}`, evidence: check.evidence,
  }));
  const reviewedAt = new Date().toISOString();
  const payload = { outcome: 'fresh-review', reviewKind: 'structural-browser', requestId: request.id, course,
    reviewedAt, snapshotAt, sourceSha256, sourceSha256BeforeReview, sourceSha256After, ...result, findings,
    freshReviewPerformed: true, factualReviewPerformed: false, browserVerified: true, publicationVerified: false,
    evidenceLocation: `evidence/curator-courses/${request.id}/`,
    evidenceAccess: 'Retained in the private worker inbox; this location is not a public download URL.',
    summary: `Fresh Archi browser review completed: ${findings.length} failing checks. Factual accuracy and publication remain unverified; no course was edited or published.`,
  };
  payload.reportText = renderReport(payload);
  await writeFile(path.join(directory, 'report.md'), payload.reportText, { mode: 0o600 });
  payload.artifacts = await Promise.all(['snapshot.json', 'source.html', ...result.screenshots, 'report.md'].map(async name => ({ name, sha256: sha256(await readEvidence(directory, name)) })));
  const temporary = completedFile + '.tmp';
  await writeFile(temporary, JSON.stringify({ origin, payload }, null, 2), { mode: 0o600 });
  await rename(temporary, completedFile);
  return payload;
}

function renderReport(review) {
  return `# Fresh Archi structural and browser review\n\nReviewed: ${review.reviewedAt}\nSnapshot retained: ${review.snapshotAt}\nRequest: ${review.requestId}\nSnapshot SHA-256: ${review.sourceSha256}\nCurrent source SHA-256 after review: ${review.sourceSha256After}\nBrowser: Chromium ${review.browserVersion}\nProfile: ${review.profile}\n\n`
    + 'This review ran new browser checks against the immutable source snapshot retained for this request. Any difference from the current course is recorded as a finding. Factual claims were not independently checked. Browser checks ran; their execution does not mean the course passed. No course was edited or published.\n\n'
    + `## Findings\n\n${review.findings.length ? review.findings.map(item => `- **${item.checkId}:** ${item.summary}`).join('\n') : 'No failing checks were observed within this limited profile.'}\n\n`
    + `## Checks performed\n\n${review.checks.map(check => `- ${check.status.toUpperCase()}: ${check.id}`).join('\n')}\n\n`
    + `## Retained evidence\n\nThe private worker inbox retains source.html, review.json, report.md and ${review.screenshots.join(', ')}. This is an operator-accessible evidence location, not a public download link: ${review.evidenceLocation}\n\n`
    + `## Outstanding checks\n\n${review.outstanding.map(item => `- ${item}`).join('\n')}\n\n`
    + '## Next brief\n\n'
    + (review.findings.length ? 'Prepare a reviewed proposal for the failing checks, including quiz behaviour and hub navigation where indicated. Preserve archi-course-v1 and existing learner state. ' : 'No changes are indicated by this limited profile. ')
    + 'Keep factual content and course identity unchanged in any behaviour patch. Complete the outstanding exact 60% boundary, mobile module coverage and human screenshot review. Factual review and publication require separate work and authorization.\n';
}
