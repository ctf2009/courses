import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { bootstrapRelease } from './bootstrap-release.mjs';
import { writeRelease, verifySiteAssets, verifyRelease } from './release-site.mjs';

const revision = process.env.BASELINE_REVISION;
let receipt = { outcome: 'failed', revision };
try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== revision || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Baseline requires a clean checkout of the expected revision');
  const readMain = async () => {
    const response = await fetch('https://api.github.com/repos/ctf2009/courses/git/ref/heads/main', {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Cannot verify repository main (${response.status})`);
    return (await response.json()).object.sha;
  };
  receipt = await bootstrapRelease({ revision, readMain, prepare: writeRelease, verifyAssets: verifySiteAssets, verify: verifyRelease,
    deploy: () => execFileSync('npx', ['--no-install', 'wrangler', 'deploy'], { stdio: 'inherit', timeout: 240000 }),
  });
} catch (error) {
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(process.env.PUBLICATION_RECEIPT_PATH || 'publication-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
