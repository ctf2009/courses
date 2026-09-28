// Trusted renderer runtime. Model content is data, never executable source.
const MODULES = COURSE_DATA.modules;
const KEY = `curator-${COURSE_DATA.courseId}-v1`;
const htmlText = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function readState() {
  try { const saved = JSON.parse(localStorage.getItem(KEY)); return saved && typeof saved === 'object' ? { ...saved, done: saved.done ?? {}, quiz: saved.quiz ?? {} } : { done: {}, quiz: {} }; }
  catch { return { done: {}, quiz: {} }; }
}
function saveState(state) { localStorage.setItem(KEY, JSON.stringify(state)); }
function navigation(index) {
  const state = readState();
  document.getElementById('ptext').textContent = `${MODULES.filter((_, i) => state.done['m' + i]).length} of ${MODULES.length} modules complete`;
  document.getElementById('toc').innerHTML = MODULES.map((module, i) => `<button data-i="${i}" aria-current="${index === i}">${i + 1}. ${htmlText(module.title)}${state.done['m' + i] ? ' ✓' : ''}</button>`).join('');
  document.querySelectorAll('#toc button').forEach(button => { button.onclick = () => { openModule(Number(button.dataset.i)); document.getElementById('side').classList.remove('open'); }; });
}
function openModule(index) {
  const current = Math.max(0, Math.min(MODULES.length - 1, index));
  const module = MODULES[current];
  history.replaceState(null, '', '#m' + current);
  navigation(current);
  const state = readState();
  let attempt = state.quiz['m' + current] ?? null;
  let picks = attempt?.picks?.slice() ?? Array(module.quiz.length).fill(null);
  document.getElementById('content').innerHTML = `<h2 class="mtitle">${htmlText(module.title)}</h2><article>${module.html}</article><section class="quiz" id="quiz"><h3>Check yourself</h3><p>Choose every answer, then submit. Pass at 60%. Retakes are unlimited.</p>${module.quiz.map((question, q) => `<div class="qq" data-q="${q}"><p class="qt">${q + 1}. ${htmlText(question.q)}</p>${question.o.map((option, o) => `<button class="opt" data-o="${o}">${htmlText(option)}</button>`).join('')}<div class="why"></div></div>`).join('')}<button class="qbtn" id="checkBtn">Check answers</button><span class="score" id="scoreOut" aria-live="polite"></span><button class="qbtn" id="retakeBtn" hidden>Retake quiz</button></section><div class="pager"><button id="previous" ${current === 0 ? 'disabled' : ''}>← Previous module</button><button id="next" ${current === MODULES.length - 1 ? 'disabled' : ''}>Next module →</button></div>`;
  const paint = () => {
    document.querySelectorAll('#quiz .qq').forEach((element, q) => {
      const question = module.quiz[q];
      element.querySelectorAll('.opt').forEach((option, o) => {
        option.classList.toggle('sel', picks[q] === o);
        option.classList.toggle('right', !!attempt && o === question.a && (attempt.passed || picks[q] === question.a));
        option.classList.toggle('wrong', !!attempt && picks[q] === o && o !== question.a);
        option.disabled = !!attempt;
        option.setAttribute('aria-pressed', String(picks[q] === o));
      });
      const why = element.querySelector('.why');
      const explain = !!attempt && (attempt.passed || picks[q] === question.a);
      why.classList.toggle('show', explain); why.textContent = explain ? question.why : '';
    });
    document.getElementById('scoreOut').textContent = attempt ? `${attempt.score} / ${attempt.max} — ${attempt.passed ? 'Passed' : 'Try again'}` : '';
    document.getElementById('checkBtn').disabled = !!attempt || picks.some(value => value === null);
    document.getElementById('retakeBtn').hidden = !attempt;
  };
  document.querySelectorAll('#quiz .qq').forEach((element, q) => element.querySelectorAll('.opt').forEach(option => {
    option.onclick = () => { if (!attempt) { picks[q] = Number(option.dataset.o); paint(); } };
  }));
  document.getElementById('checkBtn').onclick = () => {
    if (attempt || picks.some(value => value === null)) return;
    const score = picks.filter((answer, q) => answer === module.quiz[q].a).length;
    attempt = { picks: picks.slice(), score, max: module.quiz.length, passed: score / module.quiz.length >= 0.6 };
    const latest = readState(); latest.quiz['m' + current] = attempt;
    if (attempt.passed) latest.done['m' + current] = true;
    saveState(latest); navigation(current); paint();
  };
  document.getElementById('retakeBtn').onclick = () => {
    const latest = readState(); delete latest.quiz['m' + current]; saveState(latest);
    attempt = null; picks = Array(module.quiz.length).fill(null); paint();
  };
  document.getElementById('previous').onclick = () => openModule(current - 1);
  document.getElementById('next').onclick = () => openModule(current + 1);
  paint(); window.scrollTo(0, 0);
}
document.getElementById('menuBtn').onclick = () => document.getElementById('side').classList.toggle('open');
openModule(Number(location.hash.match(/^#m(\d+)$/)?.[1] ?? 0));
