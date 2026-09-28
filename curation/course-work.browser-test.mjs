import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runCourseWorkChecks } from './course-work.mjs';
import { fixtureDocument } from './test-fixtures/course-document.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, mode = 'create', html) {
  const inbox = await mkdtemp(path.join(tmpdir(), 'course-work-browser-'));
  t.after(() => rm(inbox, { recursive: true, force: true }));
  const base = await readFile(path.join(repository, 'drafts/archi-course.html'), 'utf8');
  const check = { schemaVersion: 1, requestId: 'req_candidate_test', taskId: 'curator-candidate', zoraId: 'owner', chatId: 'owner-dm', channel: 'test',
    mode, courseId: mode === 'create' ? 'fixture-course' : 'archi', version: 1, ...(mode === 'revise' ? { baseSha256: hash(base) } : {}) };
  const input = JSON.stringify(mode === 'create' ? { document: fixtureDocument() } : { candidateHtml: html ?? base });
  check.candidateSha256 = hash(input);
  const directory = path.join(inbox, 'course-work/jobs', check.requestId, 'candidates/1');
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'candidate.json'), input);
  const pending = path.join(inbox, 'course-work/checks/pending'); await mkdir(pending, { recursive: true });
  const filename = check.requestId + '-v1.json'; await writeFile(path.join(pending, filename), JSON.stringify(check));
  const requests = path.join(inbox, 'requests/started/curator-courses'); await mkdir(requests, { recursive: true });
  await writeFile(path.join(requests, check.requestId + '.json'), JSON.stringify({ id: check.requestId, requestType: 'course_work', domainName: 'curator-courses',
    origin: 'owner-request', zoraId: check.zoraId, chatId: check.chatId, channel: check.channel, status: 'started',
    payload: { taskId: check.taskId, mode: check.mode, courseId: check.courseId } }));
  return { inbox, repository, directory, check, filename, pending, base };
}
const completed = f => path.join(f.inbox, 'course-work/checks/completed', f.filename);

test('structured draft passes real 60%, persistence, retake, navigation and all-module mobile checks', async t => {
  const f = await fixture(t);
  await runCourseWorkChecks(f);
  const result = JSON.parse(await readFile(completed(f)));
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.factualReviewPerformed, false);
  assert.equal(result.publicationVerified, false);
  assert.equal(result.browserVerified, true);
  assert.equal(result.checks.find(item => item.id === 'meaningful-60-percent-boundary').status, 'passed');
  assert.equal(result.artifacts.filter(item => item.name.endsWith('.png')).length, 7);
  for (const artifact of result.artifacts) assert.equal(hash(await readFile(path.join(f.directory, artifact.name))), artifact.sha256);
  // A crash between retained review and completion publication must not rerun.
  await rm(completed(f));
  const processing = path.join(f.inbox, 'course-work/checks/processing');
  await writeFile(path.join(processing, f.filename), JSON.stringify(f.check));
  await runCourseWorkChecks({ ...f, repository: path.join(f.inbox, 'repository-not-needed-for-recovery') });
  assert.equal(JSON.parse(await readFile(completed(f))).checkedAt, result.checkedAt);
  await writeFile(path.join(f.directory, 'draft.html'), 'changed');
  await writeFile(path.join(f.pending, f.filename), JSON.stringify(f.check));
  await assert.rejects(runCourseWorkChecks(f), /hash mismatch/);
});

test('current unedited Archi is a failing candidate with preserved lesson source', async t => {
  const f = await fixture(t, 'revise');
  await runCourseWorkChecks(f);
  const result = JSON.parse(await readFile(completed(f)));
  assert.equal(result.status, 'failed');
  assert.equal(result.browserVerified, true, result.error);
  assert.equal(result.checks.find(item => item.id === 'lesson-source-preserved').status, 'passed');
  assert.equal(result.checks.find(item => item.id === 'meaningful-60-percent-boundary').status, 'failed');
  assert.equal(result.checks.find(item => item.id === 'attempts-persist-after-reload').status, 'failed');
  assert.equal(hash(await readFile(path.join(repository, 'drafts/archi-course.html'))), f.check.baseSha256);
});

test('behaviour-only Archi candidate passes without modifying lessons or the original course', async t => {
  const source = await readFile(path.join(repository, 'drafts/archi-course.html'), 'utf8');
  const start = source.indexOf('MODULES.push({');
  const end = source.lastIndexOf('</script>', source.indexOf('/* ================= init'));
  // Test-only candidate: original lesson bytes and notation engine, trusted quiz
  // behaviour. This fixture is never written into the learner repository.
  const player = (await readFile(path.join(repository, 'curation/course-player.js'), 'utf8'))
    .replace('const MODULES = COURSE_DATA.modules;', '')
    .replace('const KEY = `curator-${COURSE_DATA.courseId}-v1`;', "const KEY = 'archi-course-v1';");
  const prefix = source.slice(0, source.indexOf('const MODULES = [];')).replace('<aside id="side">', '<aside id="side"><a href="/index.html">All courses</a>')
    .replace('</style>', '@media(max-width:900px){article{overflow-x:auto}td code{white-space:normal;overflow-wrap:anywhere}}</style>');
  const candidate = prefix + 'const MODULES = [];\n' + source.slice(start, end) + '</script><script>' + player + '</script></body></html>';
  const f = await fixture(t, 'revise', candidate);
  await runCourseWorkChecks(f);
  const result = JSON.parse(await readFile(completed(f)));
  assert.equal(result.status, 'passed', JSON.stringify({ error: result.error, findings: result.findings }));
  assert.equal(result.checks.find(item => item.id === 'lesson-source-preserved').status, 'passed');
  assert.equal(result.checks.find(item => item.id === 'existing-state-survives-new-attempt').status, 'passed');
  assert.equal(hash(await readFile(path.join(repository, 'drafts/archi-course.html'))), hash(source));
});

test('altered candidate hash and wrong task origin are rejected before browser execution', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'candidate.json'), '{}');
  await runCourseWorkChecks(f);
  let result = JSON.parse(await readFile(completed(f)));
  assert.match(result.error, /hash/); assert.equal(result.browserVerified, false);
  const g = await fixture(t);
  const requestPath = path.join(g.inbox, 'requests/started/curator-courses', g.check.requestId + '.json');
  const request = JSON.parse(await readFile(requestPath)); request.payload.taskId = 'other-task';
  await writeFile(requestPath, JSON.stringify(request)); await runCourseWorkChecks(g);
  result = JSON.parse(await readFile(completed(g)));
  assert.match(result.error, /active admitted owner task/); assert.equal(result.browserVerified, false);
});
