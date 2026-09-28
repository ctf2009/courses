import { chromium } from 'playwright-core';
import path from 'node:path';

export const ARCHI_REVIEW_PROFILE = 'archi-browser-v1';
export const REVIEW_URL = 'https://curator.invalid/archi-course.html';
export const HUB_PREVIEW_URL = 'https://curator.invalid/index.html';
const STORAGE_KEY = 'archi-course-v1';
const REVIEW_TIMEOUT_MS = 60_000;
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function browserOptions() {
  return { headless: true, chromiumSandbox: true, timeout: 15_000,
    ...(process.env.CURATOR_CHROMIUM_EXECUTABLE ? { executablePath: process.env.CURATOR_CHROMIUM_EXECUTABLE } : {}),
    proxy: { server: 'http://127.0.0.1:9' },
    args: ['--disable-background-networking', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  };
}

export async function probeFreshReviewRuntime() {
  let browser;
  try {
    browser = await chromium.launch(browserOptions());
    return { reviewProfiles: [ARCHI_REVIEW_PROFILE], browserVersion: browser.version() };
  } catch {
    return { reviewProfiles: [], freshReviewUnavailable: 'The sandboxed Chromium review runtime could not start.' };
  } finally { await browser?.close(); }
}

export async function openIsolatedCourseBrowser(html, maximumDurationMs = REVIEW_TIMEOUT_MS, hubHtml) {
  const browser = await chromium.launch(browserOptions());
  const deadline = setTimeout(() => { void browser.close(); }, maximumDurationMs);
  const pageErrors = [];
  const blockedRequests = new Set();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block', acceptDownloads: false, reducedMotion: 'reduce', permissions: [] });
    context.setDefaultTimeout(3000);
    context.setDefaultNavigationTimeout(5000);
    await context.routeWebSocket('**/*', socket => { blockedRequests.add('websocket:' + new URL(socket.url()).origin); socket.close(); });
    await context.route('**/*', async route => {
      const requested = route.request().url();
      if ((requested === REVIEW_URL || (requested === HUB_PREVIEW_URL && typeof hubHtml === 'string')) && route.request().isNavigationRequest()) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: requested === REVIEW_URL ? html : hubHtml,
          headers: { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' } });
      } else {
        blockedRequests.add(route.request().url());
        await route.abort();
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 500)));
    page.on('dialog', dialog => { void dialog.dismiss(); });
    return { browser, context, page, pageErrors, blockedRequests, async close() { clearTimeout(deadline); await browser.close(); } };
  } catch (error) { clearTimeout(deadline); await browser.close(); throw error; }
}

export async function reviewArchiInBrowser(html, evidenceDirectory) {
  const session = await openIsolatedCourseBrowser(html);
  const { browser, page, pageErrors, blockedRequests } = session;
  const checks = [];
  const screenshots = [];
  const add = (id, passed, evidence) => checks.push({ id, status: passed ? 'passed' : 'failed', evidence });
  try {
    const snapshot = async name => {
      await page.screenshot({ path: path.join(evidenceDirectory, name), fullPage: false });
      screenshots.push(name);
    };
    await page.goto(REVIEW_URL);
    await page.locator('#toc button').first().waitFor();
    const modules = await page.evaluate(() => MODULES.map((module, index) => ({
      index, title: module.title, answers: (module.quiz ?? []).map(question => ({ correct: question.a, options: question.o.length })),
    })));
    if (modules.length < 1 || modules.length > 30) throw new Error('Archi profile expected 1–30 modules');
    add('module-inventory', modules.length === await page.locator('#toc button').count(), { moduleCount: modules.length });
    await snapshot('desktop-module-0.png');
    const externalResources = await page.evaluate(() => Array.from(document.querySelectorAll('script[src],link[href],img[src],iframe[src]'))
      .map(element => ({ tag: element.tagName.toLowerCase(), rel: element.getAttribute('rel'), url: element.getAttribute('src') ?? element.getAttribute('href') }))
      .filter(resource => /^https?:\/\//.test(resource.url ?? '')));
    const disallowedResources = externalResources.filter(resource => !(resource.tag === 'link'
      && ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(resource.url).origin)));
    add('runtime-dependencies', disallowedResources.length === 0, { externalResources, blockedNetwork: true, note: 'DOM resource elements only; lesson code examples are not treated as dependencies. External fonts are also blocked during this review.' });
    const renderings = [];
    for (const module of modules) {
      await page.locator(`#toc button[data-i="${module.index}"]`).click();
      renderings.push(await page.evaluate(() => ({
        heading: document.querySelector('h2.mtitle')?.textContent?.trim(),
        articleCharacters: document.querySelector('article')?.textContent?.trim().length ?? 0,
        diagrams: document.querySelectorAll('article svg').length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      })));
    }
    add('desktop-module-rendering', renderings.every((item, index) => item.heading === modules[index].title && item.articleCharacters > 100), { modules: renderings });
    add('desktop-horizontal-overflow', renderings.every(item => !item.horizontalOverflow), { affectedModuleIndexes: renderings.flatMap((item, index) => item.horizontalOverflow ? [index] : []) });
    add('hub-navigation', await page.locator('a').filter({ hasText: /all courses|course hub/i }).count() > 0, { expectation: 'A visible link back to the course hub.' });

    const quizModule = modules.find(module => module.answers.length > 0);
    if (!quizModule || quizModule.answers.length > 20 || quizModule.answers.some(answer => !Number.isInteger(answer.correct) || answer.options < 2 || answer.options > 10 || answer.correct < 0 || answer.correct >= answer.options)) {
      throw new Error('Archi profile cannot identify a quiz with valid answer metadata');
    }
    const openCleanQuiz = async () => {
      await page.evaluate(() => localStorage.clear());
      await page.goto(REVIEW_URL + `#m${quizModule.index}`);
      // The course reads the fragment only at startup; fragment navigation alone
      // does not re-render a module or clear its in-memory quiz selections.
      await page.reload();
      await page.locator('#quiz .qq').first().waitFor();
    };
    const state = async () => page.evaluate(key => ({
      storage: JSON.parse(localStorage.getItem(key) ?? 'null'),
      score: document.querySelector('#scoreOut')?.textContent?.trim() ?? '',
      selected: document.querySelectorAll('#quiz .opt.sel').length,
      visibleRationales: Array.from(document.querySelectorAll('#quiz .why')).filter(node => getComputedStyle(node).display !== 'none').length,
      revealedAnswers: document.querySelectorAll('#quiz .opt.right').length,
      retakeButtons: Array.from(document.querySelectorAll('#quiz button')).filter(node => /retake|try again/i.test(node.textContent ?? '')).length,
      progress: document.querySelector('#ptext')?.textContent,
    }), STORAGE_KEY);
    await openCleanQuiz();
    const before = await state();
    add('answers-hidden-before-submit', before.visibleRationales === 0 && before.revealedAnswers === 0, before);
    const firstOption = page.locator('#quiz .qq').first().locator('.opt').first();
    await firstOption.focus();
    await page.keyboard.press('Space');
    add('quiz-keyboard-selection', await firstOption.evaluate(node => node.classList.contains('sel')), { action: 'Focused first answer and pressed Space.' });
    for (let index = 0; index < quizModule.answers.length; index++) {
      const answer = quizModule.answers[index];
      await page.locator(`#quiz .qq[data-q="${index}"] .opt[data-o="${(answer.correct + 1) % answer.options}"]`).click();
    }
    const chosen = await state();
    add('answers-hidden-while-selecting', chosen.visibleRationales === 0 && chosen.revealedAnswers === 0, chosen);
    await page.locator('#checkBtn').click();
    const failedAttempt = await state();
    const moduleKey = `m${quizModule.index}`;
    add('failed-attempt-does-not-complete', failedAttempt.storage?.done?.[moduleKey] !== true, { moduleIndex: quizModule.index, allAnswersWrong: true, ...failedAttempt });
    add('failed-attempt-hides-missed-answers', failedAttempt.visibleRationales === 0 && failedAttempt.revealedAnswers === 0, failedAttempt);
    await page.locator('#scoreOut').scrollIntoViewIfNeeded();
    await snapshot('quiz-failed.png');
    await page.reload();
    const reloadedFailure = await state();
    add('failed-attempt-persists-on-reload', reloadedFailure.selected === quizModule.answers.length && reloadedFailure.score === failedAttempt.score && reloadedFailure.score.length > 0,
      { beforeReload: failedAttempt, afterReload: reloadedFailure });
    add('explicit-retake-available', reloadedFailure.retakeButtons > 0, { retakeButtons: reloadedFailure.retakeButtons });
    if (reloadedFailure.retakeButtons > 0) {
      await page.getByRole('button', { name: /retake|try again/i }).first().click();
      const retaken = await state();
      add('retake-starts-blank', retaken.selected === 0 && retaken.score === '' && retaken.visibleRationales === 0, retaken);
    } else checks.push({ id: 'retake-starts-blank', status: 'not-run', evidence: { reason: 'No explicit retake control was found.' } });
    await openCleanQuiz();
    for (let index = 0; index < quizModule.answers.length; index++) {
      await page.locator(`#quiz .qq[data-q="${index}"] .opt[data-o="${quizModule.answers[index].correct}"]`).click();
    }
    await page.locator('#checkBtn').click();
    const passedAttempt = await state();
    add('passing-attempt-completes', passedAttempt.storage?.done?.[moduleKey] === true, { allAnswersCorrect: true, ...passedAttempt });
    await page.locator('#scoreOut').scrollIntoViewIfNeeded();
    await snapshot('quiz-passed.png');
    await page.reload();
    const reloadedPass = await state();
    add('passing-attempt-persists-on-reload', reloadedPass.selected === quizModule.answers.length && reloadedPass.score === passedAttempt.score && reloadedPass.score.length > 0,
      { beforeReload: passedAttempt, afterReload: reloadedPass });
    add('completion-persists-on-reload', reloadedPass.storage?.done?.[moduleKey] === true, reloadedPass);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(REVIEW_URL + '#m0');
    await page.reload();
    const mobile = await page.evaluate(() => ({
      viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth,
      heading: document.querySelector('h2.mtitle')?.textContent?.trim(),
      diagrams: document.querySelectorAll('article svg').length,
    }));
    add('mobile-module-0-overflow', mobile.documentWidth <= mobile.viewport + 1, mobile);
    await page.evaluate(() => window.scrollTo(0, 0));
    await snapshot('mobile-module-0.png');
    add('javascript-runtime-errors', pageErrors.length === 0, { errors: pageErrors });
    return { profile: ARCHI_REVIEW_PROFILE, browserVersion: browser.version(), checks, screenshots,
      blockedRequests: [...blockedRequests], quizModuleIndex: quizModule.index,
      limits: { maximumBrowserCheckDurationMs: REVIEW_TIMEOUT_MS, maximumBrowserStartupMs: 15_000, maximumModules: 30,
        maximumQuizQuestions: 20, maximumOptionsPerQuestion: 10, outboundNetwork: 'blocked', browserState: 'isolated-disposable-context' },
      outstanding: ['Factual ArchiMate claims and sources were not verified.', 'The exact 60% boundary was not tested; this pass used all-wrong and all-correct attempts.',
        'Mobile checks cover module 0 only; diagram quality and visual layout still need human screenshot review.', 'Hub progress integration, downloadable assets and live publication were not verified.',
        'External fonts were blocked, so screenshots use fallback fonts.'] };
  } finally {
    await session.close();
  }
}
