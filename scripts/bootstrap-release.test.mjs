import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapRelease } from './bootstrap-release.mjs';

const revision = 'a'.repeat(40);
function fixture(overrides = {}) {
  const calls = [];
  return { calls, effects: { revision,
    readMain: async () => revision,
    prepare: async (publicationId, revision) => ({ publicationId, revision }),
    verifyAssets: async () => calls.push('preflight'),
    deploy: async () => calls.push('deploy'),
    verify: async () => { calls.push('verify'); return { verifiedAssets: 5, indexVerified: true }; },
    ...overrides,
  } };
}
test('baseline test compares existing content before deployment and verifies the release afterward', async () => {
  const { calls, effects } = fixture();
  assert.deepEqual(await bootstrapRelease(effects), { outcome: 'verified', revision, publicationId: 'bootstrap', verifiedAssets: 5, indexVerified: true });
  assert.deepEqual(calls, ['preflight', 'deploy', 'verify']);
});
test('content mismatch and main drift prevent deployment', async () => {
  const mismatch = fixture({ verifyAssets: async () => { throw new Error('Live asset hash mismatch'); } });
  await assert.rejects(bootstrapRelease(mismatch.effects), /hash mismatch/);
  assert.deepEqual(mismatch.calls, []);
  for (const changeAt of [1, 2]) {
    let reads = 0;
    const drift = fixture({ readMain: async () => ++reads === changeAt ? 'b'.repeat(40) : revision });
    await assert.rejects(bootstrapRelease(drift.effects), /Main changed/);
    assert.ok(!drift.calls.includes('deploy'));
  }
});
test('deployment or live verification failure cannot produce a successful receipt', async () => {
  for (const stage of ['deploy', 'verify']) {
    const { effects } = fixture({ [stage]: async () => { throw new Error(`${stage} failed`); } });
    await assert.rejects(bootstrapRelease(effects), new RegExp(`${stage} failed`));
  }
  let reads = 0;
  const drift = fixture({ readMain: async () => ++reads === 3 ? 'b'.repeat(40) : revision });
  await assert.rejects(bootstrapRelease(drift.effects), /reconcile/);
});
