/** Coordinates a site deployment with its Git record; effects are supplied by the runner. */
export async function deployVerifiedRelease({ release, previous, deploy, verify, readMain, promote, restore }) {
  const receipt = { outcome: 'failed', publicationVerified: false, rollbackVerified: false, previousRevision: previous.revision };
  let attempted = false, promotionUncertain = false;
  try {
    if (await readMain() !== previous.revision) throw new Error('Main changed before deployment');
    attempted = true;
    await deploy();
    Object.assign(receipt, await verify(release));
    try { await promote(release.revision); }
    catch (error) {
      // A lost response may follow a successful ref update. Reconcile before restoring.
      let current;
      try { current = await readMain(); }
      catch { promotionUncertain = true; throw new Error('Main promotion is uncertain; inspect the live release and GitHub main before recovery.'); }
      if (current !== release.revision) throw error;
    }
    return { ...receipt, outcome: 'published', publicationVerified: true };
  } catch (error) {
    receipt.error = error.message;
    if (promotionUncertain) receipt.rollbackWithheld = true;
    else if (attempted) {
      try { await restore(previous); await verify(previous); receipt.rollbackVerified = true; }
      catch (rollbackError) { receipt.rollbackError = rollbackError.message; }
    }
    return receipt;
  }
}
