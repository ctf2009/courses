import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { preparePublication } from './publication.mjs';

const catalogueText = readFileSync(new URL('../curation/catalogue.json', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const html = '<html>Retained course bytes</html>';
const input = { publicationId: 'req_publication_test', courseId: 'archi', html, sourceSha256: createHash('sha256').update(html).digest('hex'),
  structure: { key: 'archi-course-v1', modules: 12, completion: 'map' },
  metadata: { title: 'Archi & models', description: '<script>not executable</script>', topic: 'Architecture', audience: 'Practitioners', objective: 'Build models' },
  evidence: { browserVerified: true, reviewSummary: 'Primary-source review assessed; limitations explicitly accepted.' }, catalogueText, indexHtml };

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
