<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/rss/channel">
    <html lang="ja">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title><xsl:value-of select="title"/> — RSS フィード</title>
      <style>
        :root { color-scheme: dark; }
        body { margin:0; background:#0b0e1a; color:#f4f1ea;
          font-family:'Hiragino Kaku Gothic ProN','Yu Gothic',system-ui,sans-serif; line-height:1.7; }
        .wrap { max-width:760px; margin:0 auto; padding:48px 24px 96px; }
        .brand { font-family:Georgia,serif; font-size:30px; font-weight:600; letter-spacing:-0.02em; }
        .brand em { color:#7fb6ff; font-style:normal; }
        .eyebrow { color:#7fb6ff; letter-spacing:0.3em; text-transform:uppercase; font-size:12px; font-weight:600; }
        .note { background:#14182a; border:1px solid #2a3050; border-radius:6px; padding:16px 18px; margin:24px 0 8px; font-size:14px; color:#cfd6e4; }
        .note a, a { color:#7fb6ff; }
        h1 { font-size:22px; margin:18px 0 4px; }
        .desc { color:#aab2c5; font-size:15px; }
        .item { padding:20px 0; border-bottom:1px solid #222842; }
        .item a.t { color:#f4f1ea; font-size:18px; font-weight:600; text-decoration:none; }
        .item a.t:hover { color:#7fb6ff; }
        .item p { margin:6px 0 0; color:#aab2c5; font-size:14px; }
        .meta { margin-top:8px; color:#7d8597; font-size:12px; font-family:ui-monospace,monospace; }
        .back { display:inline-block; margin-top:28px; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="eyebrow">RSS Feed</div>
        <div class="brand">AXIOM<em>·</em>AI</div>
        <h1><xsl:value-of select="title"/> の最新記事</h1>
        <p class="desc"><xsl:value-of select="description"/></p>
        <div class="note">
          これは <strong>RSSフィード</strong> です。Feedly・Inoreader などの
          <strong>フィードリーダー</strong>にこのページのURLを登録すると、新着記事を自動で受け取れます。
          記事をそのまま読むなら <a href="/">サイトトップ</a> へ。
        </div>
        <xsl:for-each select="item">
          <div class="item">
            <a class="t"><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a>
            <p><xsl:value-of select="description"/></p>
            <div class="meta"><xsl:value-of select="category"/> · <xsl:value-of select="pubDate"/></div>
          </div>
        </xsl:for-each>
        <a class="back" href="/">← AXIOM AI トップへ戻る</a>
      </div>
    </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
