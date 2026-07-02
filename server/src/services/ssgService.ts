import path from 'path';
import fs from 'fs';
import { getDatabase } from '../db/index.js';

const SSG_OUTPUT_DIR = path.resolve(process.cwd(), '../client/dist/ssg');

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

function renderHomepageContent(modules: HomeModule[], feeds: HomeFeed[]): string {
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

  return `
    <div class="ssg-home-content" id="ssg-content">
      <div class="bento-grid">
${moduleCards}
      </div>
      ${feeds.length > 0 ? `
      <div class="ultra-wide-feed">
        <div class="feed-header">
          <h2 class="feed-title">DISCOVER</h2>
          <span class="feed-subtitle">Personalized Content Recommendations</span>
        </div>
        <div class="feed-masonry">
${feedCards}
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

export function generateStaticPages(): SSGResult {
  const result: SSGResult = { success: true, generated: [], errors: [], outputDir: SSG_OUTPUT_DIR };

  const clientDistPath = path.resolve(process.cwd(), '../client/dist');
  const templatePath = path.join(clientDistPath, 'index.html');

  if (!fs.existsSync(templatePath)) {
    result.success = false;
    result.errors.push('index.html template not found. Run client build first.');
    return result;
  }

  const baseHtml = fs.readFileSync(templatePath, 'utf-8');

  if (!fs.existsSync(SSG_OUTPUT_DIR)) {
    fs.mkdirSync(SSG_OUTPUT_DIR, { recursive: true });
  }

  const db = getDatabase();
  const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const globals: Record<string, string> = {};
  for (const r of globalRows) globals[r.key] = r.value;

  const seoPages = db.prepare('SELECT * FROM seo_pages ORDER BY path').all() as SeoPage[];

  // Generate homepage with full DOM content
  try {
    const homeSeo = seoPages.find(p => p.path === '/') || null;
    const modules = db.prepare('SELECT * FROM home_modules WHERE visible = 1 ORDER BY sort_order ASC, created_at ASC').all() as HomeModule[];
    const feeds = db.prepare('SELECT * FROM home_feeds WHERE visible = 1 ORDER BY sort_order ASC, created_at DESC').all() as HomeFeed[];

    let html = baseHtml;
    const metaTags = buildSeoMetaTags(homeSeo, globals, '/');
    html = html.replace(/<title>.*?<\/title>/, metaTags);

    const homepageContent = renderHomepageContent(modules, feeds);
    html = html.replace('<div id="app"></div>', `<div id="app">${homepageContent}</div>`);

    fs.writeFileSync(path.join(SSG_OUTPUT_DIR, 'index.html'), html, 'utf-8');
    result.generated.push('/');
  } catch (e: any) {
    result.errors.push(`/ : ${e.message}`);
  }

  // Generate sub-pages with SEO meta only
  for (const page of seoPages) {
    if (page.path === '/') continue;

    try {
      let html = baseHtml;
      const metaTags = buildSeoMetaTags(page, globals, page.path);
      html = html.replace(/<title>.*?<\/title>/, metaTags);

      const pagePath = page.path.replace(/^\//, '');
      const dir = path.join(SSG_OUTPUT_DIR, pagePath);
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
    fs.writeFileSync(path.join(SSG_OUTPUT_DIR, 'robots.txt'), robotsTxt, 'utf-8');
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

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    fs.writeFileSync(path.join(SSG_OUTPUT_DIR, 'sitemap.xml'), sitemapXml, 'utf-8');
    result.generated.push('/sitemap.xml');
  } catch (e: any) {
    result.errors.push(`/sitemap.xml: ${e.message}`);
  }

  if (result.errors.length > 0) {
    result.success = false;
  }

  return result;
}

export function getSSGOutputDir(): string {
  return SSG_OUTPUT_DIR;
}
