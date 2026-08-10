import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import type { TenderItem, ProgressCallback } from './crawlerService.js';

// 广州国企阳光采购信息发布平台（ygcg.gzggzy.cn）—— 广州交易集团旗下，
// 汇总广州市国企（工控、水投、公交、珠啤、酒家、医药…）的采购公告。
//
// 前置防护：华为云 WAF。**别用 curl 验证这个站** —— 实测 curl 会拿到
// 「访问被拦截！ / Server: CloudWAF」的 HTML 拦截页（有时干脆挂住不返回），
// 而 Node 原生 fetch（undici）同一时刻同一台机器直接 200 JSON。
// 和 szecp 是同一个坑的另一种表现：判定看的是 TLS/HTTP2 指纹，不是 cookie 和 IP。
// 所以这里不需要 Playwright、不需要 HWWAFSESID cookie，直接 fetch。
const BASE_URL = 'https://ygcg.gzggzy.cn';
const LIST_API = `${BASE_URL}/content/page`;

// CMS 栏目 id。只要「还能报名」的采购/招标类，结果类和更正类一律不抓
// （抓了也报不了名，还会污染评分）。实测各栏目量级：
//   2306 采购公告      100700 条  ✅ 主力，含子栏目 2320 货物 / 2321 服务 / 2322 其他
//   2310 资格预审公告     675 条  ✅ 预审也能报名，量小但都是大项目
//   2307 澄清变更公告   16272 条  —— 是对已发公告的修订，正文没有独立项目信息
//   2308 采购结果公告            ❌ 结果类
//   2342 其他公告        6441 条  —— 混杂「征集供应商 / 失败公告 / 合同公告」，
//                                  噪声比信号多，暂不抓；要抓得先按标题分流
// 其他栏目 id 的获取办法：浏览器打开 /p92/{栏目}.html，页面 HTML 里
// 直接写着 channelIds=xxxx（不必抓包翻页）。
const CHANNELS: Array<{ id: number; noticeType: string }> = [
  { id: 2306, noticeType: '采购公告' },
  { id: 2310, noticeType: '资格预审公告' },
];

// 子栏目 id → 采购品类。列表里 channelId 是子栏目，和 url 里的路径段一一对应
// （实测 100 条：2320→hw / 2321→fw / 2322→qt，无例外）。
const SUB_CHANNEL_CATEGORY: Record<number, string> = {
  2320: '货物',
  2321: '服务',
  2322: '其他',
};

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': `${BASE_URL}/p92/cggg.html`,
};

// size 实测 50 可用（默认 15）。再往上官方文档说可能返回异常，没必要试探 ——
// 我们是关键词搜索模式，「宣传」686 条、「视频」732 条，一两页就够。
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

interface YgcgListItem {
  id: number;
  title: string;
  url: string;                      // PC 详情相对路径，两种形态见 absoluteUrl
  h5UrlWhole: string | null;
  releaseTime: string;              // "2026-08-06 00:00:00"（实测时分秒恒为 0）
  purchaser: string | null;         // 采购人，实测 100% 有值
  supervisionCompanyName: string | null; // 监督单位（集团母公司）
  sourceName: string | null;        // 来源子平台，可能为 null
  groupId: string | null;
  channelId: number;                // 子栏目 id
  hasStatic: boolean;
  createType: number;
  oriContentId: number | null;
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
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      lastErr = e;
    }
    if (attempt < maxRetries - 1) await sleep(1500 + attempt * 2500);
  }
  throw lastErr || new Error('请求失败');
}

/** 被华为 WAF 拦截时返回的是 HTTP 200 + HTML 拦截页，只能靠内容判断。 */
function isWafBlocked(text: string): boolean {
  return /CloudWAF|访问被拦截/.test(text);
}

/**
 * 列表 url 两种形态，都要能拼成绝对地址（实测各占约 8:2）：
 *   hasStatic=true  → "/p92/hw/20260806/429989.html"
 *   hasStatic=false → "/hw/429195.jhtml"
 * 两种都能裸 fetch 到完整正文，不用管 hasStatic，也不要去猜另一种形态。
 */
function absoluteUrl(rel: string): string {
  if (!rel) return '';
  if (/^https?:\/\//.test(rel)) return rel;
  return `${BASE_URL}/${String(rel).replace(/^(\.\.\/)+/, '').replace(/^\//, '')}`;
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
    .replace(/&yen;/g, '¥')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 正文容器 `.content_txt` 的内容（含标签）。
 *
 * 必须只取这个 div：整页 strip 会把顶部导航（首页/采购信息/服务指南…）和
 * 页脚（联系电话 周小姐 020-28866337、粤ICP备…）一起塞进 content_text，
 * 于是「联系电话」正则命中的是交易中心前台的号码，而不是这个项目的采购人。
 * 实测 4 类页面（p92 静态 / jhtml / 建设工程表格式 / 长正文）取到的都是纯正文。
 *
 * 用配平计数而不是贪婪/惰性正则：正文里嵌了几十层 <div>，
 * `[\s\S]*?</div>` 会在第一个内层闭合就截断（只剩一两行）。
 */
function extractContentTxt(html: string): string {
  const open = html.match(/<div[^>]*class="[^"]*\bcontent_txt\b[^"]*"[^>]*>/i);
  if (!open || open.index === undefined) return '';
  const start = open.index + open[0].length;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  // 没配平（CMS 手工粘贴的正文偶有未闭合标签）时退回到「开始标签之后的全部」，
  // 会多带页脚，但比返回空串好 —— 空串会让 AI 抽取和评分整条失效。
  return html.slice(start);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * 报名/递交截止时间。返回「YYYY-MM-DD HH:mm:ss」，抽不到返回空串。
 *
 * 平台正文是各家国企自己写的自然语言，没有结构化字段，日期至少四种写法：
 *   2026年08月11日 上午9时 / 2026-08-17 09:00 / 2026/8/19 09:00 / 2026年8月13日09：30
 * 而且 CMS 会在数字中间插空格（`202 6 年 8 月 13 日`，富文本编辑器留下的 <span>
 * 被 strip 成空格），所以匹配前必须先把「数字之间的空格」压掉，否则
 * `(\d{4})年` 永远匹配不到这一类页面（40 条抽样里有 2 条就这样漏掉）。
 */
function normalizeDigits(text: string): string {
  return text.replace(/(\d)[ \t]+(?=\d)/g, '$1');
}

const CN_DATE = String.raw`(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日`;
const NUM_DATE = String.raw`(\d{4})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})`;
const OPT_TIME = String.raw`(?:[^\d]{0,8}(\d{1,2})\s*[时:：]\s*(\d{1,2})?)?`;
// 「响应文件递交截止时间」是最常见的说法；其余是各家的变体。
const DEADLINE_LEAD = String.raw`(?:报名|响应文件递交|响应文件|投标文件递交|递交(?:资格预审\/)?(?:投标|标书)?文件|递交标书|投标|申请|报价|获取采购文件|开标)`;

// 顺序即优先级：带「报名/递交」前缀的最准；裸「截止时间」次之；
// 「公告结束时间」最后 —— 它通常早于递交截止，宁可早报也不要漏。
const DEADLINE_PATTERNS: RegExp[] = [
  new RegExp(`${DEADLINE_LEAD}[^。；;]{0,10}截[止至]时间[^\\d]{0,14}${CN_DATE}${OPT_TIME}`),
  new RegExp(`${DEADLINE_LEAD}[^。；;]{0,10}截[止至]时间[^\\d]{0,14}${NUM_DATE}${OPT_TIME}`),
  new RegExp(`截[止至](?:时间|日期)[^\\d]{0,14}${CN_DATE}${OPT_TIME}`),
  new RegExp(`截[止至](?:时间|日期)[^\\d]{0,14}${NUM_DATE}${OPT_TIME}`),
  new RegExp(`公告结束时间[^\\d]{0,14}${CN_DATE}${OPT_TIME}`),
  new RegExp(`公告结束时间[^\\d]{0,14}${NUM_DATE}${OPT_TIME}`),
];

function extractDeadline(text: string): string {
  const src = normalizeDigits(text);
  for (const pat of DEADLINE_PATTERNS) {
    const m = src.match(pat);
    if (!m) continue;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    // 「截止投标截止时间前成立期限不足两年的」这类资格条款里也有「截止」，
    // 但后面跟的不是日期，正则本来就不会命中；这里挡的是明显离谱的年份。
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    let hour = m[4] === undefined ? 0 : Number(m[4]);
    const minute = m[5] === undefined ? 0 : Number(m[5]);
    if (hour > 23) hour = 0;
    // 「下午13：30」这种把「下午」和 24 时制混写的很常见，不能无脑 +12。
    if (hour > 0 && hour < 12 && /下午|PM/i.test(m[0])) hour += 12;
    return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:00`;
  }
  return '';
}

// 「万」必须在捕获组里判断，不能对全文 includes('万')
// ——同 crawlerService.extractBudget 的历史 bug（会把「元」的预算放大 10000 倍）。
const BUDGET_PATTERNS: RegExp[] = [
  /(?:采购控制价|项目控制价|招标控制价|最高限价|控制价|预算金额|预算|合同估算价)[^\d¥￥]{0,16}[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万?)\s*元/,
  /(?:采购控制价|项目控制价|招标控制价|最高限价|控制价|预算金额|预算)[^\d¥￥]{0,16}([\d,]+(?:\.\d+)?)\s*(万)/,
];

function extractBudget(text: string): { budget: string; budgetAmount: number } {
  const src = normalizeDigits(text);
  for (const pat of BUDGET_PATTERNS) {
    const m = src.match(pat);
    if (!m) continue;
    const num = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(num) && num > 0) {
      return {
        budget: m[0].replace(/\s+/g, ' ').trim(),
        budgetAmount: m[2] === '万' ? num * 10000 : num,
      };
    }
  }
  return { budget: '', budgetAmount: 0 };
}

// 「招标人：（盖章）」这类占位要丢掉，否则采购方会存成「（盖章）」。
function clean(s: string): string {
  const t = String(s || '').replace(/[（(]\s*(盖章|签字|签章|全称)\s*[)）]/g, '').trim();
  return /^[（(]|^\s*$|^-+$/.test(t) ? '' : t;
}

function extractFromDetail(text: string): {
  purchaserName: string;
  agencyName: string;
  projectName: string;
  contactName: string;
  contactPhone: string;
} {
  const pick = (pat: RegExp): string => {
    const m = text.match(pat);
    return m ? clean(m[1]) : '';
  };

  return {
    purchaserName: pick(/(?:采购[人方]名称|采购单位名称|采购[人方]|招标人|招标单位)\s*[:：]\s*([^\s，,。；;：]{2,40})/),
    agencyName: pick(/(?:采购代理机构|招标代理机构|代理机构)\s*(?:名称)?\s*[:：]\s*([^\s，,。；;：]{2,40})/),
    projectName: pick(/项目名称\s*[:：]?\s*([^\s，,。；;：]{2,60})/),
    contactName: pick(/(?:联系人|项目联系人)\s*[:：]\s*([^\s，,。；;：\d]{2,20})/),
    contactPhone: (text.match(/(?:联系电话|联系方式|电\s*话)\s*[:：]\s*([\d\-—+()（）\s]{7,20})/)?.[1] || '')
      .trim()
      .replace(/\s+/g, ''),
  };
}

/**
 * 结果/无法报名类公告的兜底过滤。
 * channelIds 已经把结果栏目排除了，但采购公告栏目里混着「失败公告」「终止公告」，
 * 这里按标题再挡一层（和 gdgpo 的 isExcludedNoticeType 同一思路）。
 */
const EXCLUDED_TITLE_PATTERNS = [/中标/, /成交/, /结果公告/, /结果公示/, /废标/, /流标/, /失败公告/, /终止/, /候选人公示/, /合同公告/];

function isExcludedTitle(title: string): boolean {
  return EXCLUDED_TITLE_PATTERNS.some(p => p.test(title || ''));
}

// 这里**故意没有**「报名是否已结束」的过滤（szecp 有，ygcg 不要）。
//
// 原因：这个站没有任何状态字段 —— 状态是靠「公告挂在哪个栏目」表达的
// （页面那排 tab），列表渲染函数只输出标题和日期。截止时间只以自然语言
// 存在于正文里，解析覆盖率约 85%，剩下 15% 是真的没写具体日期
// （「报名截止时间：公告发布之日起招募期5天」这类），而且用「公告结束时间」
// 兜底出来的值本身偏早（它通常早于递交截止）。
// 拿这样一个不完整、还偏早的推断值去删数据，会丢掉还能报的项目；
// 用户自己看 deadline 列判断更可靠。deadline 照样解析入库，只是不据此丢数据。
// 需要过滤时在前端/多维表格按 deadline 列筛，那是可撤销的。

/** 抓详情 HTML。失败不致命 —— 列表字段已足够入库，详情只是补充正文。 */
async function fetchDetailHtml(url: string): Promise<string> {
  const res = await fetchWithRetry(url, 2);
  const html = await res.text();
  if (isWafBlocked(html)) throw new Error('详情页被华为 WAF 拦截');
  return html;
}

async function fetchList(
  channelId: number,
  keyword: string,
  page: number
): Promise<{ items: YgcgListItem[]; totalPage: number; totalRecord: number }> {
  // 列表接口原生支持 title 关键词过滤（实测返回项标题 100% 命中关键词，
  // 「宣传」把 100700 条收窄到 686 条），所以不需要抓全量再本地筛。
  // 其余空参数（rangType/purchaser/supervisionCompanyName）照页面原样带上，
  // 缺了会 500 —— 这个接口不接受省略参数。
  const params = new URLSearchParams({
    channelIds: String(channelId),
    channelOption: '1',
    orderBy: '27', // 27 = 发布时间倒序
    size: String(PAGE_SIZE),
    page: String(page),
    title: keyword,
    rangType: '',
    purchaser: '',
    supervisionCompanyName: '',
  });

  const res = await fetchWithRetry(`${LIST_API}?${params}`);
  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // 拿到 HTML 说明被 WAF 拦了。把这个情况说清楚，否则报错信息只是一句 JSON 解析失败。
    const hint = isWafBlocked(text)
      ? '被华为云 WAF 拦截（该站按 TLS 指纹判定，请确认走的是 Node fetch 而非 curl/代理）'
      : `返回非 JSON（前 80 字符：${text.slice(0, 80)}）`;
    throw new Error(hint);
  }

  const data = json?.data;
  return {
    items: Array.isArray(data?.content) ? data.content : [],
    totalPage: Number(data?.totalPage) || 1,
    totalRecord: Number(data?.totalRecord) || 0,
  };
}

function buildTenderItem(
  item: YgcgListItem,
  noticeType: string,
  keyword: string,
  detailHtml: string | null
): TenderItem {
  const url = absoluteUrl(item.url);
  const bodyHtml = detailHtml ? extractContentTxt(detailHtml) : '';
  const contentText = bodyHtml ? stripHtml(bodyHtml) : '';
  const extracted = contentText
    ? extractFromDetail(contentText)
    : { purchaserName: '', agencyName: '', projectName: '', contactName: '', contactPhone: '' };
  const { budget, budgetAmount } = contentText ? extractBudget(contentText) : { budget: '', budgetAmount: 0 };

  const category = SUB_CHANNEL_CATEGORY[item.channelId] || '';

  return {
    noticeId: String(item.id),
    title: item.title || '',
    publishDate: item.releaseTime || '',
    // 平台不给公告编号字段（groupId 是 CMS 内部批次号，不是项目编号，
    // 长得像日期序号「202608060117」，放到 project_code 会被误当编号展示）。
    projectCode: '',
    // 列表的 purchaser 实测 100% 有值，比正文正则可靠，优先用它。
    purchaserName: item.purchaser || extracted.purchaserName,
    agencyName: extracted.agencyName,
    // 平台没有结构化地区字段。这是广州市国企平台，采购人绝大多数在广州，
    // 但确实有外地子公司（青岛万宝、中山珠啤、佛山佛广），
    // 所以不在这里填「广州」—— 猜错会让用户的地区偏好白配。
    // 地区留给 AI 抽取阶段从正文里读 project_location。
    regionName: '',
    regionCode: '',
    siteCode: '',
    // 「采购公告 · 服务」这样拼，用户才能一眼看出品类。
    noticeType: category ? `${noticeType} · ${category}` : noticeType,
    contentText: contentText.slice(0, 5000),
    contentHtml: bodyHtml.slice(0, 50000),
    url,
    // 附件不在页面上：正文里给的是「登录国e平台/城轨采购网下载采购文件」，
    // 需要供应商账号。抽样 4 类页面 0 个可直连的 pdf/doc 链接。
    attachments: [],
    contactName: extracted.contactName,
    contactPhone: extracted.contactPhone,
    keyword,
    // 抽到就用，抽不到留「未知」。这个站约一半的公告公开控制价（40 条抽样 14 条，
    // 7 条实跑 4 条），所以**不要**把 ygcg 加进 recommendService 的
    // PLATFORMS_WITHOUT_BUDGET —— 那个集合是给「平台压根不发布预算」的
    // 美的/华润用的，给满分；ygcg 的 0 多半是这里没抽出来，给满分等于奖励抽取失败，
    // 应该走 50 分中性兜底。
    budget: budget || '未知',
    budgetAmount,
    rawData: {
      listItem: item,
      channelNoticeType: noticeType,
      category,
      projectName: extracted.projectName,
      // deadline 存在 rawData 里给入库时用，避免再解析一遍正文。
      deadline: contentText ? extractDeadline(contentText) : '',
    },
  };
}

export async function crawlYgcg(
  keywords: string[],
  daysLimit: number = 14,
  onProgress?: ProgressCallback
): Promise<{ logId: string; items: TenderItem[] }> {
  const db = getDatabase();
  const logId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tender_crawl_logs (id, platform, status, started_at) VALUES (?, 'ygcg', 'running', ?)`).run(logId, now);

  const allItems: TenderItem[] = [];
  let totalFound = 0;
  let newAdded = 0;
  let duplicates = 0;
  let errors = 0;
  let skippedByTitle = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);

  const existingHashes = new Set<string>(
    (db.prepare('SELECT content_hash FROM tenders WHERE platform = ?').all('ygcg') as any[]).map(r => r.content_hash)
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

        const wanted: Array<{ item: YgcgListItem; noticeType: string }> = [];
        let totalPage = 1;
        let stop = false;

        for (let page = 1; page <= Math.min(totalPage, MAX_PAGES) && !stop; page++) {
          let pageItems: YgcgListItem[];
          try {
            if (page > 1) await randomSleep(1000, 1600);
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
            const pub = parseDate(it.releaseTime);
            // orderBy=27 是发布时间倒序（实测 page1 末条 ≥ page2 首条），
            // 所以一旦越过 cutoff 就整体收工，不用翻完 6714 页。
            if (pub && pub < cutoffDate) {
              stop = true;
              break;
            }
            if (isExcludedTitle(it.title)) {
              skippedByTitle++;
              continue;
            }
            const hash = generateContentHash('ygcg', it.title);
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
            // 文档建议间隔 ≥1s：高频会踩华为 WAF 限流。
            if (i > 0) await randomSleep(900, 1500);
            html = await fetchDetailHtml(absoluteUrl(item.url));
          } catch {
            // 详情失败不丢数据：列表字段已含标题/采购人/发布时间，照样入库。
            // 代价是没有 deadline 和正文，AI 抽取阶段会拿不到东西 —— 但有链接可点。
            errors++;
          }
          // 不按报名截止时间过滤 —— 见上面 isExcludedTitle 后面那段注释。
          allItems.push(buildTenderItem(item, noticeType, keyword, html));
        }
      }

      if (ki < keywords.length - 1) await randomSleep(1200, 2000);
    }

    onProgress?.({ step: 'saving', message: `保存到数据库 (${allItems.length} 条)...`, current: 0, total: allItems.length });

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline, budget, budget_amount, purchaser_name, agency_name, region_name, region_code, project_code, notice_type, procurement_method, content_text, content_html, url, attachments, contact_name, contact_phone, keyword, raw_data, created_at)
      VALUES (?, 'ygcg', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of allItems) {
      // content_hash 是全库唯一索引（不分平台），前缀必须带 platform 才不会跨平台撞标题
      const contentHash = generateContentHash('ygcg', item.title);
      const result = insertStmt.run(
        uuidv4(),
        item.noticeId,
        contentHash,
        item.title,
        item.publishDate,
        item.rawData?.deadline || '',
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
      message: `Done: ${newAdded} new, ${duplicates} duplicates, ${skippedByTitle} skipped (结果类)`,
      current: allItems.length, total: allItems.length,
    });

  } catch (e: any) {
    console.error('[ygcg] Crawl failed:', e);
    db.prepare(`UPDATE tender_crawl_logs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`)
      .run(e.message || 'Unknown error', new Date().toISOString(), logId);
    throw e;
  }

  return { logId, items: allItems };
}

// 仅用于单元测试/离线验证：正文解析是这个爬虫唯一有分支的部分，
// 而它依赖的都是纯字符串处理，不需要网络就能测。
export const __testables = { extractContentTxt, extractDeadline, extractBudget, extractFromDetail, stripHtml, absoluteUrl, isExcludedTitle };
