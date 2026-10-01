import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function requirePublicationEnabled(env = process.env) {
  if (env.CURATOR_PUBLICATION_ENABLED !== 'true') throw new Error('Course publication is disabled');
}

/** Validate all prepared repository bytes before any live-site mutation. */
export function validatePublication({ manifest, publicationId, changedPaths, read, previousCatalogue }) {
  if (manifest.schemaVersion !== 2 || manifest.publicationId !== publicationId
    || !/^[a-z][a-z0-9-]{1,63}$/.test(manifest.courseId)) throw new Error('Publication manifest mismatch');
  const { courseId } = manifest;
  const coursePath = `public/${courseId}-course.html`, reviewPath = `curation/publications/${publicationId}.md`;
  const manifestPath = `curation/publications/${publicationId}.json`;
  const expected = [coursePath, 'public/index.html', 'curation/catalogue.json', reviewPath];
  const previous = previousCatalogue.courses.find(course => course.id === courseId);
  const deleted = previous?.placement === 'draft' ? `drafts/${courseId}-course.html` : null;
  if (deleted && previous.path !== deleted) throw new Error('Unexpected prior draft path');
  const changes = manifest.repositoryChanges;
  const paths = [...expected, ...(deleted ? [deleted] : [])];
  if (!Array.isArray(changes) || changes.length !== paths.length || new Set(changes.map(file => file.path)).size !== paths.length
    || changes.some(file => !paths.includes(file.path))) throw new Error('Incomplete release repository manifest');
  for (const file of changes) {
    const bytes = read(file.path);
    if (file.path === deleted) {
      if (file.sha256 !== null || bytes !== null) throw new Error('Draft promotion did not remove the old draft');
    } else if (!/^[a-f0-9]{64}$/.test(file.sha256) || bytes === null || sha(bytes) !== file.sha256) throw new Error(`Release bytes differ: ${file.path}`);
  }
  if (changedPaths.some(path => ![...paths, manifestPath].includes(path))
    || ['curation/catalogue.json', reviewPath, manifestPath, ...(deleted ? [deleted] : [])].some(path => !changedPaths.includes(path))) throw new Error('Publication diff is incomplete or outside its release');
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2 || new Set(manifest.files.map(file => file.path)).size !== 2
    || manifest.files.some(file => ![`${courseId}-course.html`, 'index.html'].includes(file.path)
      || file.sha256 !== changes.find(change => change.path === `public/${file.path}`)?.sha256)) throw new Error('Invalid publication assets');
  const catalogue = JSON.parse(read('curation/catalogue.json'));
  const entries = catalogue.courses.filter(course => course.id === courseId);
  const entry = entries[0];
  if (entries.length !== 1 || entry.path !== coursePath || entry.placement !== 'served' || entry.reviewStatus !== 'reviewed'
    || entry.review !== reviewPath || entry.publicationId !== publicationId || entry.sourceSha256 !== manifest.sourceSha256
    || entry.progressKey !== manifest.progressKey || entry.modules !== manifest.modules || entry.completion !== manifest.completion
    || manifest.sourceSha256 !== changes.find(file => file.path === coursePath).sha256
    || (previous && previous.progressKey !== entry.progressKey)) throw new Error('Catalogue does not describe this publication');
  if (JSON.stringify(catalogue.courses.filter(course => course.id !== courseId)) !== JSON.stringify(previousCatalogue.courses.filter(course => course.id !== courseId))) throw new Error('Publication changed another course');
  const review = String(read(reviewPath));
  if (!review.includes(`\nPublication: ${publicationId}\nCandidate SHA-256: ${manifest.sourceSha256}\n`)) throw new Error('Acceptance record does not describe this candidate');
}
