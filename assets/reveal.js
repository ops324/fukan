/* AXIOM AI — reveal.js
 * 機能的モーションのみ：記事ページの読了プログレスバー。
 * 装飾的な段階リビール（IntersectionObserver）は低認知負荷方針で撤去した。
 * バニラ・依存なし。prefers-reduced-motion を尊重（CSS 側で transition 無効化）。
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var prose = document.querySelector('.prose');
    if (!prose) return;

    var wrap = document.createElement('div');
    wrap.className = 'read-progress';
    wrap.setAttribute('aria-hidden', 'true');
    var bar = document.createElement('div');
    bar.className = 'read-progress__bar';
    wrap.appendChild(bar);
    document.body.appendChild(wrap);

    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var ratio = max > 0 ? doc.scrollTop / max : 0;
      if (ratio < 0) ratio = 0; else if (ratio > 1) ratio = 1;
      bar.style.width = (ratio * 100).toFixed(2) + '%';
    }
    function onScroll() {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  });
})();
