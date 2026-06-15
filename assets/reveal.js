/* AXIOM AI — reveal.js
 * 1) 読了プログレスバー（記事ページのみ）
 * 2) IntersectionObserver による段階リビール
 * バニラ・依存なし。JS 無効/失敗時は CSS 側で全コンテンツが表示される。
 * prefers-reduced-motion を尊重。
 */
(function () {
  'use strict';

  var root = document.documentElement;
  // `js` クラス（CSS のリビール・ゲート用）。head のインラインで既に付与済みでも冪等。
  root.classList.add('js');

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    /* ---- 1) 読了プログレスバー（本文 .prose があるページのみ）---- */
    var prose = document.querySelector('.prose');
    if (prose) {
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
    }

    /* ---- 2) 段階リビール ---- */
    var targets = document.querySelectorAll(
      '.card, .list-card, .ranked__item, .hero__side-item, .prose > *'
    );
    if (!targets.length) return;

    // reduced-motion / 非対応環境では即表示（hidden にしない）
    if (reduce || !('IntersectionObserver' in window)) {
      for (var i = 0; i < targets.length; i++) {
        targets[i].classList.add('reveal', 'is-visible');
      }
      return;
    }

    // 初期表示域（ファーストビュー）にある要素は同一フレーム内で即表示し、
    // チラつき（visible→hidden→visible）を防ぐ。残りだけアニメで段階表示。
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var deferred = [];
    for (var j = 0; j < targets.length; j++) {
      var el = targets[j];
      el.classList.add('reveal');
      if (el.getBoundingClientRect().top < vh * 0.92) {
        el.classList.add('is-visible');
      } else {
        deferred.push(el);
      }
    }
    if (!deferred.length) return;

    var io = new IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k++) {
        var e = entries[k];
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    for (var m = 0; m < deferred.length; m++) io.observe(deferred[m]);

    // セーフティ: 5秒後に未表示が残っていれば強制表示（監視漏れ対策）
    window.setTimeout(function () {
      for (var n = 0; n < deferred.length; n++) deferred[n].classList.add('is-visible');
    }, 5000);
  });
})();
