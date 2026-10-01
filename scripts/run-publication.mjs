import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { siteUrl, writeRelease, verifyRelease, siteManifest, hash } from './release-site.mjs';
import { deployVerifiedRelease } from './publication-transaction.mjs';
import { requirePublicationEnabled, validatePublication } from './publication-validation.mjs';

const repository = 'ctf2009/courses';
const publicationId = process.env.PUBLICATION_ID, revision = process.env.PUBLICATION_REVISION;
if (!/^req_[A-Za-z0-9_-]{1,120}$/.test(publicationId ?? '') || !/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Invalid publication input');
// Authentication stays in the child environment, never in argv, disk or logs.
const gitRaw = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString('base64')}` } });
const git = (...args) => gitRaw(...args).trim();
const api = async (endpoint, body) => {
  const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, { method: body ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub operation failed (${response.status})`); return response.json();
};
const deploy = () => execFileSync('npx', ['--no-install', 'wrangler', 'deploy'], { stdio: 'inherit', timeout: 240000 });
const receipt = { publicationId, revision, outcome: 'failed', publicationVerified: false, rollbackVerified: false };
try {
  requirePublicationEnabled();
  const readMain = async () => (await api('git/ref/heads/main')).object.sha;
  const base = await readMain();
  git('fetch', '--no-tags', 'origin', `refs/heads/curator-publication/${publicationId}`);
  if (git('rev-parse', 'FETCH_HEAD') !== revision || git('rev-parse', `${revision}^`) !== base) throw new Error('Publication is stale or not the prepared branch');
  const manifestPath = `curation/publications/${publicationId}.json`;
  const manifest = JSON.parse(git('show', `${revision}:${manifestPath}`));
  const treePaths = new Set(git('ls-tree', '-r', '--name-only', revision).split('\n'));
  validatePublication({ manifest, publicationId, changedPaths: git('diff', '--name-only', base, revision).split('\n'),
    previousCatalogue: JSON.parse(git('show', `${base}:curation/catalogue.json`)),
    read: path => treePaths.has(path) ? gitRaw('show', `${revision}:${path}`) : null });
  const live = await fetch(`${siteUrl}/publication.json?preflight=${publicationId}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!live.ok) throw new Error('The site needs an operator-verified bootstrap release before unattended publication');
  const previous = await live.json();
  if (previous.revision !== base) throw new Error('Repository main is not the recorded live revision; synchronize the release first');
  git('checkout', '--detach', base);
  if (JSON.stringify(await siteManifest()) !== JSON.stringify(previous.files)) throw new Error('Recorded live assets differ from repository main');
  await verifyRelease(previous);
  git('checkout', '--detach', revision);
  for (const file of manifest.files) if (hash(await readFile(`public/${file.path}`)) !== file.sha256) throw new Error('Prepared publication bytes changed');
  if (manifest.sourceSha256 !== manifest.files.find(file => file.path === `${manifest.courseId}-course.html`).sha256) throw new Error('Candidate hash does not match the release');
  execFileSync('node', ['scripts/check-catalogue.mjs'], { stdio: 'inherit' });
  const release = await writeRelease(publicationId, revision);
  Object.assign(receipt, await deployVerifiedRelease({ release, previous, deploy, verify: verifyRelease, readMain,
    promote: sha => api('git/refs/heads/main', { sha, force: false }),
    restore: async () => {
      git('checkout', '--detach', base);
      if (JSON.stringify(await siteManifest()) !== JSON.stringify(previous.files)) throw new Error('Rollback source differs from the verified prior release');
      await writeFile('public/publication.json', JSON.stringify(previous, null, 2) + '\n');
      deploy();
    },
  }));
  if (receipt.publicationVerified) Object.assign(receipt, {
    courseUrl: `${siteUrl}/${manifest.courseId}-course.html`, indexUrl: `${siteUrl}/`, files: release.files });
  else process.exitCode = 1;
} catch (error) {
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(process.env.PUBLICATION_RECEIPT_PATH || 'publication-receipt.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
