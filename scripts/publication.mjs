import { createHash } from 'node:crypto';

const sha = text => createHash('sha256').update(text).digest('hex');
const escape = text => String(text).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
const json = value => JSON.stringify(value, null, 2) + '\n';
const bounded = (text, max) => typeof text === 'string' && text.trim().length > 0 && text.length <= max;

/** One immutable release contains the course, its hub entry and catalogue record. */
export function preparePublication({ publicationId, courseId, html, sourceSha256, structure, metadata, evidence, catalogueText, indexHtml }) {
  if (!/^req_[A-Za-z0-9_-]{1,120}$/.test(publicationId) || !/^[a-z][a-z0-9-]{1,63}$/.test(courseId)) throw new Error('Invalid publication identity');
  if (!bounded(html, 1000000) || sha(html) !== sourceSha256) throw new Error('Candidate hash mismatch');
  if (!structure || !bounded(structure.key, 150) || !Number.isInteger(structure.modules) || structure.modules < 1 || structure.modules > 30
    || !['map', 'array'].includes(structure.completion)) throw new Error('Unsupported progress contract');
  for (const [name, maximum] of [['title', 120], ['description', 600], ['topic', 80], ['audience', 500], ['objective', 600]]) {
    if (!bounded(metadata?.[name], maximum)) throw new Error(`Missing or oversized ${name}`);
  }
  if (Object.keys(metadata).some(key => !['title', 'description', 'topic', 'audience', 'objective'].includes(key))) throw new Error('Unexpected publication metadata field');
  if (!evidence || evidence.browserVerified !== true || !bounded(evidence.reviewSummary, 12000)) throw new Error('Browser evidence and review summary are required');
  const catalogue = JSON.parse(catalogueText);
  if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.courses)) throw new Error('Invalid catalogue');
  const existing = catalogue.courses.find(course => course.id === courseId);
  if (catalogue.courses.some(course => course.id !== courseId && course.progressKey === structure.key)) throw new Error('Progress key belongs to another course');
  if (existing && existing.progressKey !== structure.key) throw new Error('Publication must preserve the existing progress key');
  const coursePath = `public/${courseId}-course.html`;
  const reviewPath = `curation/publications/${publicationId}.md`;
  const entry = { id: courseId, ...metadata, path: coursePath, placement: 'served', progressKey: structure.key,
    modules: structure.modules, completion: structure.completion, reviewStatus: 'reviewed', review: reviewPath,
    publicationId, sourceSha256 };
  if (existing) catalogue.courses[catalogue.courses.indexOf(existing)] = entry;
  else catalogue.courses.push(entry);
  const marker = id => `<!-- curator-course:${id} -->`;
  const endMarker = id => `<!-- /curator-course:${id} -->`;
  const card = `${marker(courseId)}\n    <a class="course" data-course-id="${courseId}" data-progress-key="${escape(structure.key)}" data-progress-shape="${structure.completion}" data-modules="${structure.modules}" href="${courseId}-course.html">
      <div class="step"><span class="n"></span>${escape(metadata.topic)}</div>
      <h2>${escape(metadata.title)}</h2>
      <p>${escape(metadata.description)}</p>
      <div class="pbar"><i data-course-progress></i></div>
      <div class="pmeta"><span>${structure.modules} modules</span><span data-course-progress-text>not started</span></div>
      <span class="go">Start course →</span>
    </a>\n    ${endMarker(courseId)}`;
  if (indexHtml.includes(marker(courseId))) {
    const start = indexHtml.indexOf(marker(courseId)), end = indexHtml.indexOf(endMarker(courseId));
    if (end < start || indexHtml.indexOf(marker(courseId), start + 1) !== -1) throw new Error('Ambiguous hub entry');
    indexHtml = indexHtml.slice(0, start) + card + indexHtml.slice(end + endMarker(courseId).length);
  } else {
    if (existing?.placement === 'served' || indexHtml.includes(`href="${courseId}-course.html"`)) throw new Error('Existing unmanaged hub entry needs an explicit adapter');
    const anchor = '<!-- curator-course-cards -->';
    if (indexHtml.split(anchor).length !== 2) throw new Error('The hub has no unique publication insertion point');
    indexHtml = indexHtml.replace(anchor, card + '\n    ' + anchor);
  }
  const files = [
    { path: coursePath, content: html },
    { path: 'public/index.html', content: indexHtml },
    { path: 'curation/catalogue.json', content: json(catalogue) },
    { path: reviewPath, content: `# ${metadata.title}\n\nPublication: ${publicationId}\nCandidate SHA-256: ${sourceSha256}\n\n## Acceptance evidence\n\n${evidence.reviewSummary}\n\nBrowser checks passed for this candidate. The acceptance summary records the review and any remaining limitations; publication is not a claim of exhaustive factual certification.\n` },
  ];
  if (existing?.placement === 'draft') {
    if (existing.path !== `drafts/${courseId}-course.html`) throw new Error('Unexpected draft path');
    files.push({ path: existing.path, content: null });
  }
  const manifest = { schemaVersion: 2, publicationId, courseId, sourceSha256, modules: structure.modules, progressKey: structure.key, completion: structure.completion,
    repositoryChanges: files.map(file => ({ path: file.path, sha256: file.content === null ? null : sha(file.content) })),
    files: files.filter(file => file.path.startsWith('public/')).map(file => ({ path: file.path.slice(7), sha256: sha(file.content) })) };
  files.push({ path: `curation/publications/${publicationId}.json`, content: json(manifest) });
  return { files, manifest, summary: { courseId, title: metadata.title, modules: structure.modules, progressKey: structure.key,
    coursePath, indexPath: 'public/index.html', sourceSha256, limitations: evidence.reviewSummary } };
}
