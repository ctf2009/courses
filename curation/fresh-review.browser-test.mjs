import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createFreshReview } from './fresh-review.mjs';
import { reviewArchiInBrowser, probeFreshReviewRuntime } from './archi-browser-review.mjs';
import { runOnce } from './worker.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = path.join(repository, 'drafts/archi-course.html');
const hash = value => createHash('sha256').update(value).digest('hex');
const request = { id: 'req_browser_test', domainName: 'curator-courses', requestType: 'fresh_review_course', origin: 'owner-request',
  payload: { courseId: 'archi' }, zoraId: 'owner', chatId: 'owner-dm', channel: 'test', priority: 'normal', status: 'pending', createdAt: Date.now() };
const course = { id: 'archi', path: 'drafts/archi-course.html' };
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'curator-browser-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('fresh file request executes current Archi browser checks and retains origin-bound evidence once', async t => {
  const inbox = await temporary(t);
  const pending = path.join(inbox, 'requests/pending/curator-courses/req_browser_test.json');
  await mkdir(path.dirname(pending), { recursive: true });
  await writeFile(pending, JSON.stringify(request));
  const before = hash(await readFile(sourcePath));
  const result = await runOnce({ inbox, repository });
  assert.equal(result[0].outcome, 'fresh-review');
  const report = JSON.parse(await readFile(path.join(inbox, 'reports/pending/curator-courses/rep_curator_req_browser_test.json')));
  const review = report.payload;
  assert.equal(review.sourceSha256, before);
  assert.equal(review.sourceSha256After, before);
  assert.equal(hash(await readFile(sourcePath)), before);
  assert.equal(review.freshReviewPerformed, true);
  assert.equal(review.factualReviewPerformed, false);
  assert.equal(review.publicationVerified, false);
  assert.equal(review.profile, 'archi-browser-v1');
  assert.equal(report.zoraId, request.zoraId);
  assert.equal(report.requestId, request.id);
  assert.equal(review.checks.find(check => check.id === 'runtime-dependencies').status, 'passed');
  assert.equal(review.checks.find(check => check.id === 'desktop-module-rendering').status, 'passed');
  for (const id of ['failed-attempt-does-not-complete', 'failed-attempt-persists-on-reload', 'passing-attempt-persists-on-reload', 'explicit-retake-available']) {
    assert.equal(review.checks.find(check => check.id === id).status, 'passed');
  }
  assert.equal(review.screenshots.length, 4);
  const evidence = path.join(inbox, review.evidenceLocation);
  for (const artifact of review.artifacts) assert.equal(hash(await readFile(path.join(evidence, artifact.name))), artifact.sha256);
  assert.match(review.reportText, /Factual claims were not independently checked/);
  assert.deepEqual(await runOnce({ inbox, repository }), []);
  // Replay needs no new browser or source read, but verifies retained artifacts.
  const recovered = await createFreshReview(request, path.join(inbox, 'no-repository'), course, inbox);
  assert.equal(recovered.reviewedAt, review.reviewedAt);
  await assert.rejects(createFreshReview({ ...request, chatId: 'other' }, repository, course, inbox), /origin mismatch/);
  await writeFile(path.join(evidence, 'quiz-failed.png'), 'tampered');
  await assert.rejects(createFreshReview(request, repository, course, inbox), /hash mismatch/);
  await rm(path.join(evidence, 'quiz-failed.png'));
  await assert.rejects(createFreshReview(request, repository, course, inbox), { code: 'ENOENT' });
});

test('restart uses the immutable snapshot and reports current-source drift', async t => {
  const inbox = await temporary(t);
  const repo = path.join(inbox, 'repository');
  await mkdir(path.join(repo, 'drafts'), { recursive: true });
  const source = await readFile(sourcePath);
  const directory = path.join(inbox, 'evidence/curator-courses', request.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'source.html'), source);
  const origin = { requestId: request.id, zoraId: request.zoraId, chatId: request.chatId, channel: request.channel,
    domainName: request.domainName, requestType: request.requestType, requestOrigin: request.origin, courseId: 'archi' };
  await writeFile(path.join(directory, 'snapshot.json'), JSON.stringify({ origin, startedAt: '2026-09-28T00:00:00.000Z', sourceSha256: hash(source) }));
  await writeFile(path.join(repo, course.path), '<!-- changed after snapshot -->\n' + source);
  const review = await createFreshReview(request, repo, course, inbox);
  assert.equal(review.snapshotAt, '2026-09-28T00:00:00.000Z');
  assert.equal(review.sourceSha256, hash(source));
  assert.notEqual(review.sourceSha256, review.sourceSha256After);
  assert.equal(hash(await readFile(path.join(directory, 'source.html'))), hash(source));
  assert.equal(review.checks.find(check => check.id === 'source-matches-retained-snapshot').status, 'failed');
  assert.equal(review.checks.find(check => check.id === 'source-unchanged-during-review').status, 'passed');
});

test('browser profile blocks page HTTP, websockets, workers and external resources', async t => {
  const directory = await temporary(t);
  let received = 0;
  const server = createServer((_request, response) => { received++; response.end('unexpected network'); });
  server.on('upgrade', (_request, socket) => { received++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const attempts = `<script>
    fetch('${endpoint}/fetch').catch(()=>{});
    try { new WebSocket('${endpoint.replace('http:', 'ws:')}/socket'); } catch {}
    try { new Worker('${endpoint}/worker.js'); } catch {}
    navigator.serviceWorker.register('${endpoint}/service-worker.js').catch(()=>{});
  </script><img src="${endpoint}/image"><script src="${endpoint}/external.js"></script>`;
  const html = (await readFile(sourcePath, 'utf8')).replace('</body>', attempts + '</body>');
  const result = await reviewArchiInBrowser(html, directory);
  assert.equal(received, 0);
  assert.equal(result.checks.find(check => check.id === 'runtime-dependencies').status, 'failed');
  assert.equal(result.checks.find(check => check.id === 'desktop-module-rendering').status, 'passed');
});

test('browser readiness requires a sandboxed browser that actually starts', async () => {
  const ready = await probeFreshReviewRuntime();
  assert.deepEqual(ready.reviewProfiles, ['archi-browser-v1']);
  const previous = process.env.CURATOR_CHROMIUM_EXECUTABLE;
  try {
    process.env.CURATOR_CHROMIUM_EXECUTABLE = path.join(tmpdir(), 'curator-nonexistent-chromium');
    const unavailable = await probeFreshReviewRuntime();
    assert.deepEqual(unavailable.reviewProfiles, []);
    assert.match(unavailable.freshReviewUnavailable, /could not start/);
  } finally {
    if (previous === undefined) delete process.env.CURATOR_CHROMIUM_EXECUTABLE;
    else process.env.CURATOR_CHROMIUM_EXECUTABLE = previous;
  }
});
