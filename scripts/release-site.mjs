import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const siteUrl = 'https://courses.chrisflaherty.au';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function siteManifest(root = 'public') {
  const files = [];
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative))) {
      const name = [relative, entry].filter(Boolean).join('/');
      if (name === 'publication.json') continue;
      const stat = await lstat(path.join(root, name));
      if (stat.isSymbolicLink()) throw new Error('Release assets cannot be symbolic links');
      if (stat.isDirectory()) await visit(name);
      else if (stat.isFile()) files.push({ path: name, sha256: hash(await readFile(path.join(root, name))) });
    }
  }
  await visit(); return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function writeRelease(publicationId, revision) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(publicationId) || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid release identity');
  const release = { schemaVersion: 1, publicationId, revision, files: await siteManifest() };
  await writeFile('public/publication.json', JSON.stringify(release, null, 2) + '\n');
  return release;
}

// Cloudflare injects this challenge script after origin HTML has been served.
// Only this known wrapper is removable; all remaining source bytes must match.
export function originHtml(html) {
  return html.replace(/<script>\(function\(\)\{function c\(\)\{var b=a\.contentDocument[\s\S]*?<\/script>/g, script =>
    script.includes('/cdn-cgi/challenge-platform/scripts/jsd/main.js') && script.endsWith('}}}})();</script>') ? '' : script);
}

export async function verifySiteAssets(release, fetcher = fetch) {
  if (release?.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{1,160}$/.test(release.publicationId ?? '')
    || !/^[a-f0-9]{40}$/.test(release.revision ?? '') || !Array.isArray(release.files) || !release.files.length
    || release.files.length > 1000 || new Set(release.files.map(file => file.path)).size !== release.files.length) throw new Error('Invalid release manifest');
  for (const asset of release.files) {
    if (typeof asset.path !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(asset.path)
      || asset.path.split('/').some(part => !part || part === '..' || part === '.') || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) throw new Error('Unsafe release asset path or hash');
    const response = await fetcher(`${siteUrl}/${asset.path}?release=${encodeURIComponent(release.publicationId)}`, { redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Live asset failed: ${asset.path} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = hash(asset.path.endsWith('.html') ? originHtml(bytes.toString('utf8')) : bytes);
    if (actual !== asset.sha256) throw new Error(`Live asset hash mismatch: ${asset.path}`);
  }
  const root = await fetcher(`${siteUrl}/?release=${release.publicationId}`, { redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!root.ok || hash(originHtml(await root.text())) !== release.files.find(file => file.path === 'index.html')?.sha256) throw new Error('Live main index does not match the release');
  return { verifiedAssets: release.files.length, indexVerified: true };
}

export async function verifyRelease(release, fetcher = fetch) {
  const result = await verifySiteAssets(release, fetcher);
  const marker = await fetcher(`${siteUrl}/publication.json?release=${release.publicationId}`, { redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!marker.ok || JSON.stringify(await marker.json()) !== JSON.stringify(release)) throw new Error('Live publication marker does not match the release');
  return result;
}
