import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { preparePublication } from './publication.mjs';
import { validatePublication, requirePublicationEnabled } from './publication-validation.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const catalogueText = readFileSync(new URL('../curation/catalogue.json', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const html = '<html>Retained course bytes</html>';
const input = { publicationId: 'req_publication_test', courseId: 'archi', html, sourceSha256: createHash('sha256').update(html).digest('hex'),
  structure: { key: 'archi-course-v1', modules: 12, completion: 'map' },
  metadata: { title: 'Archi & models', description: '<script>not executable</script>', topic: 'Architecture', audience: 'Practitioners', objective: 'Build models' },
  evidence: { browserVerified: true, reviewSummary: 'Primary-source review assessed; limitations explicitly accepted.' }, catalogueText, indexHtml };

function validate(plan, prior = catalogueText) {
  validatePublication({ manifest: plan.manifest, publicationId: plan.manifest.publicationId,
    changedPaths: plan.files.map(file => file.path), previousCatalogue: JSON.parse(prior),
    read: path => plan.files.find(file => file.path === path)?.content ?? null });
}

test('release validates draft promotion and later updates including catalogue and acceptance bytes', () => {
  const plan = preparePublication(input); validate(plan);
  const prior = plan.files.find(file => file.path === 'curation/catalogue.json').content;
  const next = preparePublication({ ...input, publicationId: 'req_publication_next', catalogueText: prior,
    indexHtml: plan.files.find(file => file.path === 'public/index.html').content });
  validate(next, prior);
  for (const path of ['curation/catalogue.json', 'curation/publications/req_publication_next.md']) {
    const tampered = structuredClone(next);
    tampered.files.find(file => file.path === path).content += 'changed';
    assert.throws(() => validate(tampered, prior), /bytes differ/);
    assert.throws(() => validate({ ...next, files: next.files.filter(file => file.path !== path) }, prior));
  }
  const stale = structuredClone(next);
  stale.files.find(file => file.path === 'curation/catalogue.json').content = prior;
  stale.manifest.repositoryChanges.find(file => file.path === 'curation/catalogue.json').sha256 = createHash('sha256').update(prior).digest('hex');
  assert.throws(() => validate(stale, prior), /Catalogue does not describe/);
  const wrongAcceptance = structuredClone(next);
  const record = wrongAcceptance.files.find(file => file.path.endsWith('.md'));
  record.content = plan.files.find(file => file.path.endsWith('.md')).content;
  wrongAcceptance.manifest.repositoryChanges.find(file => file.path === record.path).sha256 = createHash('sha256').update(record.content).digest('hex');
  assert.throws(() => validate(wrongAcceptance, prior), /Acceptance record/);
  record.content += `\nPublication: ${next.manifest.publicationId}\nCandidate SHA-256: ${next.manifest.sourceSha256}\n`;
  wrongAcceptance.manifest.repositoryChanges.find(file => file.path === record.path).sha256 = createHash('sha256').update(record.content).digest('hex');
  assert.throws(() => validate(wrongAcceptance, prior), /Acceptance record/);
});

test('metadata cannot replace release identity or catalogue fields', () => {
  for (const key of ['id', 'path', 'publicationId', 'sourceSha256']) assert.throws(() => preparePublication({ ...input, metadata: { ...input.metadata, [key]: 'other' } }), /metadata field/);
});

test('disabled runner fails before GitHub or deployment access and writes a failed receipt', () => {
  for (const value of [undefined, 'false', 'TRUE', '1']) assert.throws(() => requirePublicationEnabled({ CURATOR_PUBLICATION_ENABLED: value }), /disabled/);
  requirePublicationEnabled({ CURATOR_PUBLICATION_ENABLED: 'true' });
  const directory = mkdtempSync(join(tmpdir(), 'publication-disabled-'));
  try {
    const receipt = join(directory, 'receipt.json');
    assert.throws(() => execFileSync(process.execPath, [new URL('./run-publication.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], {
      cwd: directory, stdio: 'pipe', env: { ...process.env, CURATOR_PUBLICATION_ENABLED: 'false',
        PUBLICATION_ID: input.publicationId, PUBLICATION_REVISION: 'a'.repeat(40), PUBLICATION_RECEIPT_PATH: receipt, GH_TOKEN: '' },
    }));
    const saved = JSON.parse(readFileSync(receipt, 'utf8'));
    assert.equal(saved.error, 'Course publication is disabled'); assert.equal(saved.publicationVerified, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('promotion updates course, index, progress and catalogue together without changing other cards', () => {
  const plan = preparePublication(input);
  const hub = plan.files.find(file => file.path === 'public/index.html').content;
  for (const id of ['llm', 'rag', 'websec', 'togaf']) assert.ok(hub.includes(`href="${id}-course.html"`));
  assert.ok(hub.includes('data-progress-key="archi-course-v1"'));
  assert.ok(hub.includes('&lt;script&gt;not executable&lt;/script&gt;'));
  assert.equal(plan.files.find(file => file.path === 'public/archi-course.html').content, html);
  assert.equal(plan.files.find(file => file.path === 'drafts/archi-course.html').content, null);
  const catalogue = JSON.parse(plan.files.find(file => file.path === 'curation/catalogue.json').content);
  assert.equal(catalogue.courses.find(course => course.id === 'archi').placement, 'served');
  assert.deepEqual(catalogue.courses.filter(course => course.id !== 'archi'), JSON.parse(catalogueText).courses.filter(course => course.id !== 'archi'));
  const next = preparePublication({ ...input, indexHtml: hub, catalogueText: JSON.stringify(catalogue) });
  assert.equal(next.files.find(file => file.path === 'public/index.html').content.match(/data-course-id="archi"/g).length, 1);
});

test('publication rejects tampering, unsafe IDs, changed progress keys and ambiguous hub markers', () => {
  for (const changes of [{ html: html + 'changed' }, { courseId: '../escape' }, { structure: { ...input.structure, key: 'different' } },
    { indexHtml: indexHtml.replace('<!-- curator-course-cards -->', '') }, { evidence: { browserVerified: false } }]) {
    assert.throws(() => preparePublication({ ...input, ...changes }));
  }
});

test('hub reads real array and map progress without changing saved state', () => {
  for (const [shape, done] of [['array', [0, 2, 99]], ['map', { m0: true, m2: true, m99: true }]]) {
    const bar = { style: {} }, label = {};
    const stored = JSON.stringify({ done, quiz: { m1: { picks: [1] } }, theme: 'dark' });
    const card = { dataset: { progressKey: 'course-v1', progressShape: shape, modules: '4' }, querySelector: selector => selector === '[data-course-progress]' ? bar : label };
    vm.runInNewContext(readFileSync(new URL('../public/course-progress.js', import.meta.url), 'utf8'), {
      document: { querySelectorAll: () => [card] }, localStorage: { getItem: () => stored }, window: { addEventListener() {} },
    });
    assert.equal(bar.style.width, '50%'); assert.equal(label.textContent, '2 / 4 done');
  }
});
