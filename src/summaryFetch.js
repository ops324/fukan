// 候補の本文補完 — RSS 要約が薄い候補について、出典ページ本文を Node 側で取得して `summary` を厚くする。
// 追加依存なし（Node 組み込みの fetch のみ）。LLM は使わない＝決定的。
//
// なぜ必要か: writer/judge が使う WebFetch は 403 を返されると打つ手がなく、出典を照合できない。
// その状態で書くと「link を出典に掲げながらそこに無い数値を載せる」事故になる（2026-07-25 の山火事記事）。
// Node 側なら User-Agent を指定できるので、pressImage.js が既に解決している同じ問題
// （openai.com の Cloudflare が Bot UA を一律 403）に同じ手当てを当てる。
//
// **適用範囲の原則（重要）**: robots.txt が明示的に許可しているドメインだけを対象にする。
// bbc.co.uk / theguardian.com / theverge.com / cnbc.com / variety.com は robots.txt で Claude 系を
// **明示拒否**しており、UA を変えて取りに行くのは意思の迂回になる。config.summaryFetch.domains に
// 追加してはならない。判定は allowlist 方式で、リストに無いホストには**何もしない**。
import { config } from './config.js';

// 対象ドメインか（それ自身 or そのサブドメイン。pressImage.allowlist と同じ規則）。
export function isFetchTarget(link) {
  const cfg = config.summaryFetch;
  if (!cfg?.enabled || !Array.isArray(cfg.domains) || !cfg.domains.length) return false;
  let host;
  try { host = new URL(link).hostname.replace(/^www\./, ''); } catch { return false; }
  return cfg.domains.some((d) => host === d || host.endsWith(`.${d}`));
}

// 指定 UA で1回取得する（pressImage.js: tryFetch と同じ形。403 判定は呼び出し側）。
async function tryFetch(link, userAgent, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(link, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': userAgent, Accept: 'text/html' },
    });
  } catch {
    return null; // タイムアウト・ネットワーク断
  } finally {
    clearTimeout(timer);
  }
}

// HTML から本文らしいテキストを抜く。整形の精度より「出典に何と書いてあるか」が読めれば十分なので、
// script/style/nav 等を落として可視テキストを連結する素朴な実装にする（追加依存を増やさない）。
export function extractText(html, maxChars) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, maxChars);
}

// 候補1件の summary を補完して返す（元の候補は変更せず、新しいオブジェクトを返す）。
// 失敗しても必ず元の候補を返す＝日次を止めない。
export async function enrichSummary(candidate) {
  const cfg = config.summaryFetch;
  if (!candidate?.link || !isFetchTarget(candidate.link)) return candidate;
  // RSS 要約で足りているなら叩かない（相手サイトへの無駄なアクセスを避ける）。
  if ((candidate.summary || '').length >= (cfg.minSummaryLen ?? 400)) return candidate;

  const timeoutMs = config.timeouts?.summaryFetchMs ?? 8000;
  let res = await tryFetch(candidate.link, config.pressImage.userAgent, timeoutMs);
  // 403 のときだけブラウザ UA で1回再試行（全面採用ではなく WAF 誤検知の救済）。
  if (res?.status === 403 && config.pressImage.fallbackUserAgent) {
    res = await tryFetch(candidate.link, config.pressImage.fallbackUserAgent, timeoutMs);
  }
  if (!res || !res.ok) return candidate;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('html')) return candidate;

  let text;
  try { text = extractText(await res.text(), cfg.maxChars ?? 1200); } catch { return candidate; }
  if (text.length <= (candidate.summary || '').length) return candidate; // 短くなるなら採用しない
  return { ...candidate, summary: text, summarySource: 'fetched' };
}

// 候補配列をまとめて補完する。対象は少数（primary フィード1本・最大8件）なので直列でよい
// （相手サイトへ同時多発アクセスしないほうが行儀もよい）。
export async function enrichCandidates(candidates) {
  if (!config.summaryFetch?.enabled || !Array.isArray(candidates)) return { candidates, enriched: 0 };
  const out = [];
  let enriched = 0;
  for (const c of candidates) {
    const r = await enrichSummary(c);
    if (r !== c && r.summarySource === 'fetched') enriched++;
    out.push(r);
  }
  return { candidates: out, enriched };
}
