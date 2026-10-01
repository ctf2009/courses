import test from 'node:test';
import assert from 'node:assert/strict';
import { deployVerifiedRelease } from './publication-transaction.mjs';
const previous = { revision: 'old' }, release = { revision: 'new' };
function scenario(fault) {
  const events = []; let main = 'old';
  return { events, operations: { release, previous,
    readMain: async () => { events.push('read-main'); if (fault === 'uncertain' && events.includes('promote')) throw new Error('GitHub unavailable'); return main; },
    deploy: async () => { events.push('deploy'); if (fault === 'deploy') throw new Error('Deployment interrupted'); },
    verify: async item => { events.push(`verify-${item.revision}`); if ((fault === 'verify' && item === release) || fault === 'rollback') throw new Error('Hash mismatch'); return { indexVerified: true }; },
    promote: async () => { events.push('promote'); if (fault === 'promote' || fault === 'uncertain') throw new Error('Ref conflict'); main = 'new'; if (fault === 'lost-response') throw new Error('Lost response'); },
    restore: async () => { events.push('restore'); },
  } };
}
test('only records publication after live verification and main promotion', async () => {
  const f = scenario(); assert.equal((await deployVerifiedRelease(f.operations)).publicationVerified, true);
  assert.deepEqual(f.events, ['read-main', 'deploy', 'verify-new', 'promote']);
});
for (const fault of ['deploy', 'verify', 'promote']) test(`restores and verifies prior site after ${fault} failure`, async () => {
  const f = scenario(fault); const result = await deployVerifiedRelease(f.operations);
  assert.equal(result.publicationVerified, false); assert.equal(result.rollbackVerified, true);
  assert.deepEqual(f.events.slice(-2), ['restore', 'verify-old']);
});
test('rollback verification failure is explicit', async () => {
  const f = scenario('rollback'); const result = await deployVerifiedRelease(f.operations);
  assert.equal(result.rollbackVerified, false); assert.match(result.rollbackError, /Hash mismatch/);
});
test('reconciles a successful promotion with a lost response without reverting the live site', async () => {
  const f = scenario('lost-response'); const result = await deployVerifiedRelease(f.operations);
  assert.equal(result.publicationVerified, true); assert.ok(!f.events.includes('restore'));
});
test('uncertain main promotion withholds rollback and makes no success claim', async () => {
  const f = scenario('uncertain'); const result = await deployVerifiedRelease(f.operations);
  assert.equal(result.publicationVerified, false); assert.equal(result.rollbackWithheld, true); assert.ok(!f.events.includes('restore'));
});
test('stale main refuses deployment entirely', async () => {
  const f = scenario(); f.operations.readMain = async () => 'different';
  const result = await deployVerifiedRelease(f.operations); assert.match(result.error, /Main changed/); assert.deepEqual(f.events, []);
});
