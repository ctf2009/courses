import { mkdir, readdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { renderCourseDocument } from './course-document.mjs';
import { reviewCourseCandidate } from './course-candidate-browser.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 2 * 1024 * 1024;
const bindingFields = ['schemaVersion', 'requestId', 'taskId', 'zoraId', 'chatId', 'channel', 'mode', 'courseId', 'version', 'candidateSha256', 'baseSha256'];
const identical = (a, b) => bindingFields.every(field => a[field] === b[field]);
const stamp = () => new Date().toISOString();

async function directory(root, ...parts) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Course work directory must not be a symbolic link');
  }
  return current;
}
async function regularFile(filename, maximum = MAX_BYTES) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Course work input must be a bounded regular file');
  return readFile(filename);
}
async function atomicJson(filename, value) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
}
async function immutableJson(filename, value) {
  let saved;
  try { saved = JSON.parse(await regularFile(filename)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved !== undefined) {
    if (JSON.stringify(saved) !== JSON.stringify(value)) throw new Error('Immutable course work record changed');
    return;
  }
  await atomicJson(filename, value);
}
async function immutable(filename, content) {
  try { await writeFile(filename, content, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha256(await regularFile(filename)) !== sha256(content)) throw new Error('Immutable course work artifact changed');
  }
}

export function validateCourseWorkCheck(value, filename) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !bindingFields.includes(key))) throw new Error('Invalid course check envelope');
  if (value.schemaVersion !== 1 || !/^req_[A-Za-z0-9_-]{1,120}$/.test(value.requestId) || ![1, 2, 3].includes(value.version)
    || filename !== `${value.requestId}-v${value.version}.json`) throw new Error('Invalid course check identity/version');
  for (const field of ['taskId', 'zoraId', 'chatId', 'channel']) {
    if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > 200 || /[\u0000-\u001f]/.test(value[field])) throw new Error('Invalid course check origin');
  }
  if (!['create', 'revise'].includes(value.mode) || !/^[a-z][a-z0-9-]{1,63}$/.test(value.courseId)
    || !/^[a-f0-9]{64}$/.test(value.candidateSha256)) throw new Error('Invalid course check scope');
  if (value.mode === 'revise' && (value.courseId !== 'archi' || !/^[a-f0-9]{64}$/.test(value.baseSha256))) throw new Error('Revision requires a pinned Archi source');
  if (value.mode === 'create' && value.baseSha256 !== undefined) throw new Error('New course must not claim an existing base');
  return value;
}

async function boundRequest(inbox, check) {
  for (const status of ['started', 'pending', 'completed', 'failed', 'cancelled']) {
    let request;
    try { request = JSON.parse(await regularFile(path.join(inbox, 'requests', status, 'curator-courses', check.requestId + '.json'))); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!['pending', 'started'].includes(status) || request.status !== status || request.id !== check.requestId || request.domainName !== 'curator-courses'
      || request.requestType !== 'course_work' || request.origin !== 'owner-request'
      || ['zoraId', 'chatId', 'channel'].some(field => request[field] !== check[field])
      || request.payload?.taskId !== check.taskId || request.payload?.mode !== check.mode || request.payload?.courseId !== check.courseId) {
      throw new Error('Course check does not match an active admitted owner task');
    }
    return;
  }
  throw new Error('Course check has no admitted host request');
}

export async function publishCourseWorkSource(inbox, repository) {
  const root = await realpath(inbox);
  const sources = await directory(root, 'course-work', 'sources');
  const source = await regularFile(path.join(repository, 'drafts', 'archi-course.html'));
  await atomicJson(path.join(sources, 'archi.json'), { schemaVersion: 1, courseId: 'archi', sourceSha256: sha256(source), sourceHtml: source.toString('utf8'), preparedAt: stamp() });
}

async function baseline(inbox, repository, check) {
  const job = await directory(inbox, 'course-work', 'jobs', check.requestId);
  const source = await regularFile(path.join(repository, 'drafts', 'archi-course.html'));
  const manifestPath = path.join(job, 'verifier-baseline.json');
  let manifest;
  try { manifest = JSON.parse(await regularFile(manifestPath)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (sha256(source) !== check.baseSha256) throw new Error('The admitted Archi base no longer matches installed source');
    manifest = { requestId: check.requestId, taskId: check.taskId, zoraId: check.zoraId, chatId: check.chatId, channel: check.channel, sourceSha256: check.baseSha256 };
    await immutableJson(manifestPath, manifest);
  }
  if (['requestId', 'taskId', 'zoraId', 'chatId', 'channel'].some(field => manifest[field] !== check[field]) || manifest.sourceSha256 !== check.baseSha256) throw new Error('Pinned baseline origin/hash mismatch');
  const sourcePath = path.join(job, 'verifier-baseline.html');
  let retained;
  try { retained = await regularFile(sourcePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (sha256(source) !== check.baseSha256) throw new Error('Interrupted baseline cannot be recovered from changed source');
    await immutable(sourcePath, source); retained = source;
  }
  if (sha256(retained) !== check.baseSha256 || sha256(source) !== check.baseSha256) throw new Error('Pinned Archi source changed');
  return retained.toString('utf8');
}

function reportMarkdown(result) {
  return `# Candidate course review\n\nRequest: ${result.requestId}\nTask: ${result.taskId}\nCourse: ${result.courseId}\nCandidate version: ${result.version}\nChecked: ${result.checkedAt}\nOutcome: ${result.status}\nCandidate JSON SHA-256: ${result.candidateSha256}\nRendered source SHA-256: ${result.sourceSha256 ?? 'not rendered'}\n\n`
    + (result.error ? `Failure: ${result.error}\n\n` : '')
    + result.checks.map(check => `- ${check.status.toUpperCase()}: ${check.id}`).join('\n')
    + '\n\n' + result.limitations.map(limit => `- ${limit}`).join('\n')
    + '\n\nThis is a private draft and verification record, not publication or factual approval.\n';
}

async function processCheck(inbox, repository, check) {
  const candidateDirectory = await directory(inbox, 'course-work', 'jobs', check.requestId, 'candidates', String(check.version));
  const reviewPath = path.join(candidateDirectory, 'review.json');
  let saved;
  try { saved = JSON.parse(await regularFile(reviewPath)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved) {
    if (!identical(saved, check)) throw new Error('Saved candidate review origin mismatch');
    for (const artifact of saved.artifacts ?? []) {
      if (!/^[a-z0-9.-]+$/.test(artifact.name) || artifact.name === '..' || sha256(await regularFile(path.join(candidateDirectory, artifact.name))) !== artifact.sha256) throw new Error('Saved candidate evidence hash mismatch');
    }
    return saved;
  }
  await immutableJson(path.join(candidateDirectory, 'check-request.json'), check);
  let result = { ...check, profile: 'course-work-v1', checkedAt: stamp(), status: 'failed', checks: [], findings: [], artifacts: [],
    evidenceLocation: `course-work/jobs/${check.requestId}/candidates/${check.version}`,
    factualReviewPerformed: false, publicationVerified: false, browserVerified: false,
    limitations: ['Factual claims and sources have not been independently verified.', 'No learner course was edited or published.'] };
  const names = ['check-request.json'];
  try {
    await boundRequest(inbox, check);
    const bytes = await regularFile(path.join(candidateDirectory, 'candidate.json'));
    if (sha256(bytes) !== check.candidateSha256) throw new Error('Candidate JSON hash does not match admitted check');
    names.push('candidate.json');
    const candidate = JSON.parse(bytes);
    if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object'
      || Object.keys(candidate).join(',') !== (check.mode === 'create' ? 'document' : 'candidateHtml')) throw new Error('Candidate payload has unsupported fields');
    let source, original;
    if (check.mode === 'create') {
      const catalogue = JSON.parse(await regularFile(path.join(repository, 'curation', 'catalogue.json')));
      if (catalogue.courses.some(course => course.id === check.courseId)) throw new Error('New course ID already exists in the catalogue');
      source = renderCourseDocument(candidate.document, check.courseId);
    } else {
      original = await baseline(inbox, repository, check);
      if (typeof candidate.candidateHtml !== 'string' || Buffer.byteLength(candidate.candidateHtml) > MAX_BYTES) throw new Error('Candidate HTML must be bounded text');
      source = candidate.candidateHtml;
    }
    await immutable(path.join(candidateDirectory, 'draft.html'), source); names.push('draft.html');
    result.sourceSha256 = sha256(source);
    const review = await reviewCourseCandidate(source, { mode: check.mode, courseId: check.courseId, baselineHtml: original, evidenceDirectory: candidateDirectory });
    review.checks.push({ id: 'candidate-input-unchanged', status: sha256(await regularFile(path.join(candidateDirectory, 'candidate.json'))) === check.candidateSha256 ? 'passed' : 'failed', evidence: { candidateSha256: check.candidateSha256 } });
    review.checks.push({ id: 'draft-source-unchanged', status: sha256(await regularFile(path.join(candidateDirectory, 'draft.html'))) === result.sourceSha256 ? 'passed' : 'failed', evidence: { sourceSha256: result.sourceSha256 } });
    if (original) review.checks.push({ id: 'installed-source-unchanged', status: sha256(await regularFile(path.join(repository, 'drafts', 'archi-course.html'))) === check.baseSha256 ? 'passed' : 'failed', evidence: { baseSha256: check.baseSha256 } });
    result = { ...result, ...review, status: review.checks.every(item => item.status === 'passed') ? 'passed' : 'failed' };
    names.push('hub-preview.html', ...review.screenshots);
    result.findings = review.checks.filter(item => item.status !== 'passed').map(item => ({ checkId: item.id, summary: `Candidate check ${item.id} ${item.status}.` }));
  } catch (error) { result.error = String(error.message).slice(0, 600); }
  result.reportText = reportMarkdown(result);
  const reportPath = path.join(candidateDirectory, 'report.md');
  try { await regularFile(reportPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(reportPath, result.reportText, { mode: 0o600 }); names.push('report.md');
  result.artifacts = await Promise.all(names.map(async name => ({ name, sha256: sha256(await regularFile(path.join(candidateDirectory, name))) })));
  await immutableJson(reviewPath, result);
  return result;
}

export async function runCourseWorkChecks({ inbox, repository }) {
  const root = await realpath(inbox);
  const pending = await directory(root, 'course-work', 'checks', 'pending');
  const processing = await directory(root, 'course-work', 'checks', 'processing');
  const completed = await directory(root, 'course-work', 'checks', 'completed');
  const rejected = await directory(root, 'course-work', 'checks', 'rejected');
  const outcomes = [];
  for (const folder of [processing, pending]) for (const filename of (await readdir(folder)).filter(name => name.endsWith('.json')).sort()) {
    const inputPath = path.join(folder, filename);
    let check;
    try { check = validateCourseWorkCheck(JSON.parse(await regularFile(inputPath)), filename); }
    catch (error) { await rename(inputPath, path.join(rejected, filename)); outcomes.push({ outcome: 'invalid-course-check', error: error.message }); continue; }
    const claimed = path.join(processing, filename);
    if (folder === pending) await rename(inputPath, claimed);
    const result = await processCheck(root, repository, check);
    const outputPath = path.join(completed, filename);
    await immutableJson(outputPath, result);
    await rm(claimed);
    outcomes.push({ requestId: check.requestId, version: check.version, outcome: `course-work-${result.status}` });
  }
  return outcomes;
}
