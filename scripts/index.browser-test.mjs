import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { preparePublication } from './publication.mjs';
import { hash } from './release-site.mjs';

test('published hub cards fit mobile, preserve saved progress, refresh and navigate', async t => {
  let catalogueText = await readFile('curation/catalogue.json', 'utf8');
  let indexHtml = await readFile('public/index.html', 'utf8');
  const assets = new Map([['/course-progress.js', await readFile('public/course-progress.js', 'utf8')]]);
  for (const [courseId, shape] of [['archi', 'map'], ['istio', 'array']]) {
    const key = JSON.parse(catalogueText).courses.find(course => course.id === courseId).progressKey;
    const html = `<html><head><title>${courseId} course</title></head><body>Retained ${courseId} course; ${key}</body></html>`;
    const prepared = preparePublication({ publicationId: `req_${courseId}`, courseId, html, sourceSha256: hash(html),
      structure: { key, completion: shape, modules: 4 }, metadata: { title: `${courseId} practical course`, topic: 'Architecture',
        description: 'Worked examples, practice and assessments.', audience: 'Practitioners', objective: 'Apply the concepts' },
      evidence: { browserVerified: true, reviewSummary: 'Test fixture review and acceptance.' }, catalogueText, indexHtml });
    indexHtml = prepared.files.find(file => file.path === 'public/index.html').content;
    catalogueText = prepared.files.find(file => file.path === 'curation/catalogue.json').content;
    assets.set(`/${courseId}-course.html`, html);
  }
  assets.set('/', indexHtml);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.writeHead(assets.has(pathname) ? 200 : 404, { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
    response.end(assets.get(pathname) ?? 'Missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CURATOR_CHROMIUM_EXECUTABLE ? { executablePath: process.env.CURATOR_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'chrome' } : {}), chromiumSandbox: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const initial = { 'archi-course-v1': { done: { m0: true, m2: true }, quiz: { m0: { picks: [2] } }, theme: 'dark' },
    'istio-course-v1': { done: [0, 2], quiz: { 0: { picks: [1] } } } };
  await page.goto(origin);
  await page.evaluate(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }, initial);
  await page.reload();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator('a.course').count(), 6);
    for (const id of ['archi', 'istio']) assert.equal(await page.locator(`[data-course-id="${id}"] [data-course-progress-text]`).textContent(), '2 / 4 done');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
    if (process.env.PUBLICATION_SCREENSHOTS_DIR) {
      await mkdir(process.env.PUBLICATION_SCREENSHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PUBLICATION_SCREENSHOTS_DIR, `index-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, JSON.parse(localStorage.getItem(key))])), Object.keys(initial)), initial);
  await page.locator('[data-course-id="archi"]').click(); assert.equal(new URL(page.url()).pathname, '/archi-course.html');
  await page.goBack();
  await page.evaluate(() => { localStorage.setItem('archi-course-v1', JSON.stringify({ done: { m0: true, m1: true, m2: true } })); dispatchEvent(new Event('storage')); });
  assert.equal(await page.locator('[data-course-id="archi"] [data-course-progress-text]').textContent(), '3 / 4 done');
  assert.deepEqual(errors, []);
});
