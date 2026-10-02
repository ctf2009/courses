/** Test deployment credentials using the exact existing public content. */
export async function bootstrapRelease({ revision, readMain, prepare, verifyAssets, deploy, verify }) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('An exact main revision is required');
  if (await readMain() !== revision) throw new Error('Main changed before baseline preparation');
  const release = await prepare('bootstrap', revision);
  // First activation has no marker; compare every public byte and the root URL.
  await verifyAssets(release);
  if (await readMain() !== revision) throw new Error('Main changed before baseline deployment');
  await deploy();
  const evidence = await verify(release);
  if (await readMain() !== revision) throw new Error('Main changed during baseline deployment; reconcile before enabling publication');
  return { outcome: 'verified', revision, publicationId: release.publicationId, ...evidence };
}
