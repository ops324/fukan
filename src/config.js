// パイプライン全体の設定。ソース・モデル・件数などはここで調整する。
import 'dotenv/config';

export const config = {
  // 本番URL（共有リンク・検索・解析・SEOで使用。末尾スラッシュなし）
  // 旧 axiom-ai-xi.vercel.app は fukan-news.vercel.app へ 307/308 リダイレクト済み（Vercel側設定）。
  siteUrl: process.env.SITE_URL || 'https://fukan-news.vercel.app',

  // --- サイトメタ（SEO / OGP / 構造化データで使用）---
  siteName: '俯瞰',
  siteDescription: 'テック・AI・科学・経済・政治・国際・カルチャーまで、世界のニュースを編集部の要約と中立論評で俯瞰するニュースメディア。',
  ogImage: '/assets/og-default.jpg', // SNSシェア時の共通サムネ（1200×630）
  logo: '/assets/logo.png',          // 構造化データ publisher.logo

  // --- 運営者情報（運営者ページ / 構造化データの publisher）---
  operator: {
    brand: 'FlowMate',
    owner: '滝本哲也',
    zip: '104-0061',
    address: '東京都中央区銀座一丁目22番11号 銀座大竹ビジデンス 2F',
    email: 'contact@flowmate.jp',
  },

  // --- 生成設定（執筆はヘッドレス Claude が担当。ollama は廃止）---
  // 1回の掲載上限の目安。※実際の出力本数は prompts/generate-articles.md の「最大N件」が制御する
  // （fetchCandidates は candidatePool を使うため、この値は writer 起動経路では直接効かない）。
  // 値を変えるときは generate-articles.md の「最大25件」も必ず揃えること。×2回/日(6/18)で約50本/日。
  maxArticles: Number(process.env.MAX_ARTICLES || 25),
  candidatePool: 140,   // Claude に提示する候補プール数（この中から重要度＋カバレッジ均等化で選別）。
                        // 総合ニュース(36フィード/10セクション)で各セクションが writer に届くよう拡大。
                        // fetchNews がセクション round-robin でプールを満たし、低頻度セクションの締め出しを防ぐ。
  importanceFloor: 3,   // 重要度(1-5)がこれ未満の候補は掲載しない（些末ネタの除外）
  retentionTop: 40,     // トップページに載せる最新記事の上限。超過分はアーカイブへ
  // トップ中段カテゴリ別ブロックの表示本数。min=見出しを出す最小本数（navSections順に固定表示）、
  // max=1ブロックあたりの最大カード数。母集団は retentionTop（最新N本）。0本のカテゴリは構造上出せない。
  sectionBlockMin: 2,
  sectionBlockMax: 4,
  searchIndexMax: 600,  // search-index.json に載せる最大件数（直近順）。記事増時のクライアント負荷を抑える。
                        // 全記事はアーカイブ（月別）から辿れる。
  heroRecencyHours: 24, // ヒーロー（トップ最上段）は直近この時間内の最重要記事から選ぶ。
                        // 古い高importance記事がトップに居座り停滞するのを防ぐ。
                        // ウィンドウ内に記事が無ければ従来どおり全体の最重要をヒーローに（保険）。

  // --- AI関連度フィルタ（汎用フィードの無関係なテック記事を足切り）---
  // title+summary にこれらのいずれかが含まれる数を数える。
  // 総合ニュース化に伴い、このフィルタは rssFeeds で aiFilter:true を付けたフィードにのみ適用する
  // （GitHub/AWS/MS Dev 等のAI以外も大量に流す汎用ソースのノイズ抑制が目的）。
  // primary（企業公式）と aiFilter なしの総合ソースは常に通し、重要度フロアと writer の選別に委ねる。
  aiKeywords: [
    'AI', 'A.I.', '人工知能', 'LLM', '大規模言語', '生成', 'ジェネレーティブ', 'generative',
    'モデル', 'model', 'エージェント', 'agent', 'GPT', 'Gemini', 'Claude', 'Llama', 'Grok',
    '機械学習', 'machine learning', 'ディープラーニング', 'deep learning', 'ニューラル', 'neural',
    'OpenAI', 'Anthropic', 'DeepMind', 'Hugging Face', 'チャットボット', 'chatbot',
    'マルチモーダル', 'multimodal', '推論', 'inference', '学習', 'training', 'GPU', 'NVIDIA',
    'トランスフォーマー', 'transformer', 'プロンプト', 'prompt', 'RAG', '基盤モデル', 'foundation model',
  ],
  relevanceFloorMedia: 1, // aiFilter:true のフィードはキーワードヒットがこの数未満なら除外

  // --- ネットワーク timeout（ミリ秒）。挙動を変える定数は一元管理する ---
  timeouts: {
    rssMs: 15000,      // RSS フィード取得（rss-parser）
    linkCheckMs: 5000, // リンク死活チェック（evaluate.checkLink）
  },

  // 弱いソース除外: 動画/ポッドキャスト等は本文が乏しく取材に向かないためスキップ
  skipUrlPatterns: ['/video/', '/videos/', '/podcast/', '/podcasts/', '/live/', 'youtube.com', 'youtu.be'],

  // --- アナリティクス（Cookieless・任意）---
  // token を設定すると Cloudflare Web Analytics の beacon を全ページに出力する。
  // 未設定なら何も出力しない（プライバシー配慮・無料）。
  analytics: {
    provider: 'cloudflare',
    token: process.env.CF_BEACON_TOKEN || '',
  },

  // --- 画像（フリー素材API・任意）---
  // 画像を付ける重要度の下限。これ未満の記事は画像を取得・付与しない（image:null）。
  // 約50本/日で全件に画像を用意するのは取得・ページ重量の両面で過剰なため、ヒーロー候補となる
  // 重要記事(importance>=この値)だけに限定する。ヒーローは常に高importanceなので必ず画像が付く。
  // 表示テンプレ(leadStory/heroFigure)は「画像があれば表示」なので、これだけで「ヒーロー＋重要記事に画像」になる。
  imageImportanceFloor: 4,
  imageProvider: process.env.IMAGE_PROVIDER || 'unsplash', // 'unsplash' | 'pexels'
  unsplashKey: process.env.UNSPLASH_KEY || '',
  pexelsKey: process.env.PEXELS_KEY || '',

  // --- 記事と写真の関連度スコアリング（決定論・API 追加コストなし）---
  // 背景: 従来の選定は「ブランド非衝突かつ未使用の候補を先頭から採用」だけで、写真が記事内容に
  // 合うかの正の判定が無かった。取得済みの写真説明文（alt/description）を記事キーワードと照合し、
  // 最も内容が合う候補を選ぶ。数値・語彙はここに集約（トークン化ロジックは fetchImage.js）。
  imageRelevance: {
    enabled: true,       // false で従来の「先頭採用」に即戻す安全弁
    minScore: 0,         // 取り込み時: これ未満のクエリ候補は「弱一致」として退避し次の広いクエリへ（0=常に採用＝クエリ拡張挙動は現行不変）
    acceptWeak: true,    // 全クエリ未達でも最良候補を採用（抽象サムネより実写を優先）
    tolerance: 0.5,      // 最高スコアからこの差以内を「同等」とみなし used/index 分散を効かせる
    recheckMinScore: 1,  // 遡り点検（recheck-image-relevance）専用のしきい値（>0）。取り込み時 minScore とは分離
    queryWeight: 1.0,    // image_query 由来トークンの重み（Claude が本文から決めた＝最強シグナル）
    mapWeight: 0.6,      // KW_MAP(JA→EN)由来トークンの重み
    tagWeight: 0.5,      // tags/headline の英字トークンの重み
    genericWeight: 0.15, // 汎用語の重み（除外せず薄める。'data center' の 'data' まで消さないため）
    // 汎用語（被写体を特定しない語）。除外ではなく低重み化する。被写体語（rocket/laboratory 等）は入れない。
    // 注: tokenize は3字以上のみ拾うため 'ai' は元々脱落する（ここに入れても空振り）。
    genericTokens: ['technology', 'tech', 'artificial', 'intelligence', 'abstract', 'digital',
      'concept', 'background', 'modern', 'future', 'futuristic', 'system', 'device', 'screen', 'view', 'close'],
    // 境界ケースのみ LLM 査読に回す（Phase 4）。band 内のスコアだけを対象にしトークンを最小化。
    llmReview: { enabled: false, band: [0, 1] },
  },

  // --- 公式プレス画像の自動採用（報道用素材）---
  // 記事の出典(link)が「報道対象“本人”の公式発表ページ」なら、そのページの og:image を
  // 提供クレジット付きで自動的にサムネにする（企業が自ら SNS 共有用に配布している画像＝報道用素材）。
  // 取り込み時に stock 写真より優先し、失敗時は従来どおり stock/抽象サムネへフォールバック（今より悪くならない）。
  //
  // 安全境界（重要）: 第三者メディア（BBC/Guardian/TechCrunch 等）の画像は通信社・ライセンス物が
  // 多く転載は権利侵害になりやすい。よって **allowlist のドメイン（＝各社が自社について発表する公式ドメイン）に
  // 出典がある記事だけ**を対象にする。ここに無いソースは自動採用しない（stock にフォールバック）。
  // 追加・削除はこのリストを編集するだけ。domain は link のホストが「それ自身 or そのサブドメイン」なら一致。
  pressImage: {
    enabled: true,
    timeoutMs: 8000,     // 出典ページ取得のタイムアウト（超過はスキップして stock へ）
    minImportance: 4,    // これ未満の記事には付けない（imageImportanceFloor と揃える）
    // 既定の Bot UA（正直な素性表明。robots/ToS 配慮・レート制限もされやすい）。
    userAgent: 'Mozilla/5.0 (compatible; FukanNewsBot/1.0; +https://fukan-news.vercel.app)',
    // 既定 UA が 403 を返したドメインに限り、この UA で1回だけ再試行する。
    // 一部の公式ドメイン（例: openai.com）は Cloudflare 等が Bot UA を一律ブロックし、
    // og:image が取得できず stock 写真に落ちてしまう事故があったための保険（403時のみ・全面採用ではない）。
    fallbackUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    // 各社が「自社について」発表する一次情報の公式ドメインのみ。credit は「提供: <credit>」表示。
    allowlist: [
      // 主要 AI ラボ（各社の公式ドメイン）
      { domain: 'openai.com',            credit: 'OpenAI' },
      { domain: 'anthropic.com',         credit: 'Anthropic' },
      { domain: 'blog.google',           credit: 'Google' },
      { domain: 'deepmind.google',       credit: 'Google DeepMind' },
      { domain: 'ai.meta.com',           credit: 'Meta AI' },
      { domain: 'mistral.ai',            credit: 'Mistral AI' },
      { domain: 'x.ai',                  credit: 'xAI' },
      { domain: 'huggingface.co',        credit: 'Hugging Face' },
      // その他の一次情報の公式ドメイン
      { domain: 'blogs.nvidia.com',      credit: 'NVIDIA' },
      { domain: 'nasa.gov',              credit: 'NASA' },
      { domain: 'github.blog',           credit: 'GitHub' },
      { domain: 'devblogs.microsoft.com', credit: 'Microsoft' },
      { domain: 'aws.amazon.com',        credit: 'Amazon Web Services' },
    ],
  },

  // --- ニュース補助ソース（任意・キーがあれば使用）---
  newsapiKey: process.env.NEWSAPI_KEY || '',
  gnewsKey: process.env.GNEWS_KEY || '',
  tavilyKey: process.env.TAVILY_KEY || '',

  // --- RSS（キー不要・主力ソース）---
  // 総合ニュースの公式/メディアRSS。増やす場合はここに追加。
  // tier: 'primary'=企業公式の一次情報（優先）／'media'=報道メディア（補助・要裏取り）
  // aiFilter: true を付けたフィードのみ aiKeywords による足切りが効く（AI以外も大量に流す汎用ソース向け）。
  //           付けない総合ソースは素通しし、重要度フロアと writer の選別に委ねる。
  rssFeeds: [
    // --- AI（企業公式の一次情報＋AI専業メディア）---
    { url: 'https://openai.com/news/rss.xml',                source: 'OpenAI',        section: 'AI', tier: 'primary' },
    { url: 'https://blog.google/technology/ai/rss/',         source: 'Google AI',     section: 'AI', tier: 'primary' },
    { url: 'https://huggingface.co/blog/feed.xml',           source: 'Hugging Face',  section: 'AI', tier: 'primary' },
    { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', source: 'TechCrunch', section: 'AI', tier: 'media' },
    { url: 'https://venturebeat.com/category/ai/feed/',      source: 'VentureBeat',   section: 'AI',   tier: 'media' },
    { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', source: 'The Verge AI', section: 'AI', tier: 'media' },
    { url: 'https://www.technologyreview.com/feed/',         source: 'MIT Tech Review', section: 'AI',     tier: 'media' },
    { url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml',   source: 'ITmedia AI＋',   section: 'AI',   tier: 'media' },
    // --- テクノロジー（一般テック。一部は汎用フィードのため aiFilter で過剰ノイズを抑制）---
    { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica', section: 'テクノロジー', tier: 'media' },
    { url: 'https://www.theverge.com/rss/index.xml',         source: 'The Verge',     section: 'テクノロジー', tier: 'media' },
    { url: 'https://www.wired.com/feed/rss',                 source: 'WIRED',         section: 'テクノロジー', tier: 'media' },
    { url: 'https://www.engadget.com/rss.xml',               source: 'Engadget',      section: 'テクノロジー', tier: 'media' },
    { url: 'https://github.blog/feed/',                      source: 'GitHub Blog',   section: 'テクノロジー', tier: 'media', aiFilter: true },
    { url: 'https://aws.amazon.com/blogs/machine-learning/feed/', source: 'AWS ML Blog', section: 'テクノロジー', tier: 'media', aiFilter: true },
    { url: 'https://devblogs.microsoft.com/feed/',          source: 'Microsoft Dev', section: 'テクノロジー', tier: 'media', aiFilter: true },
    { url: 'https://stackoverflow.blog/feed/',              source: 'Stack Overflow', section: 'テクノロジー', tier: 'media', aiFilter: true },
    { url: 'https://blogs.nvidia.com/feed/',                source: 'NVIDIA',        section: 'テクノロジー', tier: 'media', aiFilter: true },
    { url: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss', source: 'IEEE Spectrum', section: 'テクノロジー', tier: 'media', aiFilter: true },
    // --- サイエンス（自然科学）---
    { url: 'https://www.quantamagazine.org/feed/',          source: 'Quanta',        section: 'サイエンス', tier: 'media' },
    { url: 'https://www.sciencedaily.com/rss/all.xml',      source: 'ScienceDaily',  section: 'サイエンス', tier: 'media' },
    { url: 'https://phys.org/rss-feed/',                    source: 'Phys.org',      section: 'サイエンス', tier: 'media' },
    { url: 'https://www.nasa.gov/feed/',                    source: 'NASA',          section: 'サイエンス', tier: 'media' },
    { url: 'https://www.nature.com/nature.rss',            source: 'Nature',        section: 'サイエンス', tier: 'media' },
    // --- ビジネス ---
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business', section: 'ビジネス', tier: 'media' },
    { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC', section: 'ビジネス', tier: 'media' },
    { url: 'https://www.theguardian.com/uk/business/rss',   source: 'The Guardian',  section: 'ビジネス', tier: 'media' },
    { url: 'https://rss.itmedia.co.jp/rss/2.0/business.xml', source: 'ITmedia ビジネス', section: 'ビジネス', tier: 'media' },
    // --- 経済・マネー ---
    { url: 'https://www.economist.com/finance-and-economics/rss.xml', source: 'The Economist', section: '経済・マネー', tier: 'media' },
    { url: 'https://www.theguardian.com/money/rss',        source: 'The Guardian',  section: '経済・マネー', tier: 'media' },
    // --- 政治 ---
    { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', source: 'BBC Politics', section: '政治', tier: 'media' },
    { url: 'https://www.theguardian.com/politics/rss',     source: 'The Guardian',  section: '政治', tier: 'media' },
    { url: 'https://www.nhk.or.jp/rss/news/cat4.xml',      source: 'NHK',           section: '政治', tier: 'media' },
    { url: 'https://rss.politico.com/politics-news.xml',   source: 'Politico',      section: '政治', tier: 'media' },
    // --- 国際・地政学 ---
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',  source: 'BBC World',     section: '国際・地政学', tier: 'media' },
    { url: 'https://www.theguardian.com/world/rss',       source: 'The Guardian',  section: '国際・地政学', tier: 'media' },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml',   source: 'Al Jazeera',    section: '国際・地政学', tier: 'media' },
    { url: 'https://foreignpolicy.com/feed/',             source: 'Foreign Policy', section: '国際・地政学', tier: 'media' },
    { url: 'https://www.nhk.or.jp/rss/news/cat6.xml',     source: 'NHK',           section: '国際・地政学', tier: 'media' },
    // --- カルチャー（アート・文化）---
    { url: 'https://www.theguardian.com/culture/rss',     source: 'The Guardian',  section: 'カルチャー', tier: 'media' },
    { url: 'https://hyperallergic.com/feed/',             source: 'Hyperallergic', section: 'カルチャー', tier: 'media' },
    { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', source: 'BBC Arts', section: 'カルチャー', tier: 'media' },
    // --- エンタメ ---
    { url: 'https://variety.com/feed/',                   source: 'Variety',       section: 'エンタメ', tier: 'media' },
    { url: 'https://www.theguardian.com/film/rss',        source: 'The Guardian',  section: 'エンタメ', tier: 'media' },
    { url: 'https://pitchfork.com/feed/feed-news/rss',    source: 'Pitchfork',     section: 'エンタメ', tier: 'media' },
    // --- ライフ・キャリア（ライフスタイル・キャリア・教育）---
    { url: 'https://www.theguardian.com/lifeandstyle/rss', source: 'The Guardian', section: 'ライフ・キャリア', tier: 'media' },
    { url: 'https://www.theguardian.com/education/rss',   source: 'The Guardian',  section: 'ライフ・キャリア', tier: 'media' },
    { url: 'https://lifehacker.com/rss',                  source: 'Lifehacker',    section: 'ライフ・キャリア', tier: 'media' },
  ],

  // CSS抽象サムネのフォールバック候補（styles.css のクラス）
  thumbVariants: ['thumb--blue', 'thumb--amber', 'thumb--violet', 'thumb--teal', 'thumb--rose', 'thumb--lime'],

  // 公式プレス画像（image.kind === 'press'）のクレジット接頭辞。表示は「<label>: <credit>」。
  pressCreditLabel: '提供',
  // フッター・免責ページに出す商標／非提携の注記（各社共通ルール「提携・推奨を示唆しない」対応）。
  // 画像ごとには出さず、サイトに1回だけ控えめに置く（読者の信頼を損ねないため）。
  trademarkNotice: '各社の名称・ロゴ・画像は各権利者に帰属します。当サイトは独立した報道・論評メディアであり、各社との提携・協賛・推奨を示すものではありません。',

  // ナビのセクション（表示順）。slug はセクションページのファイル名 sections/<slug>.html。
  // hue: セクション別アクセント色相（OKLCH の H・0-360）。チップの色分けで回遊の道標にする。
  // 総合ニュース化に伴い、AI専門の旧セクション（基盤モデル/研究/開発/産業応用/規制・倫理/スタートアップ/
  // ハードウェア）を総合構成へ再編。空ページ回避のため各セクションに rssFeeds の実ソースを割り当て済み。
  // 教育・キャリア・お金・アートは独立させずライフ・キャリア／経済・マネー／カルチャーへ統合（育てば分割）。
  // 記事の section 値は自由なので、ここに無いセクション（旧記事の値など）の記事ページも生成される。
  navSections: [
    { name: 'AI', slug: 'ai', hue: 220 },                  // 電子ブルー（ブランド基調・heritage）
    { name: 'テクノロジー', slug: 'tech', hue: 250 },        // ブルーバイオレット
    { name: 'サイエンス', slug: 'science', hue: 285 },       // バイオレット
    { name: 'ビジネス', slug: 'business', hue: 145 },        // グリーン
    { name: '経済・マネー', slug: 'economy', hue: 170 },      // ティールグリーン
    { name: '政治', slug: 'politics', hue: 10 },            // レッド寄り
    { name: '国際・地政学', slug: 'world', hue: 35 },         // アンバー
    { name: 'カルチャー', slug: 'culture', hue: 320 },        // マゼンタ
    { name: 'エンタメ', slug: 'entertainment', hue: 300 },    // パープルピンク
    { name: 'ライフ・キャリア', slug: 'life', hue: 100 },      // ライムグリーン
  ],

  // 旧カテゴリ → navSections への正規化マップ。リブランド前のAI細分類（レガシー）を
  // navSections の「AI」へ寄せる。取り込み時（ingestDrafts）と一括移行（migrate-sections）で
  // 適用し、旧ラベルは記事のタグに退避して回遊性・粒度を保つ。新規の総合記事は影響を受けない。
  sectionAliases: {
    '産業応用': 'AI',
    '研究': 'AI',
    '基盤モデル': 'AI',
    '規制・倫理': 'AI',
    'スタートアップ': 'AI',
    'ハードウェア': 'AI',
    '開発': 'AI',
  },

  // ====================================================================
  // 自己改善ハーネス（MVP）— 評価・品質ゲートの設定。詳細は SPEC.md「自己改善」。
  // ====================================================================

  // --- 不変条項（constitution）---
  // 自己改善（将来の外ループ）が「決して弱められない核」。判定プロンプトにも提示し、
  // 違反する下書きは veto する。ここを緩める変更はレビューで必ず弾く。
  constitution: [
    '事実忠実性: 出典に書かれていない事実・数値・固有名詞を創作しない。不明は書かない。',
    '数値の保全: 金額・倍率・パーセント・日付の桁や単位を勝手に変えない。',
    'アグリゲーター型: 全文転載・長い引用をしない。短い独自要約＋中立論評にとどめる。',
    '中立トーン: 誇張・煽り・断定的な賛否を避け、落ち着いた報道トーンを保つ。',
    '出典明示: 各記事は一次情報の要約・論評であり、出典リンクを必ず伴う。',
  ],

  // --- ロック対象（lockedDecisions）---
  // 文字列レベルで固定し、退行（誤って変更/削除されること）を check.js で検知する。
  // 「必ず生成記事HTMLに現れるべき文言」を入れる。
  lockedDecisions: [
    // 署名表記はユーザー判断により現状維持（自己改善エージェントも変更しない）。
    'AI 自動要約 + 人手編集',
  ],

  // --- 採点ルブリック（rubric）---
  // 別モデル judge（judgeModel）が各下書きを 1〜5 で採点する次元。表示順＝重要度の目安。
  // ※ これは「可変パラメータ」だが、constitution を弱める方向の改変はレビューで弾く。
  rubric: [
    { key: 'faithfulness', label: '事実忠実性', desc: '出典と突き合わせ、事実・数値・固有名詞が正確か。捏造・歪曲がないか。' },
    { key: 'structure',    label: '構成',       desc: '「前半=何が起きたか／後半=なぜ重要か」の二部構成で読みやすいか。' },
    { key: 'neutrality',   label: '中立性',     desc: '誇張・煽りがなく、落ち着いた中立の報道トーンか。' },
    { key: 'headline',     label: '見出し・リード', desc: '具体的で釣り見出しでない。内容を正確に表すか。' },
    { key: 'originality',  label: '独自性',     desc: '全文の焼き直しでなく、独自の要約＋論評になっているか。' },
    { key: 'japanese',     label: '日本語',     desc: '自然で崩れのない日本語か（英単語混入・誤用がないか）。' },
  ],

  // --- 客観指標のしきい値（qualityThresholds）---
  // 重要: これらは「床（ガードレール）」であって最大化目標ではない。逸脱は警告止まりにし、
  // 機械的に数値へ最適化（水増し/切り詰め）しないこと。hard-fail はスキーマ等の整合性のみ。
  qualityThresholds: {
    headlineMax: 40,   // 見出し文字数の上限（超過は警告）
    leadMax: 80,       // リード文字数の上限（超過は警告）
    bodyMin: 450,      // 本文の下限の目安（下回ると警告）
    bodyMax: 900,      // 本文の上限の目安（上回ると警告）
    tagsMin: 3,        // タグ数の下限（下回ると警告）
    tagsMax: 5,        // タグ数の上限（超過は警告）
    dupJaccardMax: 0.6, // 直近記事との「見出し＋タグ」トークン Jaccard 類似度の警告閾値
    recentWindow: 30,  // 重複話題チェックで参照する直近記事数
  },

  // --- 執筆モデル（writerModel）---
  // 記事はRSSの要約＋中立論評（翻訳・要約タスク）なので安価な Haiku で量産する（約30本/日）。
  // auto-generate.sh の writer 起動が --model でこれを使う。
  writerModel: process.env.WRITER_MODEL || 'claude-haiku-4-5-20251001',

  // --- 判定モデル（judgeModel）---
  // judge は自己相関を下げるため writer と別モデルを使う（ハーネスの不変条件「writer≠judge」）。
  // writer=Haiku のため judge は一段上の Sonnet にする：安いHaikuで量産→賢いSonnetが事実誤り・
  // 中立性を独立検証して弾く分業。judge は triage で高リスク下書きのみ実行するためコスト増は小。
  // CLI で利用できない場合はスクリプト側でフォールバック（judge をスキップし客観ゲートのみ）。
  judgeModel: process.env.JUDGE_MODEL || 'claude-sonnet-4-6',
};
