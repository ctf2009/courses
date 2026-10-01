(function () {
  function refresh() {
    document.querySelectorAll('[data-course-id]').forEach(function (card) {
      var state = {};
      try { state = JSON.parse(localStorage.getItem(card.dataset.progressKey) || '{}') || {}; } catch (_) {}
      var total = Number(card.dataset.modules), done = state.done, count = 0;
      for (var i = 0; i < total; i++) {
        if (card.dataset.progressShape === 'array' ? Array.isArray(done) && done.includes(i) : done && done['m' + i] === true) count++;
      }
      card.querySelector('[data-course-progress]').style.width = (count / total * 100) + '%';
      card.querySelector('[data-course-progress-text]').textContent = count === 0 ? 'not started' : count === total ? 'complete ✓' : count + ' / ' + total + ' done';
    });
  }
  refresh();
  window.addEventListener('pageshow', refresh);
  window.addEventListener('storage', refresh);
})();
