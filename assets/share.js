/* 俯瞰 — share.js
 * 記事の共有 UI を progressive enhancement で強化する。
 *  - リンクコピー: navigator.clipboard でコピー → 一時的にチェックアイコンへ。
 *  - ネイティブ共有: navigator.share 対応端末（主にモバイル）でだけ「共有」ボタンを出し、
 *    ルートに has-web-share を付与。CSS が個別 SNS ボタンを畳み「共有＋コピー」の2点にする。
 * バニラ・依存なし。reveal.js と同じ構え。
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var box = document.querySelector('.article-share');
    if (!box) return;

    var url = box.getAttribute('data-share-url') || location.href;
    var title = box.getAttribute('data-share-title') || document.title;

    // --- リンクコピー -------------------------------------------------------
    var copyBtn = box.querySelector('[data-share-copy]');
    if (copyBtn) {
      var copyHtml = copyBtn.innerHTML;
      var checkHtml = '<svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7"/></svg>';
      var resetTimer;
      function done() {
        copyBtn.classList.add('is-copied');
        copyBtn.innerHTML = checkHtml;
        copyBtn.setAttribute('aria-label', 'コピーしました');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(function () {
          copyBtn.classList.remove('is-copied');
          copyBtn.innerHTML = copyHtml;
          copyBtn.setAttribute('aria-label', 'リンクをコピー');
        }, 1600);
      }
      // 旧環境／clipboard API が拒否された場合のフォールバック
      function legacyCopy() {
        try {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.setAttribute('readonly', '');
          ta.style.position = 'absolute';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          done();
        } catch (e) {}
      }
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(legacyCopy);
        } else {
          legacyCopy();
        }
      });
    }

    // --- ネイティブ共有（Web Share API） -----------------------------------
    var nativeBtn = box.querySelector('[data-share-native]');
    if (nativeBtn && typeof navigator.share === 'function') {
      document.documentElement.classList.add('has-web-share');
      nativeBtn.hidden = false;
      nativeBtn.addEventListener('click', function () {
        navigator.share({ title: title, url: url }).catch(function () {});
      });
    }
  });
})();
