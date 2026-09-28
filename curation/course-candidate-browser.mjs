import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { openIsolatedCourseBrowser, REVIEW_URL, HUB_PREVIEW_URL } from './archi-browser-review.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAXIMUM_MS = 120_000;
function hubPreview(courseId, key, modules) {
  const configuration = JSON.stringify({ key, modules }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Draft hub progress preview</title><style>body{font:18px/1.6 system-ui;margin:3rem;max-width:700px;color:#252536}article{border:1px solid #ddd;padding:2rem;border-radius:12px}progress{width:100%;height:28px}</style><h1>Draft hub progress preview</h1><p>This private fixture proves storage compatibility only. It is not a published course-hub change.</p><article><h2>${courseId}</h2><p id="hubProgressText"></p><progress id="hubProgress"></progress><p><a href="archi-course.html">Open candidate draft</a></p></article><script>const config=${configuration};let state;try{state=JSON.parse(localStorage.getItem(config.key))||{}}catch{state={}}const done=Array.from({length:config.modules},(_,i)=>state.done?.['m'+i]===true).filter(Boolean).length;document.getElementById('hubProgress').max=config.modules;document.getElementById('hubProgress').value=done;document.getElementById('hubProgressText').textContent=done+' of '+config.modules+' modules complete';</script></html>`;
}
const lessonBlocks = html => {
  const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(match => match[1]).filter(script => script.includes('MODULES.push({'))
    .map(script => script.slice(script.indexOf('MODULES.push({')));
  if (!blocks.length) throw new Error('Archi lesson source boundaries are not recognized');
  return blocks;
};

export function compareLessonSource(candidateHtml, baselineHtml) {
  const baseline = lessonBlocks(baselineHtml);
  const candidate = lessonBlocks(candidateHtml);
  return { passed: JSON.stringify(candidate) === JSON.stringify(baseline), evidence: {
    baselineHash: hash(JSON.stringify(baseline)), candidateHash: hash(JSON.stringify(candidate)),
    baselineBlocks: baseline.length, candidateBlocks: candidate.length,
    expectation: 'Every Archi lesson-bearing script suffix, from its first module through its closing script, must remain byte-identical in count and order.',
  } };
}

async function openModule(page, index) {
  await page.goto(REVIEW_URL + '#m' + index);
  await page.reload();
  await page.locator('h2.mtitle').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function inventory(page) {
  const result = await page.evaluate(() => ({ key: KEY, modules: MODULES.map(module => ({ title: module.title,
    quiz: (module.quiz ?? []).map(question => ({ correct: question.a, options: question.o.length })),
  })) }));
  if (result.modules.length < 1 || result.modules.length > 30 || result.modules.some(module => !module.quiz.length || module.quiz.length > 20
    || module.quiz.some(question => !Number.isInteger(question.correct) || question.options < 2 || question.options > 10 || question.correct < 0 || question.correct >= question.options))) {
    throw new Error('Candidate module/quiz inventory is outside the fixed browser profile');
  }
  return result;
}

async function quizState(page, key) {
  return page.evaluate(storageKey => ({
    state: JSON.parse(localStorage.getItem(storageKey) ?? 'null'),
    picks: Array.from(document.querySelectorAll('#quiz .qq')).map(question => {
      const option = question.querySelector('.opt.sel'); return option ? Number(option.getAttribute('data-o')) : null;
    }),
    reveal: Array.from(document.querySelectorAll('#quiz .qq')).map(question => ({
      right: question.querySelectorAll('.opt.right').length,
      explanation: Array.from(question.querySelectorAll('.why')).some(node => getComputedStyle(node).display !== 'none' && !!node.textContent.trim()),
    })),
    score: document.querySelector('#scoreOut')?.textContent?.trim() ?? '',
    progress: document.querySelector('#ptext')?.textContent?.trim() ?? '',
    checkDisabled: document.querySelector('#checkBtn')?.disabled === true,
  }), key);
}

async function exerciseQuiz(page, key, index, quiz, correctCount) {
  await page.evaluate(() => localStorage.clear());
  await openModule(page, index);
  const before = await quizState(page, key);
  const picks = quiz.map((question, q) => q < correctCount ? question.correct : (question.correct + 1) % question.options);
  for (let q = 0; q < picks.length; q++) await page.locator(`#quiz .qq[data-q="${q}"] .opt[data-o="${picks[q]}"]`).click();
  const selected = await quizState(page, key);
  await page.locator('#checkBtn').click();
  const submitted = await quizState(page, key);
  await page.reload();
  const reloaded = await quizState(page, key);
  const expectedPassed = correctCount / quiz.length >= 0.6;
  const attempt = submitted.state?.quiz?.['m' + index];
  const retake = page.locator('#quiz button').filter({ hasText: /retake|try again/i }).first();
  const hasRetake = await retake.isVisible();
  let retaken;
  if (hasRetake) { await retake.click(); retaken = await quizState(page, key); }
  return { expectedPassed, correctCount, maximum: quiz.length, picks, before, selected, submitted, reloaded, retaken,
    passedThreshold: (submitted.state?.done?.['m' + index] === true) === expectedPassed,
    hidesBeforeSubmit: [...before.reveal, ...selected.reveal].every(item => item.right === 0 && !item.explanation),
    preservesAttempt: attempt?.score === correctCount && attempt?.max === quiz.length && attempt?.passed === expectedPassed
      && JSON.stringify(attempt?.picks) === JSON.stringify(picks) && JSON.stringify(reloaded.state?.quiz?.['m' + index]) === JSON.stringify(attempt)
      && JSON.stringify(reloaded.picks) === JSON.stringify(picks) && reloaded.score.length > 0 && reloaded.checkDisabled,
    hidesMissedAnswers: expectedPassed || submitted.reveal.every((item, q) => q < correctCount || (item.right === 0 && !item.explanation)),
    retakeStartsBlank: !!retaken && retaken.picks.every(pick => pick === null) && retaken.score === '' && retaken.reveal.every(item => !item.explanation && item.right === 0)
      && !retaken.state?.quiz?.['m' + index] && (retaken.state?.done?.['m' + index] === true) === expectedPassed,
  };
}

export async function reviewCourseCandidate(html, { mode, courseId, baselineHtml, evidenceDirectory }) {
  const checks = [];
  const screenshots = [];
  const add = (id, passed, evidence) => checks.push({ id, status: passed ? 'passed' : 'failed', evidence });
  if (mode === 'revise') {
    const preservation = compareLessonSource(html, baselineHtml);
    add('lesson-source-preserved', preservation.passed, preservation.evidence);
  }
  const expectedKey = mode === 'revise' ? 'archi-course-v1' : `curator-${courseId}-v1`;
  // Module count is a verifier-owned constant for Archi; a create document
  // supplies the count through its trusted renderer's serialized module data.
  const moduleCount = mode === 'revise' ? 12 : JSON.parse(html.match(/const COURSE_DATA=(.*?);<\/script>/s)?.[1] ?? '{}').modules?.length;
  if (!Number.isInteger(moduleCount) || moduleCount < 1 || moduleCount > 30) throw new Error('Invalid hub preview module count');
  const hubHtml = hubPreview(courseId, expectedKey, moduleCount);
  const hubPath = path.join(evidenceDirectory, 'hub-preview.html');
  try { const stat = await lstat(hubPath); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Hub evidence must be a regular file'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(hubPath, hubHtml, { mode: 0o600 });
  const session = await openIsolatedCourseBrowser(html, MAXIMUM_MS, hubHtml);
  const { page, browser } = session;
  const screenshot = async name => {
    const filename = path.join(evidenceDirectory, name);
    try { const stat = await lstat(filename); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Screenshot evidence must be a regular file'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await page.screenshot({ path: filename }); screenshots.push(name);
  };
  try {
    await page.goto(REVIEW_URL);
    await page.locator('#toc button').first().waitFor();
    const { key, modules } = await inventory(page);
    add('stable-storage-key', key === expectedKey, { key });
    const resources = await page.evaluate(() => Array.from(document.querySelectorAll('script[src],link[href],img[src],iframe[src]'))
      .map(node => ({ tag: node.tagName, url: node.getAttribute('src') ?? node.getAttribute('href') })));
    add('runtime-resource-policy', resources.every(resource => !resource.url || (resource.tag === 'LINK'
      && /^https:\/\/fonts\.(googleapis|gstatic)\.com(?:\/|$)/.test(resource.url))), { resources, outboundNetwork: 'blocked' });
    const hubLink = page.getByRole('link', { name: /all courses|course hub/i }).first();
    const hubVisible = await hubLink.isVisible();
    const hubHref = hubVisible ? await hubLink.evaluate(link => link.href) : null;
    add('hub-navigation', hubVisible && hubHref === HUB_PREVIEW_URL, { expected: 'Visible same-origin index.html course hub link', href: hubHref });
    const seen = [];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      for (let index = 0; index < modules.length; index++) {
        await openModule(page, index);
        const rendering = await page.evaluate(() => ({ heading: document.querySelector('h2.mtitle')?.textContent?.trim(),
          textLength: document.querySelector('article')?.textContent?.trim().length ?? 0,
          overflow: document.documentElement.scrollWidth > innerWidth + 1, diagrams: document.querySelectorAll('article svg').length,
          navDisabled: Array.from(document.querySelectorAll('#toc button')).some(button => button.disabled),
        }));
        seen.push({ width, index, ...rendering });
        const name = `${width === 1280 ? 'desktop' : 'mobile'}-module-${String(index).padStart(2, '0')}.png`;
        await screenshot(name);
      }
    }
    add('all-module-rendering', seen.every(item => item.heading === modules[item.index].title && item.textLength > 80), { modules: seen });
    add('all-module-overflow', seen.every(item => !item.overflow), { affected: seen.filter(item => item.overflow) });
    add('free-module-navigation', seen.every(item => !item.navDisabled), { moduleCount: modules.length });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#toc button').first().click();
    await page.locator('#toc button').last().click();
    add('navigation-controls-work', await page.locator('h2.mtitle').textContent() === modules.at(-1).title, { expected: modules.at(-1).title });
    // Existing state is sampled without changing its shape or storage key.
    const oldIndex = modules.length - 1;
    const oldPicks = modules[oldIndex].quiz.map(question => question.correct);
    // Original Archi recorded completion but never persisted quiz answers. That
    // exact legacy shape must survive without inventing a newly passed attempt.
    const historical = { done: { ['m' + oldIndex]: true }, quiz: {} };
    await page.evaluate(({ key, historical }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(historical)); }, { key, historical });
    await openModule(page, oldIndex);
    const historicalRestored = await quizState(page, key);
    const legacy = { done: { ['m' + oldIndex]: true }, quiz: { ['m' + oldIndex]: { picks: oldPicks, score: oldPicks.length, max: oldPicks.length, passed: true } },
      preservedMetadata: { sentinel: 'existing-learner-state' } };
    await page.evaluate(({ key, legacy }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(legacy)); }, { key, legacy });
    await openModule(page, 0);
    const restored = await quizState(page, key);
    add('existing-state-preserved', JSON.stringify(restored.state) === JSON.stringify(legacy)
      && JSON.stringify(historicalRestored.state) === JSON.stringify(historical) && historicalRestored.score === '',
    { historicalBefore: historical, historicalAfter: historicalRestored.state, historicalScore: historicalRestored.score, before: legacy, after: restored.state });
    await page.locator('#quiz .opt').first().focus(); await page.keyboard.press('Space');
    add('keyboard-selection', (await quizState(page, key)).picks[0] === 0, { action: 'Focused first answer and pressed Space' });
    for (let q = 0; q < modules[0].quiz.length; q++) {
      const question = modules[0].quiz[q];
      await page.locator(`#quiz .qq[data-q="${q}"] .opt[data-o="${(question.correct + 1) % question.options}"]`).click();
    }
    await page.locator('#checkBtn').click(); await page.reload();
    const afterNewAttempt = (await quizState(page, key)).state;
    add('existing-state-survives-new-attempt', afterNewAttempt?.done?.['m' + oldIndex] === true
      && JSON.stringify(afterNewAttempt?.quiz?.['m' + oldIndex]) === JSON.stringify(legacy.quiz['m' + oldIndex])
      && JSON.stringify(afterNewAttempt?.preservedMetadata) === JSON.stringify(legacy.preservedMetadata), { before: legacy, after: afterNewAttempt });
    const completedCount = modules.filter((_, index) => afterNewAttempt?.done?.['m' + index] === true).length;
    const expectedProgress = `${completedCount} of ${modules.length} modules complete`;
    add('progress-count-matches-completion', (await quizState(page, key)).progress === expectedProgress, { expectedProgress });
    const hubPage = await session.context.newPage(); await hubPage.goto(HUB_PREVIEW_URL);
    const hub = await hubPage.evaluate(() => ({ count: document.getElementById('hubProgress').value,
      total: document.getElementById('hubProgress').max, text: document.getElementById('hubProgressText').textContent }));
    add('hub-progress-compatible', hub.count === completedCount && hub.total === modules.length && hub.text === expectedProgress,
      { ...hub, scope: 'Private hub preview using the candidate browser context and real localStorage, not deployed hub integration.' });
    const hubImage = path.join(evidenceDirectory, 'hub-progress.png');
    try { const stat = await lstat(hubImage); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Hub screenshot must be a regular file'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await hubPage.screenshot({ path: hubImage }); screenshots.push('hub-progress.png'); await hubPage.close();
    const attempts = [];
    for (let index = 0; index < modules.length; index++) {
      const quiz = modules[index].quiz;
      const minimumPass = Math.ceil(quiz.length * 0.6);
      for (const correctCount of [minimumPass - 1, minimumPass]) {
        const attempt = await exerciseQuiz(page, key, index, quiz, correctCount);
        attempts.push({ moduleIndex: index, ...attempt });
        if (quiz.length % 5 === 0 && !screenshots.includes(attempt.expectedPassed ? 'quiz-threshold-pass.png' : 'quiz-threshold-fail.png')) {
          // Return to the submitted attempt for an explicit score screenshot.
          await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key, state: attempt.submitted.state });
          await page.reload(); await page.locator('#scoreOut').scrollIntoViewIfNeeded();
          const name = attempt.expectedPassed ? 'quiz-threshold-pass.png' : 'quiz-threshold-fail.png';
          await screenshot(name);
        }
      }
    }
    add('meaningful-60-percent-boundary', attempts.some(item => item.expectedPassed && item.correctCount / item.maximum === 0.6)
      && attempts.every(item => item.passedThreshold), { attempts: attempts.map(item => ({ moduleIndex: item.moduleIndex, score: item.correctCount, max: item.maximum,
        expectedPassed: item.expectedPassed, actualDone: item.submitted.state?.done?.['m' + item.moduleIndex] === true })) });
    add('answers-hidden-before-submit', attempts.every(item => item.hidesBeforeSubmit), { checkedAttempts: attempts.length });
    add('failed-attempt-hides-missed-answers', attempts.every(item => item.hidesMissedAnswers), { attempts: attempts.filter(item => !item.hidesMissedAnswers) });
    add('attempts-persist-after-reload', attempts.every(item => item.preservesAttempt), { attempts: attempts.map(item => ({ moduleIndex: item.moduleIndex,
      expectedPassed: item.expectedPassed, before: item.submitted, after: item.reloaded })) });
    add('explicit-retake-starts-blank', attempts.every(item => item.retakeStartsBlank), { attempts: attempts.map(item => ({ moduleIndex: item.moduleIndex,
      expectedPassed: item.expectedPassed, retaken: item.retaken ?? null })) });
    add('javascript-runtime-errors', session.pageErrors.length === 0, { errors: session.pageErrors });
    return { checks, screenshots, browserVersion: browser.version(), browserVerified: true,
      limits: { browserStartupMs: 15_000, browserChecksMs: MAXIMUM_MS, maximumModules: 30 },
      limitations: ['Factual claims, answers and cited sources have not been independently verified.', 'Screenshots are retained, not a complete human visual review.',
        'Live publication, hub progress integration and downloadable assets remain unverified.', 'Network and external fonts were blocked.'] };
  } finally { await session.close(); }
}
