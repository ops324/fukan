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
  maxArticles: Number(process.env.MAX_ARTICLES || 2), // 1回で「掲載する」本数（×3回/日 = 6本/日）
  candidatePool: 12,    // Claude に提示する候補プール数（この中から重要度で maxArticles 本を選別）
  importanceFloor: 3,   // 重要度(1-5)がこれ未満の候補は掲載しない（些末ネタの除外）
  retentionTop: 40,     // トップページに載せる最新記事の上限。超過分はアーカイブへ

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
  ],

  // CSS抽象サムネのフォールバック候補（styles.css のクラス）
  thumbVariants: ['thumb--blue', 'thumb--amber', 'thumb--violet', 'thumb--teal', 'thumb--rose', 'thumb--lime'],

  // 公式プレス画像（image.kind === 'press'）のクレジット接頭辞。表示は「<label>: <credit>」。
  pressCreditLabel: '提供',
  // 公式プレス画像に自動付与する非推奨の注記。各社共通の「提携・推奨を示唆しない」ルールに対応。
  pressDisclaimer: '報道目的の引用・提携/推奨を示すものではありません',

  // ナビのセクション（表示順）。slug はセクションページのファイル名 sections/<slug>.html。
  // hue: セクション別アクセント色相（OKLCH の H・0-360）。チップの色分けで回遊の道標にする。
  navSections: [
    { name: '基盤モデル', slug: 'foundation', hue: 220 },   // 電子ブルー（ブランド基調）
    { name: '研究', slug: 'research', hue: 285 },           // バイオレット
    { name: '産業応用', slug: 'industry', hue: 180 },        // ティール
    { name: '規制・倫理', slug: 'regulation', hue: 35 },     // アンバー寄り（速報レッドと差別化）
    { name: 'スタートアップ', slug: 'startups', hue: 145 },   // グリーン
    { name: 'ハードウェア', slug: 'hardware', hue: 65 },      // ゴールド
    { name: 'オピニオン', slug: 'opinion', hue: 330 },        // ローズ
    { name: 'データ', slug: 'data', hue: 250 },              // インディゴ
  ],
};
