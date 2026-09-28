import { mkdir, readdir, readFile, writeFile, rename, rm, lstat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { handleRequest } from './handler.mjs';
import { probeFreshReviewRuntime } from './archi-browser-review.mjs';

const domain = 'curator-courses';
const safeId = /^[A-Za-z0-9_-]+$/;
const exists = async filename => access(filename).then(() => true, () => false);

async function writeAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, filename);
}

function validate(request, filename) {
  if (typeof request.id !== 'string' || !safeId.test(request.id) || filename !== `${request.id}.json` || request.domainName !== domain) {
    throw new Error('Invalid request identity');
  }
  for (const field of ['zoraId', 'chatId', 'channel']) {
    if (typeof request[field] !== 'string' || !request[field].trim()) throw new Error(`Missing ${field}`);
  }
  if (!['low', 'normal', 'high'].includes(request.priority)) throw new Error('Invalid priority');
  if (!['pending', 'started'].includes(request.status)) throw new Error('Invalid request status');
}

async function acquireLock(lock, recoverDeadOwner) {
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!recoverDeadOwner) throw new Error('Curator worker locked; check for a running worker before clearing a stale lock');
    const stat = await lstat(lock);
    if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Curator lock ownership cannot be verified');
    let owner;
    try { owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')); }
    catch { throw new Error('Curator lock has no verifiable owner; manual recovery required'); }
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Curator lock has no verifiable owner; manual recovery required');
    try { process.kill(owner.pid, 0); }
    catch (probeError) {
      if (probeError.code !== 'ESRCH') throw new Error('Curator lock owner cannot be checked');
      // This path is enabled only beneath the systemd unit's exclusive kernel flock.
      await rm(lock, { recursive: true });
      await mkdir(lock);
      await writeAtomic(path.join(lock, 'owner.json'), { pid: process.pid });
      return;
    }
    throw new Error('Curator worker locked by a live process; refusing recovery');
  }
  await writeAtomic(path.join(lock, 'owner.json'), { pid: process.pid });
}

export async function runOnce({ inbox, repository, recoverDeadOwner = false }) {
  if (!path.isAbsolute(inbox)) throw new Error('Inbox must be an explicit absolute path');
  await mkdir(inbox, { recursive: true });
  const lock = path.join(inbox, '.curator-courses.lock');
  await acquireLock(lock, recoverDeadOwner);
  const results = [];
  try {
    // Recover claimed read-only requests before accepting new ones.
    for (const status of ['started', 'pending']) {
      const folder = path.join(inbox, 'requests', status, domain);
      await mkdir(folder, { recursive: true });
      for (const filename of (await readdir(folder)).filter(name => name.endsWith('.json')).sort()) {
        const source = path.join(folder, filename);
        if (!(await lstat(source)).isFile()) throw new Error('Request must be a regular file');
        let request;
        try {
          request = JSON.parse(await readFile(source, 'utf8'));
          validate(request, filename);
        } catch (error) {
          const failed = path.join(inbox, 'requests', 'failed', domain);
          await mkdir(failed, { recursive: true });
          await rename(source, path.join(failed, filename));
          results.push({ file: filename, outcome: 'invalid-request', error: error.message });
          continue;
        }
        const reportId = `rep_curator_${request.id}`;
        let report;
        for (const state of ['pending', 'delivered', 'rejected', 'retained']) {
          const reportFile = path.join(inbox, 'reports', state, domain, `${reportId}.json`);
          if (await exists(reportFile)) {
            report = JSON.parse(await readFile(reportFile, 'utf8'));
            for (const field of ['zoraId', 'chatId', 'channel', 'domainName']) {
              if (report[field] !== request[field]) throw new Error('Existing report origin mismatch');
            }
            if (report.requestId !== request.id) throw new Error('Existing report request mismatch');
            break;
          }
        }
        const started = path.join(inbox, 'requests', 'started', domain, filename);
        if (source !== started) await rename(source, started);
        if (!report) {
          request = { ...request, status: 'started', startedAt: request.startedAt ?? Date.now() };
          await writeAtomic(started, request);
          let payload;
          try { payload = await handleRequest(request, repository, { inbox }); }
          catch (error) { payload = { outcome: 'failed', error: error.message, summary: 'Curator could not complete this request. No course was edited or published.' }; }
          report = {
            id: reportId, requestId: request.id, domainName: domain,
            zoraId: request.zoraId, chatId: request.chatId, channel: request.channel,
            reportType: request.requestType === 'catalogue' ? 'course_catalogue' : 'course_review', payload, priority: request.priority,
            status: 'pending', createdAt: Date.now(), deliveredAt: null,
          };
          await writeAtomic(path.join(inbox, 'reports', 'pending', domain, `${reportId}.json`), report);
        }
        const terminal = report.payload.outcome === 'failed' ? 'failed' : 'completed';
        await writeAtomic(path.join(inbox, 'requests', terminal, domain, filename), {
          ...request, status: terminal, completedAt: Date.now(),
        });
        await rm(started);
        results.push({ requestId: request.id, reportId, outcome: report.payload.outcome });
      }
    }
    return results;
  } finally { await rm(lock, { recursive: true }); }
}

export async function runWatch({ inbox, repository, signal, intervalMs = 15_000, recoverDeadOwner = false, onBatch = () => {} }) {
  if (!path.isAbsolute(inbox)) throw new Error('Inbox must be an explicit absolute path');
  const heartbeatFile = path.join(inbox, 'workers', 'curator-courses.json');
  const freshReviewRuntime = await probeFreshReviewRuntime();
  try {
    while (!signal?.aborted) {
      // A heartbeat is evidence of a successful worker pass and readable catalogue.
      await handleRequest({ requestType: 'catalogue', payload: {} }, repository);
      const results = await runOnce({ inbox, repository, recoverDeadOwner });
      await writeAtomic(heartbeatFile, {
        domainName: domain, ready: true, pid: process.pid, checkedAt: Date.now(), version: '1.2.0', ...freshReviewRuntime,
      });
      onBatch(results);
      try { await wait(intervalMs, undefined, { signal }); }
      catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  } finally {
    const heartbeat = await readFile(heartbeatFile, 'utf8').then(JSON.parse, () => null);
    if (heartbeat?.pid === process.pid) await rm(heartbeatFile, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inbox = process.env.DOMAIN_INBOX_DIR;
  if (!inbox) throw new Error('Set DOMAIN_INBOX_DIR explicitly; no default inbox is used');
  const options = { inbox, repository: fileURLToPath(new URL('../', import.meta.url)) };
  if (process.argv.includes('--watch')) {
    const controller = new AbortController();
    for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort());
    await runWatch({ ...options, recoverDeadOwner: process.argv.includes('--recover-stale-lock'), signal: controller.signal, onBatch(results) {
      if (results.length) console.log(JSON.stringify(results));
    } });
  } else console.log(JSON.stringify(await runOnce(options), null, 2));
}
