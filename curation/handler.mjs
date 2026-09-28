import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createFreshReview } from './fresh-review.mjs';

export async function handleRequest(request, repository, { inbox } = {}) {
  const root = await realpath(repository);
  async function read(relative) {
    const filename = await realpath(path.resolve(root, relative));
    const local = path.relative(root, filename);
    if (local.startsWith(`..${path.sep}`) || local === '..' || path.isAbsolute(local)) {
      throw new Error('Catalogue reference leaves repository');
    }
    return readFile(filename, 'utf8');
  }
  const catalogue = JSON.parse(await read('curation/catalogue.json'));
  if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.courses)) throw new Error('Invalid catalogue');
  if (request.requestType === 'catalogue') {
    return {
      outcome: 'catalogue', courses: catalogue.courses, publicationVerified: false,
      summary: `Curator returned ${catalogue.courses.length} catalogue entries. Placement is recorded inventory, not a verified live deployment.`,
    };
  }
  if (!['review_course', 'fresh_review_course'].includes(request.requestType)) throw new Error('Unsupported Curator request type');
  const course = catalogue.courses.find(item => item.id === request.payload?.courseId);
  if (!course) throw new Error('Unknown course ID');
  if (request.requestType === 'fresh_review_course') {
    if (request.origin !== 'owner-request') throw new Error('Fresh review requires an authenticated owner request');
    return createFreshReview(request, root, course, inbox);
  }
  const html = await read(course.path);
  const sourceSha256 = createHash('sha256').update(html).digest('hex');
  if (!course.review) {
    return { outcome: 'review-needed', course, sourceSha256, freshReviewPerformed: false,
      summary: `${course.title ?? course.id} has no saved review. A fresh factual and browser review is still needed. No course was edited or published.`,
    };
  }
  const review = await read(course.review);
  let reviewedSha256 = null;
  if (course.reviewEvidence) {
    const hashes = JSON.parse((await read(course.reviewEvidence)).replace(/^\uFEFF/, ''));
    reviewedSha256 = hashes.find(item => item.path === course.path)?.sha256 ?? null;
  }
  return {
    outcome: reviewedSha256 === sourceSha256 ? 'recorded-review' : 'stale-review',
    course, sourceSha256, reviewedSha256, review,
    freshReviewPerformed: false, browserVerified: false, publicationVerified: false,
    summary: `${course.title ?? course.id}: the saved review ${reviewedSha256 === sourceSha256 ? 'matches' : 'does not match'} the current source hash. This was a saved-evidence check, not a fresh factual or browser review. No course was edited or published.`,
  };
}
