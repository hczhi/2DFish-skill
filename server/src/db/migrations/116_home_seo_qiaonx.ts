import type { Migration } from '../migrator.js';

// 首页改版（品牌改成 QiaoNx，只推展示稿和品牌咨询两个应用）后的 SEO 文案。
// 直接覆盖首页那两行和站点名 / 站点描述：旧值写的是「智慧看板、AI 顾问」，那些入口已经从首页拿掉，
// 留着的话搜索结果里是一段点进来找不到的介绍。/ppt、/consult 只在没有配置时补一行，不覆盖后台改过的。
const OG_IMAGE = 'https://file.qiaonan.vip/uploads/2026/09/24/fd43e5a2-2184-42d2-87b6-00e99ed4dc25.png';

export const migration_116: Migration = {
  id: '116_home_seo_qiaonx',
  up(db) {
    const now = new Date().toISOString();
    const siteUrlRow = db.prepare(`SELECT value FROM seo_global WHERE key = 'site_url'`).get() as { value: string } | undefined;
    const siteUrl = (siteUrlRow?.value || 'https://qiaonx.com').replace(/\/$/, '');

    const setGlobal = db.prepare(
      `INSERT INTO seo_global (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    setGlobal.run('site_name', 'QiaoNx', now);
    setGlobal.run('site_description', 'QiaoNx 是 AI 应用工具平台：AI 生成可在线演示的 HTML 展示稿，AI 品牌咨询把战略落成可执行的决策。输入 Key 即用，按点数计费。', now);
    // 默认分享图只在没配时补上，配过的不动
    db.prepare(`UPDATE seo_global SET value = ?, updated_at = ? WHERE key = 'default_og_image' AND value = ''`).run(OG_IMAGE, now);

    const jsonLd = (lang: string, desc: string, apps: Array<[string, string, string]>) =>
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'QiaoNx', url: siteUrl + '/', inLanguage: lang, description: desc },
          { '@type': 'Organization', name: 'QiaoNx', url: siteUrl + '/', logo: siteUrl + '/logo.png' },
          ...apps.map(([name, p, d]) => ({
            '@type': 'SoftwareApplication',
            name,
            url: siteUrl + p,
            description: d,
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
          })),
        ],
      });

    const home = [
      {
        locale: 'zh',
        title: 'QiaoNx - AI 展示稿与品牌咨询 | 输入 Key 即用',
        description: 'AI 直接交付成品：输入提纲生成可在线演示的 HTML 展示稿，双击即改；AI 品牌咨询从自身、行业、竞品、用户四看出发，联动定位、价值、信任与关系。无需注册，输入 Key 即用，按点数计费，失败不扣点。',
        keywords: 'AI PPT,AI 演示文稿,HTML 展示稿,AI 生成 PPT,AI 品牌咨询,品牌定位,品牌战略,QiaoNx',
        og_title: 'QiaoNx - 构想即现实，AI 交付成品',
        og_description: 'AI 生成 HTML 展示稿、AI 品牌咨询。输入 Key 即用，按点数计费。',
        json_ld: jsonLd('zh-CN', 'AI 展示稿与品牌咨询平台', [
          ['HTML 展示稿', '/ppt', '对话生成提纲或上传文档，AI 排版出一整份可在线演示的展示稿'],
          ['AI 品牌咨询', '/consult', '四看四大成框架，把品牌战略落成可执行的决策'],
        ]),
      },
      {
        locale: 'en',
        title: 'QiaoNx - AI Presentations & Brand Strategy',
        description: 'AI that delivers finished work: turn an outline into a web-ready HTML presentation, edit by double-click; get AI brand consulting across positioning, value, trust and relationship. No sign-up — enter a key and start, pay per use.',
        keywords: 'AI presentation,AI slides,HTML presentation,AI brand strategy,brand positioning,QiaoNx',
        og_title: 'QiaoNx - From idea to finished work',
        og_description: 'AI presentations and AI brand consulting. Enter a key and start.',
        json_ld: jsonLd('en', 'AI presentations and brand consulting', [
          ['HTML Presentations', '/ppt', 'Turn an outline or document into a web-ready presentation'],
          ['AI Brand Consulting', '/consult', 'Turn brand strategy into actionable decisions'],
        ]),
      },
    ];
    const upsertHome = db.prepare(`
      INSERT INTO seo_pages (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      VALUES (@id, '/', @locale, @title, @description, @keywords, @og_title, @og_description, @og_image, '', 0, @json_ld, 1.0, 'daily', @now, @now)
      ON CONFLICT(path, locale) DO UPDATE SET
        title = excluded.title, description = excluded.description, keywords = excluded.keywords,
        og_title = excluded.og_title, og_description = excluded.og_description, og_image = excluded.og_image,
        json_ld = excluded.json_ld, no_index = 0, updated_at = excluded.updated_at
    `);
    for (const h of home) {
      upsertHome.run({ ...h, id: h.locale === 'zh' ? 'seo__' : 'seo___en', og_image: OG_IMAGE, now });
    }

    const insertApp = db.prepare(`
      INSERT OR IGNORE INTO seo_pages (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
      VALUES (?, ?, 'zh', ?, ?, ?, ?, ?, ?, '', 0, '', 0.9, 'weekly', ?, ?)
    `);
    insertApp.run(
      'seo__ppt', '/ppt',
      'HTML 展示稿 - AI 生成可在线演示的 PPT | QiaoNx',
      '对话生成提纲，或上传现有文档解析，AI 排版出一整份可在线演示的 HTML 展示稿。一键切换全局版式，双击修改文本，修改免扣点数。',
      'AI PPT,AI 演示文稿,HTML 展示稿,AI 生成 PPT,在线演示',
      'HTML 展示稿 - 从一个灵感，到一份专业的演示', 'AI 生成可在线演示的 HTML 展示稿，双击即改。',
      OG_IMAGE, now, now
    );
    insertApp.run(
      'seo__consult', '/consult',
      'AI 品牌咨询 - 定位、价值、信任、关系一次理清 | QiaoNx',
      '洞察自身、行业、竞品与用户，联动定位、价值、信任与关系四大成，改一处提醒核对其余三处；决策过程自动留痕，沉淀成企业专属知识库。',
      'AI 品牌咨询,品牌定位,品牌战略,品牌策划,竞品分析',
      'AI 品牌咨询 - 将抽象的战略，转化为可落地的决策', '四看四大成框架，把品牌战略落成可执行的决策。',
      '', now, now
    );

    // 其余页面标题里的旧品牌后缀一并换掉（那些入口只是从首页隐藏，页面还能访问）
    db.prepare(`UPDATE seo_pages SET title = REPLACE(title, '| QiaoNan', '| QiaoNx'), updated_at = ? WHERE title LIKE '%| QiaoNan%'`).run(now);
  },
};
