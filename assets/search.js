// AXIOM AI — サイト内検索（追加依存ゼロ・静的）。
// search-index.json を一度だけ取得し、見出し/リード/タグ/セクションを部分一致で検索する。
(function () {
  'use strict';

  var input = document.getElementById('site-search');
  var box = document.getElementById('site-search-results');
  if (!input || !box) return;

  var base = input.getAttribute('data-base') || '';
  var index = null;
  var loading = false;
  var activeIdx = -1;
  var current = [];

  function loadIndex() {
    if (index || loading) return;
    loading = true;
    fetch(base + 'search-index.json')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) { index = Array.isArray(data) ? data : []; render(input.value); })
      .catch(function () { index = []; });
  }

  function norm(s) { return (s || '').toString().toLowerCase(); }

  function score(item, q) {
    var h = norm(item.headline);
    var l = norm(item.lead);
    var tags = (item.tags || []).map(norm);
    var sec = norm(item.section);
    var s = 0;
    if (h.indexOf(q) !== -1) s += 6;
    if (tags.some(function (t) { return t.indexOf(q) !== -1; })) s += 4;
    if (sec.indexOf(q) !== -1) s += 3;
    if (l.indexOf(q) !== -1) s += 2;
    return s;
  }

  function esc(s) {
    return (s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hide() {
    box.hidden = true; box.innerHTML = ''; activeIdx = -1; current = [];
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function render(raw) {
    var q = norm(raw).trim();
    if (!q) { hide(); return; }
    if (!index) { loadIndex(); return; }

    var results = index
      .map(function (it) { return { it: it, s: score(it, q) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 8)
      .map(function (r) { return r.it; });

    current = results;
    activeIdx = -1;

    if (!results.length) {
      box.innerHTML = '<div class="hsearch__empty">「' + esc(raw) + '」に一致する記事はありません</div>';
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
      return;
    }

    box.innerHTML = results.map(function (it, i) {
      return '<a id="hsearch-opt-' + i + '" href="' + base + 'articles/' + encodeURIComponent(it.slug) + '.html" role="option" aria-selected="false">' +
        '<span class="hsearch__hl">' + esc(it.headline) + '</span>' +
        '<span class="hsearch__meta">' + esc(it.section) + (it.date ? ' · ' + esc(it.date) : '') + '</span>' +
        '</a>';
    }).join('');
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(i) {
    var links = box.querySelectorAll('a');
    if (!links.length) return;
    activeIdx = (i + links.length) % links.length;
    links.forEach(function (a, idx) {
      var on = idx === activeIdx;
      a.classList.toggle('is-active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    links[activeIdx].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', links[activeIdx].id);
  }

  input.addEventListener('focus', loadIndex);
  input.addEventListener('input', function () { render(input.value); });
  input.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') {
      var links = box.querySelectorAll('a');
      if (activeIdx >= 0 && links[activeIdx]) { window.location.href = links[activeIdx].href; }
    } else if (e.key === 'Escape') { hide(); input.blur(); }
  });

  // 外側クリックで閉じる
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target) && e.target !== input) hide();
  });
})();
