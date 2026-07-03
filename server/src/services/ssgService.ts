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

function buildSeoMetaTags(page: SeoPage | null, globals: Record<string, string>, pagePath: string): string {
  const siteUrl = globals.site_url || '';
  const siteName = globals.site_name || 'QiaoNan';
  const title = page?.title || `${siteName} - AI 效率工具平台`;
  const description = page?.description || globals.site_description || '';
  const ogImage = page?.og_image || globals.default_og_image || '';
  const canonical = page?.canonical || (siteUrl ? `${siteUrl}${pagePath}` : '');

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

  meta += `    <meta name="twitter:card" content="summary_large_image" />\n`;
  meta += `    <meta name="twitter:title" content="${escapeHtml(page?.og_title || title)}" />\n`;
  meta += `    <meta name="twitter:description" content="${escapeHtml(page?.og_description || description)}" />\n`;
  if (ogImage) meta += `    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />\n`;

  if (globals.google_verification) meta += `    <meta name="google-site-verification" content="${escapeHtml(globals.google_verification)}" />\n`;
  if (globals.bing_verification) meta += `    <meta name="msvalidate.01" content="${escapeHtml(globals.bing_verification)}" />\n`;

  if (page?.json_ld) meta += `    <script type="application/ld+json">${page.json_ld}</script>\n`;

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
            <span class="icon">${item.icon}</span>
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
            <span class="feed-emoji">${article.icon}</span>
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
            <span class="feed-emoji">${feed.icon}</span>
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
      <div class="bento-grid">
${moduleCards}
      </div>
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
      const homeSeo = seoPages.find(p => p.path === hp.pagePath) || seoPages.find(p => p.path === '/') || null;

      const discoverArticles = db.prepare(`
        SELECT a.slug, a.icon, a.bg_color, a.avatar_color, a.author, c.title, c.summary
        FROM discover_articles a
        LEFT JOIN discover_article_contents c ON c.article_id = a.id AND c.locale = ?
        WHERE a.status = 'published' AND a.visible_locales LIKE '%"' || ? || '"%'
        ORDER BY a.sort_order ASC, a.created_at DESC
      `).all(hp.locale, hp.locale) as DiscoverFeedItem[];

      let html = baseHtml;
      const metaTags = buildSeoMetaTags(homeSeo, globals, hp.pagePath);
      const hreflangTags = `    <link rel="alternate" hreflang="zh" href="${escapeHtml(siteUrl)}/" />\n    <link rel="alternate" hreflang="en" href="${escapeHtml(siteUrl)}/en" />\n`;
      html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags);

      const homepageContent = renderHomepageContent(modules, feeds, discoverArticles);
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

  // Generate sub-pages — write to client/dist/{path}/index.html
  for (const page of seoPages) {
    if (page.path === '/') continue;

    try {
      let html = baseHtml;
      const metaTags = buildSeoMetaTags(page, globals, page.path);
      html = html.replace(/<title>.*?<\/title>/, metaTags);

      const pagePath = page.path.replace(/^\//, '');
      const dir = path.join(CLIENT_DIST, pagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
      result.generated.push(page.path);
    } catch (e: any) {
      result.errors.push(`${page.path}: ${e.message}`);
    }
  }

  // Generate robots.txt
  try {
    const siteUrl = globals.site_url || 'https://your-domain.com';
    const robotsTxt = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /settings/
Disallow: /synap/

Sitemap: ${siteUrl}/sitemap.xml
`;
    fs.writeFileSync(path.join(CLIENT_DIST, 'robots.txt'), robotsTxt, 'utf-8');
    result.generated.push('/robots.txt');
  } catch (e: any) {
    result.errors.push(`/robots.txt: ${e.message}`);
  }

  // Generate sitemap.xml
  try {
    const siteUrl = globals.site_url || 'https://your-domain.com';
    const indexablePages = db.prepare(
      'SELECT path, priority, changefreq, updated_at FROM seo_pages WHERE no_index = 0 ORDER BY priority DESC'
    ).all() as Array<{ path: string; priority: number; changefreq: string; updated_at: string }>;

    const urls = indexablePages.map(p => `  <url>
    <loc>${siteUrl}${p.path}</loc>
    <lastmod>${p.updated_at.split('T')[0]}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

    // Include discover articles in sitemap
    const publishedArticles = db.prepare(`
      SELECT slug, visible_locales, updated_at FROM discover_articles
      WHERE status = 'published' AND visible_locales != '[]'
      ORDER BY sort_order ASC
    `).all() as Array<{ slug: string; visible_locales: string; updated_at: string }>;

    // English homepage
    const enHomepageUrl = `  <url>
    <loc>${siteUrl}/en</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;

    const articleUrls = publishedArticles.flatMap(a => {
      const locales: string[] = JSON.parse(a.visible_locales || '[]');
      return locales.map(locale => {
        const articlePath = locale === 'zh' ? `/discover/${a.slug}` : `/${locale}/discover/${a.slug}`;
        return `  <url>
    <loc>${siteUrl}${articlePath}</loc>
    <lastmod>${a.updated_at.split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
      });
    }).join('\n');

    const allUrls = [urls, enHomepageUrl, articleUrls].filter(Boolean).join('\n');

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls}
</urlset>`;
    fs.writeFileSync(path.join(CLIENT_DIST, 'sitemap.xml'), sitemapXml, 'utf-8');
    result.generated.push('/sitemap.xml');
  } catch (e: any) {
    result.errors.push(`/sitemap.xml: ${e.message}`);
  }

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
              <div class="rec-icon" style="background: ${escapeHtml(r.bg_color)}">${r.icon}</div>
              <div class="rec-info">
                <h3>${escapeHtml(r.title)}</h3>
                <p>${escapeHtml(r.summary || '')}</p>
              </div>
            </a>`).join('\n')}
          </div>
        </section>` : '';

  return `
    <div class="ssg-article-content" id="ssg-content">
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
    </div>`;
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
          'author': { '@type': 'Person', 'name': article.author },
          'description': content.summary,
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

      html = html.replace(/<title>.*?<\/title>/, metaTags + hreflangTags);

      const articleHtml = renderArticleContent(article, content, locale, recommendations);
      html = html.replace('<div id="app"></div>', `<div id="app">${articleHtml}</div>`);

      const dir = path.join(CLIENT_DIST, pagePath.replace(/^\//, ''));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
      result.generated.push(pagePath);
    } catch (e: any) {
      result.errors.push(`${locale}: ${e.message}`);
    }
  }

  if (result.errors.length > 0) {
    result.success = false;
  }

  return result;
}

