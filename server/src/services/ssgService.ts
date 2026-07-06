import path from 'path';
import fs from 'fs';
import { getDatabase } from '../db/index.js';

const CLIENT_DIST = path.resolve(process.cwd(), '../client/dist');
const TEMPLATE_FILE = 'index.base.html';

interface SeoPage {
  path: string;
  title: string;
  description: string;
  keywords: string;
  og_title: string;
  og_description: string;
  og_image: string;
  canonical: string;
  no_index: number;
  json_ld: string;
}

interface HomeModule {
  id: string;
  icon: string;
  title: string;
  description: string;
  path: string;
  require_auth: number;
  featured: number;
  category: string;
  image_url: string;
  bg_color: string;
  grid_span: string;
}

interface HomeFeed {
  id: string;
  title: string;
  author: string;
  icon: string;
  bg_color: string;
  avatar_color: string;
  link: string;
  likes: number;
  image_height: number;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSeoMetaTags(page: SeoPage | null, globals: Record<string, string>, pagePath: string, locale?: string): string {
  const siteUrl = globals.site_url || '';
  const siteName = globals.site_name || 'QiaoNan';
  const title = page?.title || `${siteName} - AI 效率工具平台`;
  const description = page?.description || globals.site_description || '';
  const ogImage = page?.og_image || globals.default_og_image || '';
  const canonical = page?.canonical || (siteUrl ? `${siteUrl}${pagePath}` : '');

  // Determine locale from parameter or path
  const resolvedLocale = locale || (pagePath.startsWith('/en') ? 'en' : 'zh');

  let meta = `<title>${escapeHtml(title)}</title>\n`;
  meta += `    <meta name="description" content="${escapeHtml(description)}" />\n`;
  if (page?.keywords) meta += `    <meta name="keywords" content="${escapeHtml(page.keywords)}" />\n`;
  if (canonical) meta += `    <link rel="canonical" href="${escapeHtml(canonical)}" />\n`;
  if (page?.no_index) meta += `    <meta name="robots" content="noindex,nofollow" />\n`;

  meta += `    <meta property="og:title" content="${escapeHtml(page?.og_title || title)}" />\n`;
  meta += `    <meta property="og:description" content="${escapeHtml(page?.og_description || description)}" />\n`;
  meta += `    <meta property="og:type" content="website" />\n`;
  if (siteUrl) meta += `    <meta property="og:url" content="${escapeHtml(siteUrl + pagePath)}" />\n`;
  if (ogImage) meta += `    <meta property="og:image" content="${escapeHtml(ogImage)}" />\n`;
  meta += `    <meta property="og:site_name" content="${escapeHtml(siteName)}" />\n`;
  meta += `    <meta property="og:locale" content="${resolvedLocale === 'zh' ? 'zh_CN' : 'en_US'}" />\n`;
  meta += `    <meta property="og:locale:alternate" content="${resolvedLocale === 'zh' ? 'en_US' : 'zh_CN'}" />\n`;

  meta += `    <meta name="twitter:card" content="summary_large_image" />\n`;
  meta += `    <meta name="twitter:title" content="${escapeHtml(page?.og_title || title)}" />\n`;
  meta += `    <meta name="twitter:description" content="${escapeHtml(page?.og_description || description)}" />\n`;
  if (ogImage) meta += `    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />\n`;

  if (globals.google_verification) meta += `    <meta name="google-site-verification" content="${escapeHtml(globals.google_verification)}" />\n`;
  if (globals.bing_verification) meta += `    <meta name="msvalidate.01" content="${escapeHtml(globals.bing_verification)}" />\n`;

  if (page?.json_ld) {
    const safeJsonLd = page.json_ld.replace(/<\//g, '<\\/');
    meta += `    <script type="application/ld+json">${safeJsonLd}</script>\n`;
  }

  return meta;
}

interface DiscoverFeedItem {
  slug: string;
  icon: string;
  bg_color: string;
  avatar_color: string;
  author: string;
  title: string;
  summary: string;
}

function getHomepageCriticalCss(): string {
  return `<style id="ssg-critical-css">
#ssg-content { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; margin-top: 50px; }
#ssg-content .bento-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); grid-auto-rows: 240px; gap: 24px; width: 100%; }
#ssg-content .bento-card { position: relative; border: none; border-radius: 10px; background: #fff; overflow: hidden; text-decoration: none; color: inherit; display: flex; flex-direction: column; box-shadow: 0 8px 24px rgba(0,0,0,0.02), 0 2px 8px rgba(0,0,0,0.02); }
#ssg-content .bento-span-2x2 { grid-column: span 2; grid-row: span 2; }
#ssg-content .bento-span-2x1 { grid-column: span 2; }
#ssg-content .bento-span-1x2 { grid-row: span 2; }
#ssg-content .card-bg { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 0; pointer-events: none; }
#ssg-content .bg-image { width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; }
#ssg-content .bg-pattern { width: 100%; height: 100%; position: absolute; top: 0; left: 0; opacity: 0.8; }
#ssg-content .card-content { position: relative; z-index: 1; display: flex; flex-direction: column; height: 100%; padding: 24px; }
#ssg-content .card-title { font-size: 18px; font-weight: 700; margin: 0; color: #111827; }
#ssg-content .card-desc { font-size: 14px; color: #6b7280; line-height: 1.5; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#ssg-content .card-header .icon { font-size: 28px; }
#ssg-content .card-body { margin-top: auto; }
#ssg-content .ultra-wide-feed { margin-top: 64px; }
#ssg-content .feed-header { margin-bottom: 40px; }
#ssg-content .feed-title { font-size: 56px; font-weight: 900; margin: 0 0 4px; letter-spacing: -2px; text-transform: uppercase; color: #111827; }
#ssg-content .feed-subtitle { color: #3b5bdb; text-transform: uppercase; letter-spacing: 4px; font-size: 12px; font-weight: 600; }
#ssg-content .feed-masonry { columns: 1; column-gap: 20px; }
@media (min-width: 640px) { #ssg-content .feed-masonry { columns: 2; } }
@media (min-width: 1024px) { #ssg-content .feed-masonry { columns: 3; } }
@media (min-width: 1440px) { #ssg-content .feed-masonry { columns: 4; } }
#ssg-content .feed-card { display: block; text-decoration: none; color: inherit; break-inside: avoid; margin-bottom: 24px; }
#ssg-content .feed-image { width: 100%; display: flex; align-items: center; justify-content: center; font-size: 56px; border-radius: 10px; overflow: hidden; margin-bottom: 12px; border: 1px solid rgba(0,0,0,0.04); }
#ssg-content .feed-emoji { font-size: 56px; }
#ssg-content .feed-info { padding: 0 4px; }
#ssg-content .feed-text { font-size: 14px; font-weight: 500; line-height: 1.5; margin: 0 0 8px; color: #111827; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#ssg-content .feed-meta { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #6b7280; }
#ssg-content .feed-author { display: flex; align-items: center; gap: 6px; }
#ssg-content .author-avatar { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05); }
#ssg-content footer { margin-top: 64px; padding: 24px 0; text-align: center; font-size: 13px; color: #9ca3af; }
@media (max-width: 900px) { #ssg-content .bento-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); } #ssg-content .bento-span-2x2, #ssg-content .bento-span-2x1, #ssg-content .bento-span-1x2 { grid-column: span 1; grid-row: span 1; } }
</style>`;
}

function getDiscoverListCriticalCss(): string {
  return `<style id="ssg-critical-css">
#ssg-content { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1100px; margin: 0 auto; padding: 100px 24px 80px; }
#ssg-content .discover-header { margin-bottom: 32px; }
#ssg-content .discover-title { font-size: 48px; font-weight: 900; margin: 0 0 8px; letter-spacing: -2px; color: #111827; }
#ssg-content .discover-subtitle { font-size: 16px; color: #6b7280; margin: 0; }
#ssg-content .topic-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 1px solid rgba(0,0,0,0.06); }
#ssg-content .topic-tag { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 500; text-decoration: none; color: #4b5563; background: #f3f4f6; border: 1px solid rgba(0,0,0,0.04); }
#ssg-content .topic-tag.active { background: #4361EE; color: #fff; border-color: #4361EE; }
#ssg-content .articles-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 28px; }
#ssg-content .article-card { border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.03); }
#ssg-content .article-link { display: block; text-decoration: none; color: inherit; }
#ssg-content .article-cover { width: 100%; height: 200px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
#ssg-content .cover-img { width: 100%; height: 100%; object-fit: cover; }
#ssg-content .cover-icon { font-size: 48px; }
#ssg-content .article-info { padding: 20px; }
#ssg-content .article-title { font-size: 17px; font-weight: 700; margin: 0 0 8px; color: #111827; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#ssg-content .article-summary { font-size: 14px; color: #6b7280; margin: 0 0 12px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#ssg-content .article-meta { display: flex; align-items: center; }
#ssg-content .article-author { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b7280; }
#ssg-content .author-avatar { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05); }
@media (max-width: 768px) { #ssg-content { padding: 88px 16px 56px; } #ssg-content .discover-title { font-size: 32px; } #ssg-content .articles-grid { grid-template-columns: 1fr; gap: 20px; } #ssg-content .article-cover { height: 160px; } }
</style>`;
}

function renderHomepageContent(modules: HomeModule[], feeds: HomeFeed[], discoverArticles: DiscoverFeedItem[] = []): string {
  const moduleCards = modules.map(item => {
    const spanClass = item.grid_span === '2x2' ? 'bento-span-2x2' :
      item.grid_span === '2x1' ? 'bento-span-2x1' :
      item.grid_span === '1x2' ? 'bento-span-1x2' : '';
    const featuredClass = item.featured ? 'is-featured' : '';

    return `      <a href="${escapeHtml(item.path)}" class="bento-card ${spanClass} ${featuredClass}">
        <div class="card-bg">
          ${item.image_url
            ? `<img src="${escapeHtml(item.image_url)}" class="bg-image" alt="${escapeHtml(item.title)}" />`
            : `<div class="bg-pattern" style="background: ${escapeHtml(item.bg_color || '#f8faff')}"></div>`
          }
        </div>
        <div class="card-content">
          <div class="card-header">
            <span class="icon">${escapeHtml(item.icon)}</span>
          </div>
          <div class="card-body">
            <h2 class="card-title">${escapeHtml(item.title)}</h2>
            <p class="card-desc">${escapeHtml(item.description)}</p>
          </div>
          ${item.featured ? `<div class="card-footer"><span class="meta-tag">${escapeHtml(item.category || 'Tool')}</span><span class="arrow">→</span></div>` : ''}
        </div>
      </a>`;
  }).join('\n');

  const articleCards = discoverArticles.map(article => {
    if (!article.title) return '';
    return `        <a href="/discover/${escapeHtml(article.slug)}" class="feed-card">
          <div class="feed-image" style="height: 220px; background: ${escapeHtml(article.bg_color)}">
            <span class="feed-emoji">${escapeHtml(article.icon)}</span>
          </div>
          <div class="feed-info">
            <h3 class="feed-text">${escapeHtml(article.title)}</h3>
            <div class="feed-meta">
              <div class="feed-author">
                <div class="author-avatar" style="background: ${escapeHtml(article.avatar_color)}"></div>
                <span>${escapeHtml(article.author)}</span>
              </div>
            </div>
          </div>
        </a>`;
  }).filter(Boolean).join('\n');

  const feedCards = feeds.map(feed => {
    const tag = feed.link ? 'a' : 'div';
    const hrefAttr = feed.link ? ` href="${escapeHtml(feed.link)}" target="_blank"` : '';
    return `        <${tag}${hrefAttr} class="feed-card">
          <div class="feed-image" style="height: ${feed.image_height}px; background: ${escapeHtml(feed.bg_color)}">
            <span class="feed-emoji">${escapeHtml(feed.icon)}</span>
          </div>
          <div class="feed-info">
            <h3 class="feed-text">${escapeHtml(feed.title)}</h3>
            <div class="feed-meta">
              <div class="feed-author">
                <div class="author-avatar" style="background: ${escapeHtml(feed.avatar_color)}"></div>
                <span>${escapeHtml(feed.author)}</span>
              </div>
              <div class="feed-likes">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                <span>${feed.likes}</span>
              </div>
            </div>
          </div>
        </${tag}>`;
  }).join('\n');

  const allFeedCards = articleCards + (articleCards && feedCards ? '\n' : '') + feedCards;
  const hasFeedContent = feeds.length > 0 || discoverArticles.length > 0;

  return `
    <div class="ssg-home-content" id="ssg-content">
      <main>
        <nav class="bento-grid">
${moduleCards}
        </nav>
        ${hasFeedContent ? `
        <div class="ultra-wide-feed">
          <div class="feed-header">
            <h2 class="feed-title">DISCOVER</h2>
            <span class="feed-subtitle">Personalized Content Recommendations</span>
          </div>
          <div class="feed-masonry">
${allFeedCards}
          </div>
        </div>` : ''}
      </main>
      <footer>
        <p>&copy; ${new Date().getFullYear()} QiaoNan. All rights reserved.</p>
      </footer>
    </div>`;
}

function renderDiscoverListContent(articles: Array<{ slug: string; icon: string; bg_color: string; avatar_color: string; author: string; cover_image: string; title: string; summary: string }>, topics: Array<{ slug: string; title: string }>, locale: string): string {
  const topicTags = topics.map(t =>
    `        <a href="${locale === 'en' ? `/en/discover/topic/${escapeHtml(t.slug)}` : `/discover/topic/${escapeHtml(t.slug)}`}" class="topic-tag">${escapeHtml(t.title || t.slug)}</a>`
  ).join('\n');

  const articleCards = articles.map(a => {
    if (!a.title) return '';
    const link = locale === 'en' ? `/en/discover/${escapeHtml(a.slug)}` : `/discover/${escapeHtml(a.slug)}`;
    const coverHtml = a.cover_image
      ? `<img src="${escapeHtml(a.cover_image)}" class="cover-img" alt="" loading="lazy" />`
      : `<span class="cover-icon">${escapeHtml(a.icon)}</span>`;
    return `        <article class="article-card">
          <a href="${link}" class="article-link">
            <div class="article-cover" style="background: ${escapeHtml(a.bg_color || '#f0f5ff')}">
              ${coverHtml}
            </div>
            <div class="article-info">
              <h2 class="article-title">${escapeHtml(a.title)}</h2>
              ${a.summary ? `<p class="article-summary">${escapeHtml(a.summary)}</p>` : ''}
              ${a.author ? `<div class="article-meta"><div class="article-author"><div class="author-avatar" style="background: ${escapeHtml(a.avatar_color || '#0077ff')}"></div><span>${escapeHtml(a.author)}</span></div></div>` : ''}
            </div>
          </a>
        </article>`;
  }).filter(Boolean).join('\n');

  return `
    <div class="ssg-discover-content" id="ssg-content">
      <main class="discover-main">
        <header class="discover-header">
          <h1 class="discover-title">${locale === 'en' ? 'Discover' : '发现'}</h1>
          <p class="discover-subtitle">${locale === 'en' ? 'Explore all articles and topics' : '浏览全部文章与专题'}</p>
        </header>
        ${topics.length > 0 ? `<nav class="topic-filters">
        <a href="${locale === 'en' ? '/en/discover' : '/discover'}" class="topic-tag active">${locale === 'en' ? 'All' : '全部'}</a>
${topicTags}
        </nav>` : ''}
        <div class="articles-grid">
${articleCards}
        </div>
      </main>
    </div>`;
}

export interface SSGResult {
  success: boolean;
  generated: string[];
  errors: string[];
  outputDir: string;
}

interface DiscoverArticle {
  id: string;
  slug: string;
  cover_image: string;
  author: string;
  icon: string;
  bg_color: string;
  avatar_color: string;
  visible_locales: string;
  created_at: string;
  updated_at: string;
}

interface DiscoverArticleContent {
  locale: string;
  title: string;
  summary: string;
  content: string;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
}

function getBaseTemplate(): string | null {
  const templatePath = path.join(CLIENT_DIST, TEMPLATE_FILE);
  const indexPath = path.join(CLIENT_DIST, 'index.html');

  // If base template already exists, use it
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf-8');
  }

  // First time: backup original index.html as base template
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf-8');
    fs.writeFileSync(templatePath, html, 'utf-8');
    return html;
  }

  return null;
}

export function generateStaticPages(): SSGResult {
  const result: SSGResult = { success: true, generated: [], errors: [], outputDir: CLIENT_DIST };

  if (!fs.existsSync(CLIENT_DIST)) {
    result.success = false;
    result.errors.push('client/dist/ not found. Run client build first.');
    return result;
  }

  const baseHtml = getBaseTemplate();
  if (!baseHtml) {
    result.success = false;
    result.errors.push('index.html template not found. Run client build first.');
    return result;
  }

  const db = getDatabase();
  const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const globals: Record<string, string> = {};
  for (const r of globalRows) globals[r.key] = r.value;

  const seoPages = db.prepare('SELECT * FROM seo_pages ORDER BY path').all() as SeoPage[];

  // Generate homepage — zh (/) and en (/en) with hreflang
  const homepageLocales: Array<{ locale: string; pagePath: string; outputFile: string }> = [
    { locale: 'zh', pagePath: '/', outputFile: 'index.html' },
    { locale: 'en', pagePath: '/en', outputFile: 'en/index.html' },
  ];

  const siteUrl = globals.site_url || '';
  const modules = db.prepare('SELECT * FROM home_modules WHERE visible = 1 ORDER BY sort_order ASC, created_at ASC').all() as HomeModule[];
  const feeds = db.prepare('SELECT * FROM home_feeds WHERE visible = 1 ORDER BY sort_order ASC, created_at DESC').all() as HomeFeed[];

  for (const hp of homepageLocales) {
    try {
      const homeSeo = seoPages.find(p => p.path === '/' && (p as any).locale === hp.locale)
        || seoPages.find(p => p.path === hp.pagePath)
        || seoPages.find(p => p.path === '/')
        || null;

      const discoverArticles = db.prepare(`
        SELECT a.slug, a.icon, a.bg_color, a.avatar_color, a.author, c.title, c.summary
        FROM discover_articles a
        LEFT JOIN discover_article_contents c ON c.article_id = a.id AND c.locale = ?
        WHERE a.status = 'published' AND a.visible_locales LIKE '%"' || ? || '"%'
        ORDER BY a.sort_order ASC, a.created_at DESC
      `).all(hp.locale, hp.locale) as DiscoverFeedItem[];

      let html = baseHtml;
      const metaTags = buildSeoMetaTags(homeSeo, globals, hp.pagePath);
      const hreflangTags = `    <link rel="alternate" hreflang="zh" href="${escapeHtml(siteUrl)}/" />\n    <link rel="alternate" hreflang="en" href="${escapeHtml(siteUrl)}/en" />\n    <link rel="alternate" hreflang="x-default" href="${escapeHtml(siteUrl)}/" />\n`;
      html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags);

      const homepageContent = renderHomepageContent(modules, feeds, discoverArticles);
      html = html.replace('</head>', `${getHomepageCriticalCss()}\n</head>`);
      html = html.replace('<div id="app"></div>', `<div id="app">${homepageContent}</div>`);

      const outputPath = path.join(CLIENT_DIST, hp.outputFile);
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, html, 'utf-8');
      result.generated.push(hp.pagePath);
    } catch (e: any) {
      result.errors.push(`${hp.pagePath}: ${e.message}`);
    }
  }

  // Generate discover list pages — /discover and /en/discover
  const discoverLocales: Array<{ locale: string; pagePath: string; outputFile: string }> = [
    { locale: 'zh', pagePath: '/discover', outputFile: 'discover/index.html' },
    { locale: 'en', pagePath: '/en/discover', outputFile: 'en/discover/index.html' },
  ];

  for (const dl of discoverLocales) {
    try {
      const discoverSeo = seoPages.find(p => p.path === '/discover' && (p as any).locale === dl.locale)
        || seoPages.find(p => p.path === '/discover')
        || null;

      const discoverArticles = db.prepare(`
        SELECT a.slug, a.icon, a.bg_color, a.avatar_color, a.author, a.cover_image, c.title, c.summary
        FROM discover_articles a
        LEFT JOIN discover_article_contents c ON c.article_id = a.id AND c.locale = ?
        WHERE a.status = 'published' AND a.visible_locales LIKE '%"' || ? || '"%'
        ORDER BY a.sort_order ASC, a.created_at DESC
      `).all(dl.locale, dl.locale) as Array<{ slug: string; icon: string; bg_color: string; avatar_color: string; author: string; cover_image: string; title: string; summary: string }>;

      const discoverTopics = db.prepare(`
        SELECT t.slug, c.title
        FROM discover_topics t
        LEFT JOIN discover_topic_contents c ON c.topic_id = t.id AND c.locale = ?
        WHERE t.status = 'published' AND t.visible_locales LIKE '%"' || ? || '"%'
        ORDER BY t.sort_order ASC
      `).all(dl.locale, dl.locale) as Array<{ slug: string; title: string }>;

      let html = baseHtml;
      const metaTags = buildSeoMetaTags(discoverSeo, globals, dl.pagePath);
      const hreflangTags = `    <link rel="alternate" hreflang="zh" href="${escapeHtml(siteUrl)}/discover" />\n    <link rel="alternate" hreflang="en" href="${escapeHtml(siteUrl)}/en/discover" />\n    <link rel="alternate" hreflang="x-default" href="${escapeHtml(siteUrl)}/discover" />\n`;
      html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags);

      const discoverContent = renderDiscoverListContent(discoverArticles, discoverTopics, dl.locale);
      html = html.replace('</head>', `${getDiscoverListCriticalCss()}\n</head>`);
      html = html.replace('<div id="app"></div>', `<div id="app">${discoverContent}</div>`);

      const outputPath = path.join(CLIENT_DIST, dl.outputFile);
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, html, 'utf-8');
      result.generated.push(dl.pagePath);
    } catch (e: any) {
      result.errors.push(`${dl.pagePath}: ${e.message}`);
    }
  }

  // Generate sub-pages — write to client/dist/{path}/index.html
  // Group pages by path to generate locale variants
  const pagesByPath: Record<string, SeoPage[]> = {};
  for (const page of seoPages) {
    if (page.path === '/') continue;
    if (!pagesByPath[page.path]) pagesByPath[page.path] = [];
    pagesByPath[page.path].push(page);
  }

  for (const [pagePath, localePages] of Object.entries(pagesByPath)) {
    for (const page of localePages) {
      const locale = (page as any).locale || 'zh';
      try {
        let html = baseHtml;
        const outputPath = locale === 'zh' ? pagePath : `/en${pagePath}`;
        const metaTags = buildSeoMetaTags(page, globals, outputPath);

        const zhPage = localePages.find((p: any) => (p as any).locale === 'zh' || !(p as any).locale);
        const enPage = localePages.find((p: any) => (p as any).locale === 'en');
        let hreflangTags = '';
        if (zhPage && enPage) {
          hreflangTags = `    <link rel="alternate" hreflang="zh" href="${escapeHtml(siteUrl)}${pagePath}" />\n`;
          hreflangTags += `    <link rel="alternate" hreflang="en" href="${escapeHtml(siteUrl)}/en${pagePath}" />\n`;
          hreflangTags += `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(siteUrl)}${pagePath}" />\n`;
        }

        html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags);

        const diskPath = outputPath.replace(/^\//, '');
        const dir = path.join(CLIENT_DIST, diskPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
        result.generated.push(outputPath);
      } catch (e: any) {
        result.errors.push(`${pagePath} (${locale}): ${e.message}`);
      }
    }
  }

  // Generate robots.txt and sitemap.xml
  const sitemapResult = regenerateSitemapAndRobots();
  result.generated.push(...sitemapResult.generated);
  result.errors.push(...sitemapResult.errors);

  if (result.errors.length > 0) {
    result.success = false;
  }

  return result;
}

interface RecommendedItem {
  slug: string;
  icon: string;
  bg_color: string;
  author: string;
  title: string;
  summary: string;
}

function renderArticleContent(article: DiscoverArticle, content: DiscoverArticleContent, locale: string, recommendations: RecommendedItem[] = []): string {
  const recsHtml = recommendations.length > 0 ? `
        <section class="article-recommendations">
          <h2>${locale === 'en' ? 'Recommended' : '热门推荐'}</h2>
          <div class="rec-grid">
${recommendations.map(r => `            <a href="${locale === 'zh' ? `/discover/${escapeHtml(r.slug)}` : `/${locale}/discover/${escapeHtml(r.slug)}`}" class="rec-card">
              <div class="rec-icon" style="background: ${escapeHtml(r.bg_color)}">${escapeHtml(r.icon)}</div>
              <div class="rec-info">
                <h3>${escapeHtml(r.title)}</h3>
                <p>${escapeHtml(r.summary || '')}</p>
              </div>
            </a>`).join('\n')}
          </div>
        </section>` : '';

  return `
    <div class="ssg-article-content" id="ssg-content">
      <main>
        <article class="discover-article">
          <header class="article-header">
            <h1>${escapeHtml(content.title)}</h1>
            <div class="article-meta">
              <span class="article-author">${escapeHtml(article.author)}</span>
            </div>
          </header>
          <div class="article-body">${content.content}</div>
${recsHtml}
        </article>
      </main>
    </div>`;
}

export function deleteArticleStaticPages(slug: string, locales: string[]): { deleted: string[], errors: string[] } {
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const locale of locales) {
    const pagePath = locale === 'zh' ? `discover/${slug}` : `${locale}/discover/${slug}`;
    const dir = path.join(CLIENT_DIST, pagePath);

    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
        deleted.push(`/${pagePath}`);
      }
    } catch (e: any) {
      errors.push(`${pagePath}: ${e.message}`);
    }
  }

  return { deleted, errors };
}

interface DiscoverTopic {
  id: string;
  slug: string;
  cover_image: string;
  icon: string;
  bg_color: string;
  template: string;
  visible_locales: string;
}

interface DiscoverTopicContent {
  locale: string;
  title: string;
  description: string;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
}

function renderTopicContent(topic: DiscoverTopic, content: DiscoverTopicContent, locale: string, articles: Array<{ slug: string; icon: string; bg_color: string; avatar_color: string; author: string; title: string; summary: string }>): string {
  const articlesHtml = articles.map(a => `            <a href="${locale === 'zh' ? `/discover/${escapeHtml(a.slug)}` : `/${locale}/discover/${escapeHtml(a.slug)}`}" class="topic-article-card">
              <div class="topic-article-icon" style="background: ${escapeHtml(a.bg_color)}">${escapeHtml(a.icon)}</div>
              <div class="topic-article-info">
                <h3>${escapeHtml(a.title)}</h3>
                <p>${escapeHtml(a.summary || '')}</p>
                <span class="topic-article-author">${escapeHtml(a.author)}</span>
              </div>
            </a>`).join('\n');

  return `
    <div class="ssg-topic-content" id="ssg-content">
      <div class="topic-page">
        <header class="topic-header" style="background: ${escapeHtml(topic.bg_color)}">
          ${topic.cover_image ? `<img src="${escapeHtml(topic.cover_image)}" class="topic-cover" alt="${escapeHtml(content.title)}" />` : ''}
          <div class="topic-header-content">
            ${topic.icon ? `<span class="topic-icon">${escapeHtml(topic.icon)}</span>` : ''}
            <h1>${escapeHtml(content.title)}</h1>
            <p class="topic-desc">${escapeHtml(content.description)}</p>
          </div>
        </header>
        <section class="topic-articles">
          <div class="topic-articles-grid">
${articlesHtml}
          </div>
        </section>
      </div>
    </div>`;
}

export function deleteTopicStaticPages(slug: string, locales: string[]): { deleted: string[], errors: string[] } {
  const deleted: string[] = [];
  const errors: string[] = [];

  for (const locale of locales) {
    const pagePath = locale === 'zh' ? `discover/topic/${slug}` : `${locale}/discover/topic/${slug}`;
    const dir = path.join(CLIENT_DIST, pagePath);

    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
        deleted.push(`/${pagePath}`);
      }
    } catch (e: any) {
      errors.push(`${pagePath}: ${e.message}`);
    }
  }

  return { deleted, errors };
}

export function generateTopicPage(topic: DiscoverTopic, contents: DiscoverTopicContent[], locales: string[]): SSGResult {
  const result: SSGResult = { success: true, generated: [], errors: [], outputDir: CLIENT_DIST };

  if (!fs.existsSync(CLIENT_DIST)) {
    result.success = false;
    result.errors.push('client/dist/ not found. Run client build first.');
    return result;
  }

  const baseHtml = getBaseTemplate();
  if (!baseHtml) {
    result.success = false;
    result.errors.push('index.html template not found. Run client build first.');
    return result;
  }

  const db = getDatabase();
  const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const globals: Record<string, string> = {};
  for (const r of globalRows) globals[r.key] = r.value;

  const siteUrl = globals.site_url || '';

  for (const locale of locales) {
    const content = contents.find(c => c.locale === locale);
    if (!content || !content.title) continue;

    const articles = db.prepare(`
      SELECT a.slug, a.icon, a.bg_color, a.avatar_color, a.author, ac.title, ac.summary
      FROM discover_articles a
      LEFT JOIN discover_article_contents ac ON ac.article_id = a.id AND ac.locale = ?
      WHERE a.topic_id = ? AND a.status = 'published'
        AND a.visible_locales LIKE '%"' || ? || '"%'
      ORDER BY a.sort_order ASC, a.created_at DESC
    `).all(locale, topic.id, locale) as Array<{ slug: string; icon: string; bg_color: string; avatar_color: string; author: string; title: string; summary: string }>;

    try {
      const isDefault = locale === 'zh';
      const pagePath = isDefault
        ? `/discover/topic/${topic.slug}`
        : `/${locale}/discover/topic/${topic.slug}`;

      const seoPage: SeoPage = {
        path: pagePath,
        title: content.seo_title || content.title,
        description: content.seo_description || content.description,
        keywords: content.seo_keywords || '',
        og_title: content.seo_title || content.title,
        og_description: content.seo_description || content.description,
        og_image: topic.cover_image || '',
        canonical: siteUrl ? `${siteUrl}${pagePath}` : '',
        no_index: 0,
        json_ld: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          'name': content.title,
          'description': content.description,
        }),
      };

      let html = baseHtml;
      const metaTags = buildSeoMetaTags(seoPage, globals, pagePath);

      let hreflangTags = '';
      const zhContent = contents.find(c => c.locale === 'zh');
      const enContent = contents.find(c => c.locale === 'en');
      if (zhContent && locales.includes('zh')) {
        hreflangTags += `    <link rel="alternate" hreflang="zh" href="${escapeHtml(siteUrl)}/discover/topic/${topic.slug}" />\n`;
      }
      if (enContent && locales.includes('en')) {
        hreflangTags += `    <link rel="alternate" hreflang="en" href="${escapeHtml(siteUrl)}/en/discover/topic/${topic.slug}" />\n`;
      }
      hreflangTags += `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(siteUrl)}/discover/topic/${topic.slug}" />\n`;

      const topicBreadcrumbLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': locale === 'zh' ? '首页' : 'Home', 'item': siteUrl + (locale === 'zh' ? '/' : '/en') },
          { '@type': 'ListItem', 'position': 2, 'name': 'Discover', 'item': siteUrl + (locale === 'zh' ? '/discover' : '/en/discover') },
          { '@type': 'ListItem', 'position': 3, 'name': content.title },
        ],
      });
      const topicBreadcrumbScript = `    <script type="application/ld+json">${topicBreadcrumbLd.replace(/<\//g, '<\\/')}</script>\n`;

      html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags + topicBreadcrumbScript);

      const topicHtml = renderTopicContent(topic, content, locale, articles);
      html = html.replace('<div id="app"></div>', `<div id="app">${topicHtml}</div>`);

      const dir = path.join(CLIENT_DIST, pagePath.replace(/^\//, ''));
      const resolved = path.resolve(dir);
      if (!resolved.startsWith(path.resolve(CLIENT_DIST))) {
        throw new Error('Invalid slug: path traversal detected');
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
      result.generated.push(pagePath);
    } catch (e: any) {
      result.errors.push(`${locale}: ${e.message}`);
    }
  }

  // Auto-update sitemap when a topic is generated
  regenerateSitemapAndRobots();

  if (result.errors.length > 0) {
    result.success = false;
  }

  return result;
}

export function generateArticlePage(article: DiscoverArticle, contents: DiscoverArticleContent[], locales: string[]): SSGResult {
  const result: SSGResult = { success: true, generated: [], errors: [], outputDir: CLIENT_DIST };

  if (!fs.existsSync(CLIENT_DIST)) {
    result.success = false;
    result.errors.push('client/dist/ not found. Run client build first.');
    return result;
  }

  const baseHtml = getBaseTemplate();
  if (!baseHtml) {
    result.success = false;
    result.errors.push('index.html template not found. Run client build first.');
    return result;
  }

  const db = getDatabase();
  const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const globals: Record<string, string> = {};
  for (const r of globalRows) globals[r.key] = r.value;

  const siteUrl = globals.site_url || '';

  for (const locale of locales) {
    const content = contents.find(c => c.locale === locale);
    if (!content || !content.title) continue;

    const recommendations = db.prepare(`
      SELECT ra.slug, ra.icon, ra.bg_color, ra.author, rc.title, rc.summary
      FROM discover_article_recommendations r
      JOIN discover_articles ra ON ra.id = r.recommended_article_id AND ra.status = 'published'
      LEFT JOIN discover_article_contents rc ON rc.article_id = ra.id AND rc.locale = ?
      WHERE r.article_id = ? AND r.locale = ?
      ORDER BY r.sort_order ASC
      LIMIT 5
    `).all(locale, article.id, locale) as RecommendedItem[];

    try {
      const isDefault = locale === 'zh';
      const pagePath = isDefault
        ? `/discover/${article.slug}`
        : `/${locale}/discover/${article.slug}`;

      const alternatePath = isDefault
        ? `/en/discover/${article.slug}`
        : `/discover/${article.slug}`;

      const seoPage: SeoPage = {
        path: pagePath,
        title: content.seo_title || content.title,
        description: content.seo_description || content.summary,
        keywords: content.seo_keywords || '',
        og_title: content.seo_title || content.title,
        og_description: content.seo_description || content.summary,
        og_image: article.cover_image || '',
        canonical: siteUrl ? `${siteUrl}${pagePath}` : '',
        no_index: 0,
        json_ld: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          'headline': content.title,
          'description': content.seo_description || content.summary,
          'author': { '@type': 'Person', 'name': article.author || 'QiaoNan' },
          'publisher': {
            '@type': 'Organization',
            'name': 'QiaoNan',
            'logo': { '@type': 'ImageObject', 'url': siteUrl + '/logo.png' },
          },
          'datePublished': article.created_at,
          'dateModified': article.updated_at,
          'image': article.cover_image || siteUrl + '/og-default.png',
          'mainEntityOfPage': { '@type': 'WebPage', '@id': siteUrl + pagePath },
        }),
      };

      let html = baseHtml;
      const metaTags = buildSeoMetaTags(seoPage, globals, pagePath);

      let hreflangTags = '';
      const zhContent = contents.find(c => c.locale === 'zh');
      const enContent = contents.find(c => c.locale === 'en');
      if (zhContent && locales.includes('zh')) {
        hreflangTags += `    <link rel="alternate" hreflang="zh" href="${escapeHtml(siteUrl)}/discover/${article.slug}" />\n`;
      }
      if (enContent && locales.includes('en')) {
        hreflangTags += `    <link rel="alternate" hreflang="en" href="${escapeHtml(siteUrl)}/en/discover/${article.slug}" />\n`;
      }
      hreflangTags += `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(siteUrl)}/discover/${article.slug}" />\n`;

      const breadcrumbLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': locale === 'zh' ? '首页' : 'Home', 'item': siteUrl + (locale === 'zh' ? '/' : '/en') },
          { '@type': 'ListItem', 'position': 2, 'name': 'Discover', 'item': siteUrl + (locale === 'zh' ? '/discover' : '/en/discover') },
          { '@type': 'ListItem', 'position': 3, 'name': content.title },
        ],
      });
      const breadcrumbScript = `    <script type="application/ld+json">${breadcrumbLd.replace(/<\//g, '<\\/')}</script>\n`;

      html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags + breadcrumbScript);

      const articleHtml = renderArticleContent(article, content, locale, recommendations);
      html = html.replace('<div id="app"></div>', `<div id="app">${articleHtml}</div>`);

      const dir = path.join(CLIENT_DIST, pagePath.replace(/^\//, ''));
      const resolved = path.resolve(dir);
      if (!resolved.startsWith(path.resolve(CLIENT_DIST))) {
        throw new Error('Invalid slug: path traversal detected');
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
      result.generated.push(pagePath);
    } catch (e: any) {
      result.errors.push(`${locale}: ${e.message}`);
    }
  }

  // Auto-update sitemap when an article is generated
  regenerateSitemapAndRobots();

  if (result.errors.length > 0) {
    result.success = false;
  }

  return result;
}

export function renderDynamicPageHtml(reqPath: string): string | null {
  const baseHtml = getBaseTemplate();
  if (!baseHtml) return null;

  const db = getDatabase();
  const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const globals: Record<string, string> = {};
  for (const r of globalRows) globals[r.key] = r.value;
  const siteUrl = globals.site_url || '';

  const normalizedPath = reqPath.replace(/\/+$/, '');

  // Match article: /discover/:slug or /en/discover/:slug (but not /discover/topic/...)
  const articleMatch = normalizedPath.match(/^(?:\/(en))?\/discover\/(?!topic\/)([^/]+)$/);
  if (articleMatch) {
    const locale = articleMatch[1] || 'zh';
    const slug = articleMatch[2];

    const article = db.prepare(`
      SELECT a.* FROM discover_articles a WHERE a.slug = ? AND a.status = 'published'
    `).get(slug) as DiscoverArticle | undefined;
    if (!article) return null;

    const content = db.prepare(`
      SELECT * FROM discover_article_contents WHERE article_id = ? AND locale = ?
    `).get(article.id, locale) as DiscoverArticleContent | undefined;
    if (!content || !content.title) return null;

    const recommendations = db.prepare(`
      SELECT ra.slug, ra.icon, ra.bg_color, ra.author, rc.title, rc.summary
      FROM discover_article_recommendations r
      JOIN discover_articles ra ON ra.id = r.recommended_article_id AND ra.status = 'published'
      LEFT JOIN discover_article_contents rc ON rc.article_id = ra.id AND rc.locale = ?
      WHERE r.article_id = ? AND r.locale = ?
      ORDER BY r.sort_order ASC LIMIT 5
    `).all(locale, article.id, locale) as RecommendedItem[];

    const pagePath = locale === 'zh' ? `/discover/${slug}` : `/${locale}/discover/${slug}`;
    const seoPage: SeoPage = {
      path: pagePath,
      title: content.seo_title || content.title,
      description: content.seo_description || content.summary,
      keywords: content.seo_keywords || '',
      og_title: content.seo_title || content.title,
      og_description: content.seo_description || content.summary,
      og_image: article.cover_image || '',
      canonical: siteUrl ? `${siteUrl}${pagePath}` : '',
      no_index: 0,
      json_ld: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': content.title,
        'description': content.seo_description || content.summary,
        'author': { '@type': 'Person', 'name': article.author || 'QiaoNan' },
        'datePublished': article.created_at,
        'dateModified': article.updated_at,
        'image': article.cover_image || siteUrl + '/og-default.png',
      }),
    };

    let html = baseHtml;
    html = html.replace(/<title>.*?<\/title>/, buildSeoMetaTags(seoPage, globals, pagePath));
    const articleHtml = renderArticleContent(article, content, locale, recommendations);
    html = html.replace('<div id="app"></div>', `<div id="app">${articleHtml}</div>`);
    return html;
  }

  // Match topic: /discover/topic/:slug or /en/discover/topic/:slug
  const topicMatch = normalizedPath.match(/^(?:\/(en))?\/discover\/topic\/([^/]+)$/);
  if (topicMatch) {
    const locale = topicMatch[1] || 'zh';
    const slug = topicMatch[2];

    const topic = db.prepare(`
      SELECT * FROM discover_topics WHERE slug = ? AND status = 'published'
    `).get(slug) as DiscoverTopic | undefined;
    if (!topic) return null;

    const content = db.prepare(`
      SELECT * FROM discover_topic_contents WHERE topic_id = ? AND locale = ?
    `).get(topic.id, locale) as DiscoverTopicContent | undefined;
    if (!content || !content.title) return null;

    const articles = db.prepare(`
      SELECT a.slug, a.icon, a.bg_color, a.avatar_color, a.author, ac.title, ac.summary
      FROM discover_articles a
      LEFT JOIN discover_article_contents ac ON ac.article_id = a.id AND ac.locale = ?
      WHERE a.topic_id = ? AND a.status = 'published'
        AND a.visible_locales LIKE '%"' || ? || '"%'
      ORDER BY a.sort_order ASC, a.created_at DESC
    `).all(locale, topic.id, locale) as Array<{ slug: string; icon: string; bg_color: string; avatar_color: string; author: string; title: string; summary: string }>;

    const pagePath = locale === 'zh' ? `/discover/topic/${slug}` : `/${locale}/discover/topic/${slug}`;
    const seoPage: SeoPage = {
      path: pagePath,
      title: content.seo_title || content.title,
      description: content.seo_description || content.description,
      keywords: content.seo_keywords || '',
      og_title: content.seo_title || content.title,
      og_description: content.seo_description || content.description,
      og_image: topic.cover_image || '',
      canonical: siteUrl ? `${siteUrl}${pagePath}` : '',
      no_index: 0,
      json_ld: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        'name': content.title,
        'description': content.description,
      }),
    };

    let html = baseHtml;
    html = html.replace(/<title>.*?<\/title>/, buildSeoMetaTags(seoPage, globals, pagePath));
    const topicHtml = renderTopicContent(topic, content, locale, articles);
    html = html.replace('<div id="app"></div>', `<div id="app">${topicHtml}</div>`);
    return html;
  }

  return null;
}

export function regenerateSitemapAndRobots(): { generated: string[]; errors: string[] } {
  const generated: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(CLIENT_DIST)) {
    errors.push('client/dist/ not found.');
    return { generated, errors };
  }

  const db = getDatabase();
  const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const globals: Record<string, string> = {};
  for (const r of globalRows) globals[r.key] = r.value;
  const siteUrl = globals.site_url || 'https://www.qiaonan.vip';

  // robots.txt
  try {
    const robotsTxt = `User-agent: *
Allow: /
Allow: /api/discover/
Allow: /api/seo/
Allow: /api/home/
Allow: /api/analytics/pageview
Disallow: /api/
Disallow: /admin/
Disallow: /settings/
Disallow: /synap/

Sitemap: ${siteUrl}/sitemap.xml
`;
    fs.writeFileSync(path.join(CLIENT_DIST, 'robots.txt'), robotsTxt, 'utf-8');
    generated.push('/robots.txt');
  } catch (e: any) {
    errors.push(`/robots.txt: ${e.message}`);
  }

  // sitemap.xml
  try {
    const indexablePages = db.prepare(
      'SELECT path, locale, priority, changefreq, updated_at FROM seo_pages WHERE no_index = 0 ORDER BY priority DESC'
    ).all() as Array<{ path: string; locale: string; priority: number; changefreq: string; updated_at: string }>;

    const urls = indexablePages.map(p => {
      const fullPath = (p.locale && p.locale !== 'zh') ? `/en${p.path}` : p.path;
      return `  <url>
    <loc>${siteUrl}${fullPath}</loc>
    <lastmod>${p.updated_at.split('T')[0]}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`;
    }).join('\n');

    const publishedArticles = db.prepare(`
      SELECT slug, visible_locales, updated_at FROM discover_articles
      WHERE status = 'published' AND visible_locales != '[]'
      ORDER BY sort_order ASC
    `).all() as Array<{ slug: string; visible_locales: string; updated_at: string }>;

    const enHomepageUrl = `  <url>
    <loc>${siteUrl}/en</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;

    const discoverListUrls = `  <url>
    <loc>${siteUrl}/discover</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${siteUrl}/en/discover</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;

    const articleUrls = publishedArticles.flatMap(a => {
      const locales: string[] = JSON.parse(a.visible_locales || '[]');
      return locales.map(locale => {
        const articlePath = locale === 'zh' ? `/discover/${a.slug}` : `/${locale}/discover/${a.slug}`;
        return `  <url>
    <loc>${siteUrl}${articlePath}</loc>
    <lastmod>${a.updated_at.split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
      });
    }).join('\n');

    const publishedTopics = db.prepare(`
      SELECT slug, visible_locales, updated_at FROM discover_topics
      WHERE status = 'published' AND visible_locales != '[]'
      ORDER BY sort_order ASC
    `).all() as Array<{ slug: string; visible_locales: string; updated_at: string }>;

    const topicUrls = publishedTopics.flatMap(t => {
      const locales: string[] = JSON.parse(t.visible_locales || '[]');
      return locales.map(locale => {
        const topicPath = locale === 'zh' ? `/discover/topic/${t.slug}` : `/${locale}/discover/topic/${t.slug}`;
        return `  <url>
    <loc>${siteUrl}${topicPath}</loc>
    <lastmod>${t.updated_at.split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
      });
    }).join('\n');

    const privacyTermsUrls = `  <url>
    <loc>${siteUrl}/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${siteUrl}/en/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${siteUrl}/terms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${siteUrl}/en/terms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>`;

    const allUrls = [urls, enHomepageUrl, discoverListUrls, topicUrls, articleUrls, privacyTermsUrls].filter(Boolean).join('\n');

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls}
</urlset>`;
    fs.writeFileSync(path.join(CLIENT_DIST, 'sitemap.xml'), sitemapXml, 'utf-8');
    generated.push('/sitemap.xml');
  } catch (e: any) {
    errors.push(`/sitemap.xml: ${e.message}`);
  }

  return { generated, errors };
}

