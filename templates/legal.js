// 法的・運営ページ（about / contact / privacy / terms / editorial / disclaimer）。
// ルート直下に出力（base='')。既存の .prose スタイルを流用する。
import { ticker, header, footer, page } from './layout.js';
import { esc } from '../src/markdown.js';
import { config } from '../src/config.js';

const EFFECTIVE = '2026年6月15日'; // 制定・最終改定日
const op = config.operator;
const mail = `<a href="mailto:${esc(op.email)}">${esc(op.email)}</a>`;

// 共通レイアウト（パンくず＋見出し＋本文 prose）
function legalPage({ slug, title, lead, bodyHtml, dateLabel, tickerItems }) {
  const main = `  <main class="container container--narrow">

    <nav class="breadcrumb" aria-label="パンくず">
      <ol>
        <li><a href="index.html">トップ</a></li>
        <li aria-current="page">${esc(title)}</li>
      </ol>
    </nav>

    <header class="page-head">
      <span class="cat">${esc(title)}</span>
      <h1 class="page-head__title">${esc(title)}</h1>
      <p class="page-head__lead">${esc(lead)}</p>
    </header>

    <article class="prose">
${bodyHtml}
    </article>

  </main>`;

  return page({
    title: `${title} | ${esc(config.siteName)}`,
    description: lead,
    body: `${ticker(tickerItems)}${header(dateLabel, '')}\n\n${main}\n\n${footer()}`,
    canonicalPath: `/${slug}`,
  });
}

function aboutBody() {
  return `      <p>${esc(config.siteName)}（ふかん／FUKAN）は、テック・AI・科学・経済・政治・国際・カルチャーまで、国内外のニュースを編集部が要約・論評してお届けする日本語の総合ニュースメディアです。</p>
      <h2>運営者情報</h2>
      <table>
        <tbody>
          <tr><th style="text-align:left; padding-right:1.5rem; white-space:nowrap;">運営者</th><td>${esc(op.brand)}</td></tr>
          <tr><th style="text-align:left; padding-right:1.5rem; white-space:nowrap;">代表</th><td>${esc(op.owner)}</td></tr>
          <tr><th style="text-align:left; padding-right:1.5rem; white-space:nowrap;">所在地</th><td>〒${esc(op.zip)}　${esc(op.address)}</td></tr>
          <tr><th style="text-align:left; padding-right:1.5rem; white-space:nowrap;">お問い合わせ</th><td>${mail}</td></tr>
        </tbody>
      </table>
      <h2>編集体制</h2>
      <p>本サイトの記事は、AIが一次情報を取材・要約し、編集方針に沿って生成・確認しています。詳しくは<a href="editorial.html">編集方針</a>をご覧ください。記事は各一次情報源の要約・論評であり、正確な詳細は必ず出典元をご確認ください。</p>`;
}

function contactBody() {
  return `      <p>${esc(config.siteName)} へのお問い合わせは、下記のメールアドレスまでお願いいたします。取材・掲載・訂正のご依頼、その他のご連絡も承ります。</p>
      <h2>連絡先</h2>
      <p>メール: ${mail}</p>
      <p>いただいたお問い合わせには、内容を確認のうえ順次返信いたします。返信までお時間をいただく場合があります。あらかじめご了承ください。</p>
      <h2>記事の訂正について</h2>
      <p>記事内容に誤りがある場合は、上記メールよりご指摘ください。確認のうえ、必要に応じて訂正・更新を行います（<a href="editorial.html">編集方針</a>参照）。</p>`;
}

function privacyBody() {
  return `      <p>${esc(op.brand)}（以下「当方」）は、${esc(config.siteName)}（以下「当サイト」）における利用者の個人情報・アクセス情報の取り扱いについて、以下のとおりプライバシーポリシーを定めます。</p>
      <h2>1. アクセス解析</h2>
      <p>当サイトは、利用状況の把握のために <strong>Cloudflare Web Analytics</strong> を使用しています。これは Cookie を使用せず、個人を特定しない方法でページの閲覧状況を計測するプライバシー配慮型の解析ツールです。</p>
      <h2>2. 広告について</h2>
      <p>当サイトは将来的に Google AdSense 等の第三者配信事業者による広告を掲載する場合があります。これらの事業者は、利用者の興味に応じた広告を表示するために Cookie を使用することがあります。利用者は <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">広告設定</a> でパーソナライズ広告を無効にできます。また <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener">aboutads.info</a> で第三者配信事業者の Cookie を無効化できます。</p>
      <h2>3. 個人情報の取得と利用目的</h2>
      <p>当方は、お問い合わせの際にいただくメールアドレス等の個人情報を、ご返信および対応の目的にのみ利用します。ご本人の同意なく目的外に利用すること、第三者に提供することはありません（法令に基づく場合を除く）。</p>
      <h2>4. 免責</h2>
      <p>当サイトのコンテンツの正確性には努めますが、内容を保証するものではありません。詳細は<a href="disclaimer.html">免責事項</a>をご確認ください。</p>
      <h2>5. ポリシーの改定</h2>
      <p>本ポリシーは、必要に応じて予告なく改定することがあります。改定後の内容は当ページに掲示した時点で効力を生じます。</p>
      <p style="color: var(--color-ink-2);">制定日: ${EFFECTIVE}</p>`;
}

function termsBody() {
  return `      <p>本利用規約（以下「本規約」）は、${esc(config.siteName)}（以下「当サイト」）の利用条件を定めるものです。利用者は当サイトを利用することで本規約に同意したものとみなします。</p>
      <h2>1. 著作権</h2>
      <p>当サイトに掲載する記事は、各一次情報源の内容を要約・論評したものであり、引用部分の権利は各出典元に帰属します。当サイトが独自に作成した文章・デザイン等の著作権は当方に帰属します。無断での複製・転載・再配布を禁じます。</p>
      <h2>2. 禁止事項</h2>
      <ul>
        <li>法令または公序良俗に反する行為</li>
        <li>当サイトの運営を妨害する行為</li>
        <li>当サイトのコンテンツの無断転載・改ざん</li>
        <li>第三者または当方の権利を侵害する行為</li>
      </ul>
      <h2>3. 免責</h2>
      <p>当サイトの利用により生じた損害について、当方は一切の責任を負いません。詳細は<a href="disclaimer.html">免責事項</a>をご確認ください。</p>
      <h2>4. 規約の変更</h2>
      <p>本規約は、必要に応じて予告なく変更することがあります。</p>
      <h2>5. 準拠法・裁判管轄</h2>
      <p>本規約の解釈には日本法を準拠法とし、当サイトに関して紛争が生じた場合には、当方所在地を管轄する裁判所を専属的合意管轄とします。</p>
      <p style="color: var(--color-ink-2);">制定日: ${EFFECTIVE}</p>`;
}

function editorialBody() {
  return `      <p>${esc(config.siteName)} は、信頼できるニュースを届けるために、以下の編集方針に基づいて記事を制作しています。</p>
      <h2>1. 一次情報の優先</h2>
      <p>企業の公式発表・公式ブログ・研究機関などの一次情報を優先的に扱います。報道メディアの情報は、可能な限り別ソースで裏取りを行ったうえで掲載します。</p>
      <h2>2. 重要度による選別</h2>
      <p>新着をすべて掲載するのではなく、編集上の重要度で選別・序列化します。話題性が低い情報や、事実が確認できない情報は掲載しません。</p>
      <h2>3. AI による要約と編集</h2>
      <p>記事は AI が一次情報を取材・要約し、編集方針に沿って生成・確認しています。元記事に書かれていない事実・数値の創作は行いません。各記事は短い独自要約と中立的な論評にとどめ、全文転載は行いません（アグリゲーター型）。</p>
      <h2>4. 出典の明示</h2>
      <p>各記事には出典元へのリンクを明示します。正確な詳細・最新情報は必ず出典元をご確認ください。</p>
      <h2>5. 訂正・更新ポリシー</h2>
      <p>掲載後に誤りが判明した場合は、確認のうえ速やかに訂正・更新します。ご指摘は<a href="contact.html">お問い合わせ</a>よりお願いいたします。</p>`;
}

function disclaimerBody() {
  return `      <p>${esc(config.siteName)}（以下「当サイト」）に掲載される情報の取り扱いについて、以下のとおり免責事項を定めます。</p>
      <h2>1. 情報の正確性</h2>
      <p>当サイトは情報の正確性・最新性に努めますが、その内容を保証するものではありません。当サイトの記事は各一次情報源の要約・論評であり、正確な詳細は必ず出典元をご確認ください。</p>
      <h2>2. 助言ではないこと</h2>
      <p>当サイトの内容は情報提供を目的としたものであり、投資・法務・医療その他の専門的助言ではありません。何らかの判断・行動は利用者ご自身の責任で行ってください。</p>
      <h2>3. 外部リンク</h2>
      <p>当サイトから外部サイトへのリンクについて、リンク先の内容・正確性・安全性について当方は責任を負いません。</p>
      <h2>4. 損害の免責</h2>
      <p>当サイトの利用により生じたいかなる損害についても、当方は一切の責任を負いません。</p>
      <h2>5. 商標・第三者の画像について</h2>
      <p>各社の名称・ロゴ・製品画像等は各権利者に帰属します。当サイトの記事に用いる公式発表画像は、各社が公開する発表素材を<strong>報道・論評の目的</strong>で出典明示のうえ引用するものであり、各社との提携・協賛・推奨を示すものではありません。権利者からの申し出があれば速やかに対応・削除します。</p>
      <p style="color: var(--color-ink-2);">制定日: ${EFFECTIVE}</p>`;
}

// 全法的ページを生成して { ファイル名: HTML } を返す
export function renderLegalPages(dateLabel, tickerItems = []) {
  const defs = [
    { slug: 'about.html', title: '運営者情報', lead: `${config.siteName} の運営者情報とお問い合わせ先。`, body: aboutBody() },
    { slug: 'contact.html', title: 'お問い合わせ', lead: `${config.siteName} へのご連絡・取材・訂正のご依頼はこちら。`, body: contactBody() },
    { slug: 'privacy.html', title: 'プライバシーポリシー', lead: 'アクセス解析・広告・個人情報の取り扱いについて。', body: privacyBody() },
    { slug: 'terms.html', title: '利用規約', lead: `${config.siteName} の利用条件。`, body: termsBody() },
    { slug: 'editorial.html', title: '編集方針', lead: '記事制作の方針と訂正・更新ポリシー。', body: editorialBody() },
    { slug: 'disclaimer.html', title: '免責事項', lead: '掲載情報の取り扱いと免責について。', body: disclaimerBody() },
  ];
  const out = {};
  for (const d of defs) {
    out[d.slug] = legalPage({ slug: d.slug, title: d.title, lead: d.lead, bodyHtml: d.body, dateLabel, tickerItems });
  }
  return out;
}
