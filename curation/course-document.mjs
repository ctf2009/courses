import { readFileSync } from 'node:fs';

const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function object(value, keys, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label} object`);
}
function text(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label} text`);
}
function array(value, minimum, maximum, label) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`Invalid ${label} count`);
}

export function validateCourseDocument(document) {
  object(document, ['title', 'subtitle', 'modules', 'sources'], 'document');
  text(document.title, 120, 'title'); text(document.subtitle, 400, 'subtitle');
  array(document.modules, 2, 16, 'modules');
  for (const module of document.modules) {
    object(module, ['title', 'sections', 'quiz'], 'module'); text(module.title, 120, 'module title');
    array(module.sections, 1, 8, 'sections');
    for (const section of module.sections) {
      object(section, ['heading', 'paragraphs', 'bullets', 'code'], 'section'); text(section.heading, 160, 'heading');
      array(section.paragraphs, 1, 8, 'paragraphs'); section.paragraphs.forEach(value => text(value, 2500, 'paragraph'));
      if (section.bullets !== undefined) { array(section.bullets, 0, 12, 'bullets'); section.bullets.forEach(value => text(value, 500, 'bullet')); }
      if (section.code !== undefined) text(section.code, 8000, 'code');
    }
    array(module.quiz, 5, 5, 'quiz questions');
    for (const question of module.quiz) {
      object(question, ['question', 'options', 'answer', 'explanation'], 'question');
      text(question.question, 600, 'question'); text(question.explanation, 1500, 'explanation');
      array(question.options, 2, 6, 'options'); question.options.forEach(value => text(value, 500, 'option'));
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) throw new Error('Invalid answer index');
    }
  }
  if (document.sources !== undefined) {
    array(document.sources, 0, 30, 'sources');
    for (const source of document.sources) {
      object(source, ['title', 'url'], 'source'); text(source.title, 160, 'source title'); text(source.url, 2000, 'source URL');
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Source URL must be HTTPS without credentials');
    }
  }
  return document;
}

export function renderCourseDocument(document, courseId) {
  validateCourseDocument(document);
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(courseId)) throw new Error('Invalid course ID');
  const modules = document.modules.map(module => ({ title: module.title, dek: '',
    html: module.sections.map(section => `<section><h3>${escape(section.heading)}</h3>${section.paragraphs.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}`
      + (section.bullets?.length ? `<ul>${section.bullets.map(bullet => `<li>${escape(bullet)}</li>`).join('')}</ul>` : '')
      + (section.code ? `<pre><code>${escape(section.code)}</code></pre>` : '') + '</section>').join(''),
    quiz: module.quiz.map(question => ({ q: question.question, o: question.options, a: question.answer, why: question.explanation })),
  }));
  const json = JSON.stringify({ courseId, modules }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const sources = (document.sources ?? []).map(source => `<li><a href="${escape(source.url)}" rel="noopener noreferrer">${escape(source.title)}</a></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(document.title)}</title><style>
  :root{color-scheme:light;font:17px/1.6 system-ui,sans-serif;color:#242534;background:#f7f6f2}*{box-sizing:border-box}body{margin:0}a{color:#4338ca}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #8057e5;outline-offset:3px}.wrap{display:grid;grid-template-columns:280px minmax(0,1fr)}aside{background:#191b29;color:#fff;padding:24px;position:sticky;top:0;height:100vh;overflow:auto}aside a{color:#d8c9ff}h1{font-size:23px}#toc button{display:block;width:100%;background:transparent;color:inherit;border:0;text-align:left;padding:10px;border-radius:6px}#toc button[aria-current=true]{background:#38304b}#ptext{font-size:13px}main{max-width:1000px;width:100%;margin:auto;padding:36px 42px 80px}h2{font-size:32px;line-height:1.2}h3{margin-top:32px}p,li{overflow-wrap:anywhere}.dek{color:#5e6071}pre{background:#e9e6f3;padding:16px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.quiz{margin-top:40px;padding:24px;background:#fff;border:1px solid #ddd;border-radius:12px}.qq{margin:24px 0}.opt{display:block;width:100%;margin:8px 0;padding:10px;text-align:left;border:1px solid #bbb;border-radius:6px;background:#fafafa;overflow-wrap:anywhere}.opt.sel{border:2px solid #6344ad}.opt.right{background:#ddf6e6}.opt.wrong{background:#ffe9eb}.why{display:none;margin:10px 0;padding:10px;border-left:3px solid #6344ad}.why.show{display:block}.score{margin-left:15px}.qbtn{background:#4338ca;color:#fff;border:0;border-radius:6px;padding:10px 18px}.pager{display:flex;justify-content:space-between;margin-top:30px;gap:15px}.pager button{max-width:48%;padding:10px}.topbar{display:none}button:disabled{cursor:default;opacity:.6}@media(max-width:800px){.wrap{display:block}aside{position:static;height:auto;padding:18px}#toc{display:none}aside.open #toc{display:block}.topbar{display:block}main{padding:24px 18px}h2{font-size:27px}.quiz{padding:16px}}
  </style></head><body><div class="wrap"><aside id="side"><a href="/index.html">← All courses</a><h1>${escape(document.title)}</h1><p>${escape(document.subtitle)}</p><p id="ptext"></p><button class="topbar" id="menuBtn">Modules</button><nav id="toc" aria-label="Modules"></nav></aside><main><div id="content"></div>${sources ? `<footer><h3>Sources supplied for review</h3><p>These references have not been independently verified by this draft workflow.</p><ul>${sources}</ul></footer>` : ''}</main></div><script>const COURSE_DATA=${json};</script><script>${readFileSync(new URL('./course-player.js', import.meta.url), 'utf8')}</script></body></html>`;
}
