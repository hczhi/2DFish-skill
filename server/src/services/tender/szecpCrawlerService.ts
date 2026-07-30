import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import type { TenderItem, ProgressCallback } from './crawlerService.js';

// 华润守正采购交易平台（www.szecp.com.cn）—— 华润集团统一招采平台。
//
// 前置防护：腾讯云 EdgeOne 人机验证。但**判定依据是 TLS/HTTP2 指纹，不是 cookie，也不是 IP**：
//   - curl（含完整浏览器请求头）→ 一律返回 Security Verification 验证页
//   - Node 原生 fetch（undici，零请求头也行）→ 直接 200 JSON
// 实测同一台机器同一时刻，curl 被拦、node fetch 通过；给 node fetch 伪造 cookie 或
// 完全不带 cookie，结果都一样。所以这里**不需要 Playwright、不需要提取 cookie**，
// 直接用 fetch 即可 —— 与 gdgpo / meicloud 保持一致的实现方式。
// （踩坑提示：不要用 curl 去验证这个站是否可达，会得出错误结论。）
const BASE_URL = 'https://www.szecp.com.cn';
const LIST_API = `${BASE_URL}/rcms-external-rest/content/getSZExtData`;

// CMS 频道 id。我们只要能报名的招标/采购类，中标/结果/候选人公示一律不抓
// （抓了也报不了名，还会污染评分）。channelIds 实测枚举结果：
//   26909 招标公告   first_zbgg     18627 条  ✅ 对应页面「招标采购 → 招标公告」
//   26910 更正公告   first_gbgg      5425 条  —— 对已有公告的修订，正文无独立项目信息
//   26911 中标候选人公示            14839 条  ❌ 结果类
//   26912 中标公告   first_zbgg1    14736 条  ❌ 结果类
//   26913 终止公告   first_zbgg2     1382 条  ❌
//   26914 网上开标大厅             16365 条  ❌ 是开标日程（url 恒为 null，没有公告正文）
//   26915 采购公告   first_cggg   268079 条  ✅ 对应页面「非招标采购 → 采购公告」
//   26917 变更公告   first_bggg    84629 条  —— 同 26910，是变更不是新项目
//   26918 结果公告   first_jggg    87940 条  ❌ 结果类
const CHANNELS: Array<{ id: number; noticeType: string }> = [
  { id: 26909, noticeType: '招标公告' },
  { id: 26915, noticeType: '采购公告' },
];

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': `${BASE_URL}/first_zbgg/index.html`,
};

// 实测 pageSize=100 可用（默认 10）。用 100 把 1863 页压到 187 页，
// 但我们是关键词搜索模式，通常一两页就够。
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface SzecpListItem {
  contentId: number;
  channelId: number;
  title: string;
  url: string;            // 相对路径 "../first_zbgg/2026-07-26/2719248.html"
  status: number;
  businessUnit: string;   // 采购组织代码，如 CR003
  purchaseType: string;   // 工程 / 货物 / 服务 / 其他
  number: string;         // 公告编号 ZBGG202607290008
  deadline: string;       // 报名截止 YYYYMMDDHHmmss
  publishDate: string;    // 2026-07-29 15:41:56
  location?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomSleep(min: number, max: number): Promise<void> {
  return sleep(min + Math.random() * (max - min));
}

function generateContentHash(platform: string, title: string): string {
  return createHash('md5').update(`${platform}:${title}`).digest('hex');
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastErr: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      // 被 EdgeOne 拦了会返回 HTTP 200 + HTML 验证页，不是错误码，只能靠内容判断。
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      lastErr = e;
    }
    if (attempt < maxRetries - 1) await sleep(2000 + attempt * 3000);
  }
  throw lastErr || new Error('请求失败');
}

/**
 * deadline 归一化成「YYYY-MM-DD HH:mm:ss」。解析不出来返回空串。
 *
 * 平台的 deadline 字段实测有三种形态（文档只提到第一种）：
 *   20260805235900        紧凑串
 *   2026-07-29 15:00:00   已是标准格式（占绝大多数，72 条样本里 70 条）
 *   2026-07-08 23:59      缺秒
 * 必须在这里补齐到统一格式，否则下游（多维表格日期列、前端排序）会见到长短不一的值。
 */
function parseCompactDateTime(raw: string): string {
  if (!raw) return '';
  const s = String(raw).trim();
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, y, mo, d, h, mi, sec] = compact;
    return `${y}-${mo}-${d} ${h}:${mi}:${sec}`;
  }
  const dashed = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dashed) {
    const [, date, h, mi, sec] = dashed;
    if (!h) return `${date} 00:00:00`;
    return `${date} ${h}:${mi}:${sec ?? '00'}`;
  }
  return '';
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(' ', 'T') : raw);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 相对路径 "../first_zbgg/2026-07-26/2719248.html" → 绝对 URL。 */
function absoluteUrl(rel: string): string {
  if (!rel) return '';
  if (/^https?:\/\//.test(rel)) return rel;
  return `${BASE_URL}/${String(rel).replace(/^(\.\.\/)+/, '').replace(/^\//, '')}`;
}

/**
 * 结果/无法报名类公告的兜底过滤。
 * channelIds 已经把结果类频道排除了，但招标公告频道里偶尔混入「中标结果」标题，
 * 这里按标题再挡一层（和 gdgpo 的 isExcludedNoticeType 同一思路）。
 */
const EXCLUDED_TITLE_PATTERNS = [/中标/, /成交/, /结果公告/, /废标/, /流标/, /终止/, /候选人公示/];

function isExcludedTitle(title: string): boolean {
  return EXCLUDED_TITLE_PATTERNS.some(p => p.test(title || ''));
}

/**
 * 是否「正在报名」。
 *
 * 平台页面上那一列「正在报名 / 报名结束」**不是接口字段** —— 实测 status 在
 * 26909/26915 两个频道各 300 条取样里恒为 2（连页面上显示「报名结束」的也是 2），
 * 所以它是前端拿 deadline 和当前时间现算的。我们照同一口径算。
 *
 * deadline 解析不出来时返回 true（保守放过）：宁可多抓一条让用户自己判断，
 * 也不要因为平台换了个日期格式就把当天所有在报项目静默丢光。
 */
function isOpenForRegistration(rawDeadline: string, nowMs: number): boolean {
  const normalized = parseCompactDateTime(rawDeadline);
  if (!normalized) return true;
  const t = new Date(normalized.replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? true : t > nowMs;
}

async function fetchList(
  channelId: number,
  keyword: string,
  pageNo: number
): Promise<{ items: SzecpListItem[]; totalPage: number }> {
  // 关键词搜索参数是 title（文档里没有；实测 keyword / searchKey 都被忽略并返回全量，
  // 只有 title 生效：title=媒体 → totalCount 从 18627 降到 57，且返回项标题全部命中）。
  const url = `${LIST_API}?channelIds=${channelId}&pageNo=${pageNo}&pageSize=${PAGE_SIZE}&title=${encodeURIComponent(keyword)}`;
  const res = await fetchWithRetry(url);
  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // 拿到 HTML 说明被 EdgeOne 拦了。把这个情况说清楚，否则报错信息是一句 JSON 解析失败。
    const hint = /Security Verification/i.test(text)
      ? '被 EdgeOne 人机验证拦截（该站按 TLS 指纹判定，请确认走的是 Node fetch 而非 curl/代理）'
      : `返回非 JSON（前 80 字符：${text.slice(0, 80)}）`;
    throw new Error(hint);
  }

  const data = json?.data;
  return {
    items: Array.isArray(data?.data) ? data.data : [],
    totalPage: Number(data?.totalPage) || 1,
  };
}

/** 抓详情 HTML。失败不致命 —— 列表字段已足够入库，详情只是补充正文。 */
async function fetchDetailHtml(url: string): Promise<string> {
  const res = await fetchWithRetry(url, 2);
  const html = await res.text();
  if (/Security Verification/i.test(html)) throw new Error('详情页被 EdgeOne 拦截');
  return html;
}

/**
 * 详情正文里抽取补充字段。
 * 页面是服务端渲染的自然语言段落，没有稳定的正文容器 class（实测 .article/.content
 * 等常见选择器全都不存在），所以只能整页 strip 后正则提取。
 */
function extractFromDetail(text: string): {
  purchaserName: string;
  agencyName: string;
  projectName: string;
  budget: string;
  budgetAmount: number;
} {
  const pick = (pat: RegExp): string => {
    const m = text.match(pat);
    return m ? String(m[1]).trim() : '';
  };

  // 「招标人：（盖章）」这类占位要丢掉，否则采购方会存成「（盖章）」。
  const clean = (s: string): string => {
    const t = s.replace(/[（(]\s*(盖章|签字|签章)\s*[)）]/g, '').trim();
    return /^[（(]|^\s*$|^-+$/.test(t) ? '' : t;
  };

  const purchaserName = clean(pick(/(?:招标人|采购人|招标单位|采购单位)[:：]\s*([^\s，,。；;：]{2,40})/));
  const agencyName = clean(pick(/(?:招标代理机构|代理机构|采购代理机构)[:：]\s*([^\s，,。；;：]{2,40})/));
  const projectName = clean(pick(/项目名称[:：]\s*([^\s，,。；;]{2,60})/));

  // 「万」必须在捕获组里判断，不能对全文 includes('万')
  // ——同 crawlerService.extractBudget 的历史 bug（会把「元」的预算放大 10000 倍）。
  let budget = '';
  let budgetAmount = 0;
  const budPatterns = [
    /(?:预算金额|预算)[^\d]{0,10}([\d,.]+)\s*(万?)元/,
    /(?:最高限价|控制价|招标控制价)[^\d]{0,10}([\d,.]+)\s*(万?)元/,
    /(?:合同估算价|投资额|投资估算)[^\d]{0,10}([\d,.]+)\s*(万?)元/,
  ];
  for (const pat of budPatterns) {
    const m = text.match(pat);
    if (m) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) {
        budget = m[0].trim();
        budgetAmount = m[2] === '万' ? num * 10000 : num;
        break;
      }
    }
  }

  return { purchaserName, agencyName, projectName, budget, budgetAmount };
}

function buildTenderItem(
  item: SzecpListItem,
  noticeType: string,
  keyword: string,
  detailHtml: string | null
): TenderItem {
  const url = absoluteUrl(item.url);
  const contentText = detailHtml ? stripHtml(detailHtml) : '';
  const extracted = contentText
    ? extractFromDetail(contentText)
    : { purchaserName: '', agencyName: '', projectName: '', budget: '', budgetAmount: 0 };

  return {
    noticeId: String(item.contentId),
    title: item.title || '',
    publishDate: item.publishDate || '',
    projectCode: item.number || '',
    purchaserName: extracted.purchaserName,
    agencyName: extracted.agencyName,
    // 平台不提供结构化地区字段（location 实测恒为 null）。留空，
    // 评分时地区轴会走「未知」分支，不要在这里瞎猜省市。
    regionName: '',
    regionCode: '',
    siteCode: '',
    // purchaseType 是工程/货物/服务，和「公告类型」不是一回事，
    // 拼在一起才能让用户看出「招标公告 · 服务」。
    noticeType: item.purchaseType ? `${noticeType} · ${item.purchaseType}` : noticeType,
    contentText,
    contentHtml: detailHtml || '',
    url,
    attachments: [],
    contactName: '',
    contactPhone: '',
    keyword,
    // 华润和美的一样基本不公开预算（10 条抽样 0 命中）。
    // 抽到了就用，抽不到留「未知」，预算轴按平台给满分，不要因为拿不到预算就压低分。
    budget: extracted.budget || '未知',
    budgetAmount: extracted.budgetAmount,
    rawData: { listItem: item, channelNoticeType: noticeType, projectName: extracted.projectName },
  };
}

export async function crawlSzecp(
  keywords: string[],
  daysLimit: number = 14,
  onProgress?: ProgressCallback
): Promise<{ logId: string; items: TenderItem[] }> {
  const db = getDatabase();
  const logId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tender_crawl_logs (id, platform, status, started_at) VALUES (?, 'szecp', 'running', ?)`).run(logId, now);

  const allItems: TenderItem[] = [];
  let totalFound = 0;
  let newAdded = 0;
  let duplicates = 0;
  let errors = 0;
  let skippedByTitle = 0;
  let skippedClosed = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);
  // 报名截止判定统一用同一个时刻，否则一轮抓几分钟、边界项目会前后不一致。
  const nowMs = Date.now();

  const existingHashes = new Set<string>(
    (db.prepare('SELECT content_hash FROM tenders WHERE platform = ?').all('szecp') as any[]).map(r => r.content_hash)
  );
  const seenHashes = new Set<string>();

  try {
    for (let ki = 0; ki < keywords.length; ki++) {
      const keyword = keywords[ki];

      for (const channel of CHANNELS) {
        onProgress?.({
          step: 'fetching',
          message: `搜索「${keyword}」· ${channel.noticeType} (${ki + 1}/${keywords.length})`,
          current: ki + 1,
          total: keywords.length,
        });

        const wanted: Array<{ item: SzecpListItem; noticeType: string }> = [];
        let totalPage = 1;
        let stop = false;

        for (let page = 1; page <= Math.min(totalPage, MAX_PAGES) && !stop; page++) {
          let pageItems: SzecpListItem[];
          try {
            if (page > 1) await randomSleep(500, 1200);
            const resp = await fetchList(channel.id, keyword, page);
            pageItems = resp.items;
            totalPage = resp.totalPage;
          } catch (e: any) {
            onProgress?.({
              step: 'fetching',
              message: `「${keyword}」· ${channel.noticeType} 第 ${page} 页失败: ${e.message}`,
              current: ki + 1, total: keywords.length,
            });
            errors++;
            break;
          }

          if (pageItems.length === 0) break;
          totalFound += pageItems.length;

          for (const it of pageItems) {
            const pub = parseDate(it.publishDate);
            // 列表按 publishDate 倒序（实测 page1 末条 > page2 首条），
            // 所以一旦越过 cutoff 就可以整体收工，不用翻完 187 页。
            if (pub && pub < cutoffDate) {
              stop = true;
              break;
            }
            if (isExcludedTitle(it.title)) {
              skippedByTitle++;
              continue;
            }
            // 只要「正在报名」的。报名结束的项目报不了名，抓进来只会挤占推荐位。
            // 注意这里不能像 cutoff 那样 break —— 列表按发布时间排序，
            // 报名截止时间和它不同序（实测第 11 条截止 07-17 排在第 12 条 07-19 之前），
            // 所以必须逐条判断，不能一遇到就整体收工。
            if (!isOpenForRegistration(it.deadline, nowMs)) {
              skippedClosed++;
              continue;
            }
            const hash = generateContentHash('szecp', it.title);
            // 详情页请求前就去重，省掉最贵的那步。
            if (existingHashes.has(hash) || seenHashes.has(hash)) {
              duplicates++;
              continue;
            }
            seenHashes.add(hash);
            wanted.push({ item: it, noticeType: channel.noticeType });
          }
        }

        if (wanted.length === 0) continue;

        onProgress?.({
          step: 'detail',
          message: `「${keyword}」· ${channel.noticeType} 需抓取 ${wanted.length} 条详情`,
          current: ki + 1, total: keywords.length,
        });

        for (let i = 0; i < wanted.length; i++) {
          const { item, noticeType } = wanted[i];
          let html: string | null = null;
          try {
            if (i > 0) await randomSleep(400, 900);
            html = await fetchDetailHtml(absoluteUrl(item.url));
          } catch (e: any) {
            // 详情失败不丢数据：列表字段已含标题/编号/截止/发布时间，照样入库。
            errors++;
          }
          allItems.push(buildTenderItem(item, noticeType, keyword, html));
        }
      }

      if (ki < keywords.length - 1) await randomSleep(1000, 2000);
    }

    onProgress?.({ step: 'saving', message: `保存到数据库 (${allItems.length} 条)...`, current: 0, total: allItems.length });

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline, budget, budget_amount, purchaser_name, agency_name, region_name, region_code, project_code, notice_type, procurement_method, content_text, content_html, url, attachments, contact_name, contact_phone, keyword, raw_data, created_at)
      VALUES (?, 'szecp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of allItems) {
      // content_hash 是全库唯一索引（不分平台），前缀必须带 platform 才不会跨平台撞标题
      const contentHash = generateContentHash('szecp', item.title);
      const deadline = parseCompactDateTime(item.rawData?.listItem?.deadline || '');
      const result = insertStmt.run(
        uuidv4(),
        item.noticeId,
        contentHash,
        item.title,
        item.publishDate,
        deadline,
        item.budget,
        item.budgetAmount,
        item.purchaserName,
        item.agencyName,
        item.regionName,
        item.regionCode,
        item.projectCode,
        item.noticeType,
        item.contentText,
        item.contentHtml,
        item.url,
        JSON.stringify(item.attachments),
        item.contactName,
        item.contactPhone,
        item.keyword,
        JSON.stringify(item.rawData),
        now,
      );
      if (result.changes > 0) newAdded++;
      else duplicates++;
    }

    db.prepare(`UPDATE tender_crawl_logs SET status = 'completed', total_found = ?, new_added = ?, duplicates = ?, errors = ?, completed_at = ? WHERE id = ?`)
      .run(totalFound, newAdded, duplicates, errors, new Date().toISOString(), logId);

    onProgress?.({
      step: 'done',
      message: `Done: ${newAdded} new, ${duplicates} duplicates, ${skippedByTitle} skipped (结果类), ${skippedClosed} skipped (报名已结束)`,
      current: allItems.length, total: allItems.length,
    });

  } catch (e: any) {
    console.error('[szecp] Crawl failed:', e);
    db.prepare(`UPDATE tender_crawl_logs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`)
      .run(e.message || 'Unknown error', new Date().toISOString(), logId);
    throw e;
  }

  return { logId, items: allItems };
}
