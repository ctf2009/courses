import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOnce, runWatch } from './worker.mjs';
import { handleRequest } from './handler.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const domain = 'curator-courses';
async function fixture(t, changes = {}) {
  const inbox = await mkdtemp(path.join(tmpdir(), 'curator-test-'));
  t.after(() => rm(inbox, { recursive: true, force: true }));
  const request = {
    id: 'req_test', domainName: domain, requestType: 'catalogue', payload: {},
    zoraId: 'owner-test', chatId: 'chat-test', channel: 'web', priority: 'normal',
    status: 'pending', createdAt: Date.now(), startedAt: null, completedAt: null, ...changes,
  };
  const file = path.join(inbox, 'requests/pending', domain, 'req_test.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(request));
  return { inbox, repository, request, file };
}
const reportFile = f => path.join(f.inbox, 'reports/pending', domain, 'rep_curator_req_test.json');

test('file request produces an origin-bound catalogue report and completes once', async t => {
  const f = await fixture(t);
  assert.equal((await runOnce(f))[0].outcome, 'catalogue');
  const report = JSON.parse(await readFile(reportFile(f), 'utf8'));
  for (const field of ['zoraId', 'chatId', 'channel', 'domainName']) assert.equal(report[field], f.request[field]);
  assert.equal(report.requestId, f.request.id);
  assert.equal(report.payload.courses.length, 6);
  assert.deepEqual(await runOnce(f), []);
});
test('draft reviews report source freshness without claiming a new review', async () => {
  for (const courseId of ['archi', 'istio']) {
    const result = await handleRequest({ requestType: 'review_course', payload: { courseId } }, repository);
    assert.equal(result.outcome, 'recorded-review');
    assert.equal(result.freshReviewPerformed, false);
    assert.equal(result.sourceSha256, result.reviewedSha256);
  }
});
test('course with no recorded review requests review work', async () => {
  const result = await handleRequest({ requestType: 'review_course', payload: { courseId: 'llm' } }, repository);
  assert.equal(result.outcome, 'review-needed');
});
test('unknown course emits failure and retires request', async t => {
  const f = await fixture(t, { requestType: 'review_course', payload: { courseId: '../private' } });
  assert.equal((await runOnce(f))[0].outcome, 'failed');
  assert.equal(JSON.parse(await readFile(path.join(f.inbox, 'requests/failed', domain, 'req_test.json'))).status, 'failed');
});
test('invalid origin is retired without producing a deliverable report', async t => {
  const f = await fixture(t, { zoraId: '' });
  assert.equal((await runOnce(f))[0].outcome, 'invalid-request');
  await assert.rejects(readFile(reportFile(f)), { code: 'ENOENT' });
});
test('recovery after report delivery does not enqueue another report', async t => {
  const f = await fixture(t);
  await runOnce(f);
  const delivered = path.join(f.inbox, 'reports/delivered', domain);
  await mkdir(delivered, { recursive: true });
  await rename(reportFile(f), path.join(delivered, 'rep_curator_req_test.json'));
  await rename(path.join(f.inbox, 'requests/completed', domain, 'req_test.json'), path.join(f.inbox, 'requests/started', domain, 'req_test.json'));
  const started = path.join(f.inbox, 'requests/started', domain, 'req_test.json');
  await writeFile(started, JSON.stringify({ ...f.request, status: 'started' }));
  await runOnce(f);
  assert.deepEqual(await readdir(path.dirname(reportFile(f))), []);
});

test('recovery after report retention does not enqueue another report', async t => {
  const f = await fixture(t);
  await runOnce(f);
  const retained = path.join(f.inbox, 'reports/retained', domain);
  await mkdir(retained, { recursive: true });
  await rename(reportFile(f), path.join(retained, 'rep_curator_req_test.json'));
  const started = path.join(f.inbox, 'requests/started', domain, 'req_test.json');
  await writeFile(started, JSON.stringify({ ...f.request, status: 'started' }));
  await runOnce(f);
  assert.deepEqual(await readdir(path.dirname(reportFile(f))), []);
});

test('watch heartbeat proves a successful pass and is removed on shutdown', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  let sawReady = false;
  await runWatch({ ...f, signal: controller.signal, onBatch(results) {
    assert.equal(results[0].outcome, 'catalogue');
    sawReady = true;
    controller.abort();
  } });
  assert.equal(sawReady, true);
  await assert.rejects(readFile(path.join(f.inbox, 'workers/curator-courses.json')), { code: 'ENOENT' });
});

test('unreadable catalogue cannot advertise a ready worker', async t => {
  const f = await fixture(t);
  await assert.rejects(runWatch({ ...f, repository: path.join(f.inbox, 'missing') }));
  await assert.rejects(readFile(path.join(f.inbox, 'workers/curator-courses.json')), { code: 'ENOENT' });
});
test('existing worker lock refuses concurrent processing', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.inbox, '.curator-courses.lock'));
  await assert.rejects(runOnce(f), /worker locked/);
});

test('changed source makes saved review stale', async t => {
  const f = await fixture(t);
  const repo = path.join(f.inbox, 'repository');
  await mkdir(path.join(repo, 'curation'), { recursive: true });
  await writeFile(path.join(repo, 'course.html'), 'changed lesson');
  await writeFile(path.join(repo, 'review.md'), 'Historical findings');
  await writeFile(path.join(repo, 'hashes.json'), JSON.stringify([{ path: 'course.html', sha256: 'old' }]));
  await writeFile(path.join(repo, 'curation/catalogue.json'), JSON.stringify({ schemaVersion: 1, courses: [{
    id: 'course', path: 'course.html', review: 'review.md', reviewEvidence: 'hashes.json',
  }] }));
  const result = await handleRequest({ requestType: 'review_course', payload: { courseId: 'course' } }, repo);
  assert.equal(result.outcome, 'stale-review');
  assert.equal(result.freshReviewPerformed, false);
});

test('review references cannot read outside the repository', async t => {
  const f = await fixture(t);
  const repo = path.join(f.inbox, 'repository');
  await mkdir(path.join(repo, 'curation'), { recursive: true });
  await writeFile(path.join(f.inbox, 'outside.html'), 'outside');
  await writeFile(path.join(repo, 'curation/catalogue.json'), JSON.stringify({ schemaVersion: 1, courses: [{
    id: 'course', path: '../outside.html',
  }] }));
  await assert.rejects(handleRequest({ requestType: 'review_course', payload: { courseId: 'course' } }, repo), /leaves repository/);
});
