// パイプライン全体の設定。ソース・モデル・件数などはここで調整する。
import 'dotenv/config';

export const config = {
  // 本番URL（共有リンク・検索・解析・SEOで使用。末尾スラッシュなし）
  siteUrl: process.env.SITE_URL || 'https://axiom-ai-xi.vercel.app',

  // --- サイトメタ（SEO / OGP / 構造化データで使用）---
  siteName: 'AXIOM AI',
  siteDescription: '生成AI・基盤モデル・規制・産業応用の最新ニュースを、編集部の要約と論評でお届けする日本語AI専門メディア。',
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
  maxArticles: Number(process.env.MAX_ARTICLES || 5), // 1回の「掲載上限」本数（床を越えた分だけ＝可変。×3回/日で約10〜15本/日）
  candidatePool: 30,    // Claude に提示する候補プール数（この中から重要度で maxArticles 本まで選別）。
                        // 12 では primary(一次情報)で満杯になり media/新ソースが writer に届かないため拡大。
  importanceFloor: 3,   // 重要度(1-5)がこれ未満の候補は掲載しない（些末ネタの除外）
  retentionTop: 40,     // トップページに載せる最新記事の上限。超過分はアーカイブへ
  heroRecencyHours: 24, // ヒーロー（トップ最上段）は直近この時間内の最重要記事から選ぶ。
                        // 古い高importance記事がトップに居座り停滞するのを防ぐ。
                        // ウィンドウ内に記事が無ければ従来どおり全体の最重要をヒーローに（保険）。

  // --- AI関連度フィルタ（media tier の無関係なテック記事を足切り）---
  // title+summary にこれらのいずれかが含まれる数を数える。primary は常に通す。
  aiKeywords: [
    'AI', 'A.I.', '人工知能', 'LLM', '大規模言語', '生成', 'ジェネレーティブ', 'generative',
    'モデル', 'model', 'エージェント', 'agent', 'GPT', 'Gemini', 'Claude', 'Llama', 'Grok',
    '機械学習', 'machine learning', 'ディープラーニング', 'deep learning', 'ニューラル', 'neural',
    'OpenAI', 'Anthropic', 'DeepMind', 'Hugging Face', 'チャットボット', 'chatbot',
    'マルチモーダル', 'multimodal', '推論', 'inference', '学習', 'training', 'GPU', 'NVIDIA',
    'トランスフォーマー', 'transformer', 'プロンプト', 'prompt', 'RAG', '基盤モデル', 'foundation model',
  ],
  relevanceFloorMedia: 1, // media tier はキーワードヒットがこの数未満なら除外

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
  imageProvider: process.env.IMAGE_PROVIDER || 'unsplash', // 'unsplash' | 'pexels'
  unsplashKey: process.env.UNSPLASH_KEY || '',
  pexelsKey: process.env.PEXELS_KEY || '',

  // --- ニュース補助ソース（任意・キーがあれば使用）---
  newsapiKey: process.env.NEWSAPI_KEY || '',
  gnewsKey: process.env.GNEWS_KEY || '',
  tavilyKey: process.env.TAVILY_KEY || '',

  // --- RSS（キー不要・主力ソース）---
  // AI関連の公式/メディアRSS。増やす場合はここに追加。
  // tier: 'primary'=企業公式の一次情報（優先）／'media'=報道メディア（補助・要裏取り）
  rssFeeds: [
    { url: 'https://openai.com/news/rss.xml',                source: 'OpenAI',        section: '基盤モデル', tier: 'primary' },
    { url: 'https://blog.google/technology/ai/rss/',         source: 'Google AI',     section: '研究',       tier: 'primary' },
    { url: 'https://huggingface.co/blog/feed.xml',           source: 'Hugging Face',  section: '研究',       tier: 'primary' },
    { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', source: 'TechCrunch', section: 'スタートアップ', tier: 'media' },
    { url: 'https://venturebeat.com/category/ai/feed/',      source: 'VentureBeat',   section: '産業応用',   tier: 'media' },
    { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', source: 'The Verge', section: '産業応用', tier: 'media' },
    { url: 'https://www.technologyreview.com/feed/',         source: 'MIT Tech Review', section: '研究',     tier: 'media' },
    { url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml',   source: 'ITmedia AI＋',   section: '産業応用',   tier: 'media' },
    // --- 開発（AIコーディング・エージェント開発・開発者向けAI活用）---
    // 汎用ソースだが aiKeywords フィルタ（media tier）で非AI記事は自動足切りされる。
    { url: 'https://github.blog/feed/',                      source: 'GitHub Blog',   section: '開発',       tier: 'media' },
    { url: 'https://aws.amazon.com/blogs/machine-learning/feed/', source: 'AWS ML Blog', section: '開発',    tier: 'media' },
    { url: 'https://devblogs.microsoft.com/feed/',          source: 'Microsoft Dev', section: '開発',       tier: 'media' },
    { url: 'https://stackoverflow.blog/feed/',              source: 'Stack Overflow', section: '開発',      tier: 'media' },
    // --- ハードウェア（GPU・半導体・AI計算基盤）---
    { url: 'https://blogs.nvidia.com/feed/',                source: 'NVIDIA',        section: 'ハードウェア', tier: 'media' },
    { url: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss', source: 'IEEE Spectrum', section: 'ハードウェア', tier: 'media' },
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
  // オピニオン/データは継続的なソースを確保しにくく記事0が続いたため、空ページを出さないようナビから除外。
  // 規制・倫理は専用ソースが乏しいが writer が既存media（policy系記事）から内容で分類して埋める。
  // コンテンツが育てば再追加する（記事の section 値は自由なので、ここに無いセクションの記事も記事ページは生成される）。
  navSections: [
    { name: '基盤モデル', slug: 'foundation', hue: 220 },   // 電子ブルー（ブランド基調）
    { name: '研究', slug: 'research', hue: 285 },           // バイオレット
    { name: '開発', slug: 'dev', hue: 330 },                // ローズ（AIコーディング・開発者向けAI活用）
    { name: '産業応用', slug: 'industry', hue: 180 },        // ティール
    { name: '規制・倫理', slug: 'regulation', hue: 35 },     // アンバー寄り（速報レッドと差別化）
    { name: 'スタートアップ', slug: 'startups', hue: 145 },   // グリーン
    { name: 'ハードウェア', slug: 'hardware', hue: 65 },      // ゴールド
  ],

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

  // --- 判定モデル（judgeModel）---
  // writer は既定の Opus。judge は自己相関を下げるため別モデルを使う。
  // トークン削減のため既定は Haiku（writer=Opus と別モデルである＝相関を下げる目的は維持）。
  // CLI で利用できない場合はスクリプト側でフォールバック（judge をスキップし客観ゲートのみ）。
  judgeModel: process.env.JUDGE_MODEL || 'claude-haiku-4-5-20251001',
};
