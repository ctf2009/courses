import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, originHtml, verifyRelease } from './release-site.mjs';

const html = '<html><body>Course index</body></html>';
const release = { schemaVersion: 1, publicationId: 'req_release', revision: 'a'.repeat(40), files: [{ path: 'index.html', sha256: hash(html) }] };
const fetcher = async url => url.includes('/publication.json') ? Response.json(release) : new Response(html);
test('verifies asset bytes, the main URL and the exact publication marker', async () => {
  assert.deepEqual(await verifyRelease(release, fetcher), { verifiedAssets: 1, indexVerified: true });
  await assert.rejects(verifyRelease(release, async () => new Response('wrong')), /hash mismatch/);
  await assert.rejects(verifyRelease(release, async url => url.includes('/publication.json') ? Response.json({ ...release, revision: 'b'.repeat(40) }) : new Response(html)), /marker/);
});
test('refuses unsafe or incomplete manifests before fetching', async () => {
  for (const files of [[], [{ path: '../secret', sha256: hash(html) }], [{ path: '//elsewhere', sha256: hash(html) }], [...release.files, ...release.files]]) {
    await assert.rejects(verifyRelease({ ...release, files }, () => { throw new Error('Must not fetch'); }), /Invalid|Unsafe/);
  }
});
test('normalizes only the known Cloudflare wrapper, preserving ordinary script bytes', () => {
  const injected = "<script>(function(){function c(){var b=a.contentDocument;'/cdn-cgi/challenge-platform/scripts/jsd/main.js';}}}})();</script>";
  assert.equal(originHtml(html + injected), html);
  assert.equal(originHtml(html + '<script>somethingElse()</script>'), html + '<script>somethingElse()</script>');
  assert.equal(originHtml(html + injected.replace('/cdn-cgi/', '/different/')), html + injected.replace('/cdn-cgi/', '/different/'));
});
