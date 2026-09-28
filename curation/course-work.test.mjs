import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderCourseDocument, validateCourseDocument } from './course-document.mjs';
import { publishCourseWorkSource, runCourseWorkChecks, validateCourseWorkCheck } from './course-work.mjs';
import { runOnce } from './worker.mjs';
import { fixtureDocument } from './test-fixtures/course-document.mjs';
import { compareLessonSource } from './course-candidate-browser.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const check = { schemaVersion: 1, requestId: 'req_contract', taskId: 'curator-fixture', zoraId: 'owner', chatId: 'owner-dm', channel: 'test',
  mode: 'create', courseId: 'fixture-course', version: 1, candidateSha256: 'a'.repeat(64) };
async function temporary(t) { const inbox = await mkdtemp(path.join(tmpdir(), 'course-contract-')); t.after(() => rm(inbox, { recursive: true, force: true })); return inbox; }

test('trusted document rejects executable/unknown fields and escapes model content', () => {
  const document = fixtureDocument();
  document.title = '<script>alert("fixture")</script>';
  document.modules[0].sections[0].paragraphs.push('<img src=x onerror=alert(1)>');
  const html = renderCourseDocument(document, 'fixture-course');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.throws(() => validateCourseDocument({ ...document, javascript: 'execute()' }), /Invalid document/);
  assert.throws(() => validateCourseDocument({ ...document, sources: [{ title: 'bad', url: 'javascript:alert(1)' }] }), /HTTPS/);
  document.modules[0].quiz.pop();
  assert.throws(() => validateCourseDocument(document), /quiz questions count/);
});

test('check envelope refuses paths, unexpected fields and out-of-range versions', () => {
  assert.deepEqual(validateCourseWorkCheck(check, 'req_contract-v1.json'), check);
  for (const changed of [{ ...check, version: 4 }, { ...check, requestId: '../outside' }, { ...check, sourcePath: '/private' },
    { ...check, candidateSha256: 'wrong' }, { ...check, mode: 'revise', courseId: 'istio' }, { ...check, taskId: '' }]) {
    assert.throws(() => validateCourseWorkCheck(changed, 'req_contract-v1.json'));
  }
});

test('Archi preservation covers every lesson script while allowing separate engine changes', async () => {
  const source = await readFile(path.join(repository, 'drafts/archi-course.html'), 'utf8');
  const unchanged = compareLessonSource(source, source);
  assert.equal(unchanged.passed, true);
  assert.equal(unchanged.evidence.baselineBlocks, 5);
  const finalModule = source.lastIndexOf('MODULES.push({');
  assert.equal(compareLessonSource(source.slice(0, finalModule) + source.slice(finalModule).replace('title:', "title: /* changed final lesson */"), source).passed, false);
  const firstBoundary = source.indexOf('</script>', source.indexOf('MODULES.push({'));
  assert.equal(compareLessonSource(source.slice(0, firstBoundary + 9) + '<script>MODULES.push({title:"extra"});</script>' + source.slice(firstBoundary + 9), source).passed, false);
  assert.equal(compareLessonSource(source.replace('const KEY =', 'const KEY /* engine-only change */ ='), source).passed, true);
});

test('fixed source API publishes the current Archi hash and source without modifying it', async t => {
  const inbox = await temporary(t);
  const before = await readFile(path.join(repository, 'drafts/archi-course.html'));
  await publishCourseWorkSource(inbox, repository);
  const source = JSON.parse(await readFile(path.join(inbox, 'course-work/sources/archi.json')));
  assert.equal(source.sourceSha256, hash(before));
  assert.equal(source.sourceHtml, before.toString('utf8'));
  assert.equal(hash(await readFile(path.join(repository, 'drafts/archi-course.html'))), hash(before));
});

test('external worker leaves host-owned course_work requests active', async t => {
  const inbox = await temporary(t);
  const folder = path.join(inbox, 'requests/pending/curator-courses'); await mkdir(folder, { recursive: true });
  const request = { id: check.requestId, domainName: 'curator-courses', requestType: 'course_work', origin: 'owner-request',
    zoraId: check.zoraId, chatId: check.chatId, channel: check.channel, priority: 'normal', status: 'pending',
    payload: { taskId: check.taskId, courseId: check.courseId, mode: check.mode } };
  await writeFile(path.join(folder, check.requestId + '.json'), JSON.stringify(request));
  assert.deepEqual(await runOnce({ inbox, repository }), []);
  assert.equal(JSON.parse(await readFile(path.join(folder, check.requestId + '.json'))).status, 'pending');
});

test('unbound candidate fails without a browser or draft and records the reason', async t => {
  const inbox = await temporary(t);
  const pending = path.join(inbox, 'course-work/checks/pending'); await mkdir(pending, { recursive: true });
  await writeFile(path.join(pending, 'req_contract-v1.json'), JSON.stringify(check));
  assert.equal((await runCourseWorkChecks({ inbox, repository }))[0].outcome, 'course-work-failed');
  const result = JSON.parse(await readFile(path.join(inbox, 'course-work/checks/completed/req_contract-v1.json')));
  assert.equal(result.browserVerified, false);
  assert.match(result.error, /no admitted host request/);
  await assert.rejects(readFile(path.join(inbox, 'course-work/jobs/req_contract/candidates/1/draft.html')), { code: 'ENOENT' });
});
