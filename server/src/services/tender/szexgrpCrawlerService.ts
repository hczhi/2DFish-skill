import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import type { TenderItem, ProgressCallback } from './crawlerService.js';

// 深圳阳光采购平台（ygcg.szexgrp.com）—— 深圳市属国企统一采购平台。
//
// 三个平台里最省事的一个：**无任何防护**，明文 JSON，零请求头也能通，
// 连打不限流（实测 5 轮并发全 200）。所以这里没有 WAF/指纹相关的任何处理，
// 也不需要像 szecp/ygcg 那样警告「别用 curl 验证」。
//
// 注意平台 id 叫 szexgrp，别和已有的两个混了：
//   szecp = 华润守正（szecp.com.cn）  ygcg = 广州国企（ygcg.gzggzy.cn）
const BASE_URL = 'https://ygcg.szexgrp.com';
const LIST_API = `${BASE_URL}/api/v1/trade/content/page`;
const DETAIL_API = `${BASE_URL}/api/v1/trade/content/detail`;

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Referer': `${BASE_URL}/`,
};

// 这个站只有一个交易信息栏目。实测枚举 4160/4162/4163/4164/4165/4170 全部返回 0 条，
// 公告类型是靠行内的 noticeTypeCode 区分的，不是靠 channelId —— 所以不能像
// szecp/ygcg 那样「按频道选招标类」，只能全量拉回来再按 code 白名单筛（见下）。
const CHANNEL_ID = 4161;

// noticeTypeCode 白名单 —— 只要还能报名的。200 条抽样分布：
//   ygcg_cggg      采购公告          57  ✅ 主力，含公开招标/询价/竞价
//   ygcg_yqh       邀请函            35  ✅ 单一来源/询价的定向邀请，也是可报名的
//   ygcg_cgzb_xjgg 意向征集公告(询价)  1  ✅ 市场价格询价，前期摸底但能参与
//   ygcg_hxrgs     候选人公示        40  ❌ 结果类
//   ygcg_jggs      结果公示          29  ❌
//   ygcg_qtgs      其他公示          21  ❌ 含「作废寻源」这类噪声
//   ygcg_htxqgs    合同续期公示       6  ❌ 已有供应商续签，外人报不了
//   ygcg_bggg      变更公告           5  —— 对已有公告的修订，不是新项目
//   ygcg_gcbggs    工程变更公示       4  —— 同上
//   ygcg_dbjggs    定标结果公示       2  ❌
// 用 code 而不是中文名做判据：中文名是 CMS 里可改的展示文案，改了之后
// 白名单会静默漏掉整类公告（列表照样返回，只是一条都不入库）。
const WANTED_NOTICE_CODES = new Set(['ygcg_cggg', 'ygcg_yqh', 'ygcg_cgzb_xjgg']);

// 平台的两个硬上限（实测）：size 传 60/200 都被压回 50，page 到 20 返回空数组。
// 也就是任何一次查询最多只能取到 1000 条，而 totalElements 恒报 1000 是假的
// （title=宣传 实际翻到第 10 页就空了，真实只有 500 条）。
// **所以不能信 totalPages 去算循环次数**，只能翻到空为止 —— 拿 totalPages
// 当上界的话，关键词命中少时会白翻十几页，命中多时又会以为还有得翻。
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

interface SzexgrpListItem {
  contentId: number;
  channelId: number;
  title: string;
  noticeType: string;
  noticeTypeCode: string;
  purchaseCom: string;       // 采购人，实测 92 条里仅 1 条为空
  purchaseMethod: string;    // 公开招标 / 询价 / 竞价 / 单一来源 / 邀请招标 / 竞争性谈判…
  purchaseType: string;      // 工程 / 货物 / 服务
  proxyComName: string;      // 代理机构，约 1/5 有值
  bidSectionNumber: string;  // 标段编号 YG26QG0044883-01-C1，当项目编号用
  releaseTime: string;       // 2026-08-11 16:27:56
  noticeEndTime: string | null;   // 公告结束 = 报名截止，实测白名单内 0 条为空
  noticeCloseTime: string | null; // 实测与 noticeEndTime 100% 相同
  status: number;
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

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let lastErr: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      lastErr = e;
    }
    if (attempt < maxRetries - 1) await sleep(1500 + attempt * 2500);
  }
  throw lastErr || new Error('请求失败');
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(' ', 'T') : raw);
  return isNaN(d.getTime()) ? null : d;
}

/** 「2026-08-11 16:27」→「2026-08-11 16:27:00」。下游（多维表格日期列、前端排序）要求长度一致。 */
function normalizeDateTime(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return '';
  const [, date, h, mi, sec] = m;
  if (!h) return `${date} 00:00:00`;
  return `${date} ${h}:${mi}:${sec ?? '00'}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    // 详情的 txt 字段开头内嵌了一整段 <style>（.g-notice 那套排版样式），
    // 不先剥掉的话 content_text 前 1000 字全是 CSS，AI 抽取会读到一堆 border-collapse。
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

// 富文本编辑器留下的 <span> 被 strip 成空格，会把「202 6 年」这样切开，
// 匹配前先把数字之间的空格压掉（同 ygcg 的 normalizeDigits）。
function normalizeDigits(text: string): string {
  return text.replace(/(\d)[ \t]+(?=\d)/g, '$1');
}

/**
 * 预算 / 采购控制价。
 *
 * 这个站的正文是 CMS 用模板渲染的「标签 值」对（strip 后是
 * `采购控制价（元） 683900 采购控制价（大写） 陆拾捌万...`），
 * **单位写在标签的括号里而不是数字后面** —— 所以通用的「数字+元」正则
 * 一条都匹配不上（20 条抽样 0 命中），必须按标签取。
 *
 * 最要紧的是 `（%）`：报价方式为「下浮率」的项目，标签是
 * `采购控制价（%） 8`，那个 8 是下浮率百分比，不是金额
 * （同一条的真实预算 390 万只写在旁边的自然语言说明里）。
 * 把它当金额存下来的话，一个 390 万的工程会以「预算 8 元」进推荐池，
 * 评分时预算轴直接判成远低于下限、被静默压到底分 —— 而后台显示「已评分」。
 * 所以单位必须**白名单**（元/万元），不认识的单位一律当没抽到。
 */
const BUDGET_LABEL = String.raw`(?:采购控制价|项目控制价|招标控制价|最高限价|控制价|预算金额|预算|合同估算价)`;
const BUDGET_PATTERNS: RegExp[] = [
  // 站内主形态：标签（单位） 数字
  new RegExp(`${BUDGET_LABEL}\\s*[（(]\\s*(元|万元)\\s*[)）]\\s*[:：]?\\s*([\\d,]+(?:\\.\\d+)?)`),
  // 兜底：数字后面带单位的自然语言写法（少数公告在「项目概况」里这么写）
  new RegExp(`${BUDGET_LABEL}[^\\d¥￥%]{0,16}[¥￥]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(万?)\\s*元`),
];

function extractBudget(text: string): { budget: string; budgetAmount: number } {
  const src = normalizeDigits(text);

  const m1 = src.match(BUDGET_PATTERNS[0]);
  if (m1) {
    const num = parseFloat(m1[2].replace(/,/g, ''));
    if (!isNaN(num) && num > 0) {
      return {
        budget: m1[0].replace(/\s+/g, ' ').trim(),
        budgetAmount: m1[1] === '万元' ? num * 10000 : num,
      };
    }
  }

  const m2 = src.match(BUDGET_PATTERNS[1]);
  if (m2) {
    const num = parseFloat(m2[1].replace(/,/g, ''));
    if (!isNaN(num) && num > 0) {
      // 「万」必须在捕获组里判断，不能对全文 includes('万')
      // ——同 crawlerService.extractBudget 的历史 bug（会把「元」的预算放大 10000 倍）。
      return {
        budget: m2[0].replace(/\s+/g, ' ').trim(),
        budgetAmount: m2[2] === '万' ? num * 10000 : num,
      };
    }
  }

  return { budget: '', budgetAmount: 0 };
}

/**
 * 项目地址 →「广东省深圳市宝安区」。抽不到返回空串。
 *
 * 同样是模板里的结构化标签（`项目地址 广东省深圳市宝安区 项目类型 工程`），
 * 20 条抽样 20 命中，所以**不能**像 ygcg 那样把地区留空交给 AI 抽取。
 * 值有时会拖着详细门牌（`广东省深圳市南山区深圳市南山区南山大道3169号...`），
 * 这没关系 —— scoreRegion 是 `includes` 匹配，前缀对上就行。
 *
 * 下一个标签固定是「项目类型」，用它做右边界；缺了才退回长度截断。
 * 不做「省市区」正则校验：确实有外地项目（贵州省黔南布依族苗族自治州龙里县、
 * 四川省成都市双流县），照搬深圳的格式假设会把它们判成脏数据丢掉，
 * 而地区留空恰好会拿到 50 分中性分 —— 用户配了「排除外地」也拦不住它。
 */
function extractRegion(text: string): string {
  const m = text.match(/项目地址\s*[:：]?\s*(\S{2,60}?)\s*项目类型/) || text.match(/项目地址\s*[:：]?\s*(\S{2,60})/);
  const raw = m ? m[1].trim() : '';
  // 「项目地址 无」这类占位（实测存在「广东省深圳市福田区无」，是地址拼在省市区后面
  // 的写法，不是占位；但单独一个「无」是）。
  return /^(无|暂无|待定|-+)$/.test(raw) ? '' : raw;
}

// 「招标人：（盖章）」这类占位要丢掉，否则采购方会存成「（盖章）」。
function clean(s: string): string {
  const t = String(s || '').replace(/[（(]\s*(盖章|签字|签章|全称)\s*[)）]/g, '').trim();
  return /^[（(]|^\s*$|^-+$/.test(t) ? '' : t;
}

function extractFromDetail(text: string): {
  agencyName: string;
  contactName: string;
  contactPhone: string;
} {
  const pick = (pat: RegExp): string => {
    const m = text.match(pat);
    return m ? clean(m[1]) : '';
  };

  // 采购人**不从正文抽** —— 列表的 purchaseCom 实测 92 条里 91 条有值，
  // 而正文里 10 条抽样 0 条写了「采购人：」（这个站的正文是各家国企自己的
  // 公告模板，没有统一字段）。抽不到就留空比抽错好。
  return {
    agencyName: pick(/(?:采购代理机构|招标代理机构|代理机构)\s*(?:名称)?\s*[:：]\s*([^\s，,。；;：]{2,40})/),
    contactName: pick(/(?:联系人|项目联系人)\s*[:：]\s*([^\s，,。；;：\d]{2,20})/),
    contactPhone: (text.match(/(?:联系电话|联系方式|电\s*话)\s*[:：]\s*([\d\-—+()（）\s]{7,20})/)?.[1] || '')
      .trim()
      .replace(/\s+/g, ''),
  };
}

/**
 * 结果/无法报名类公告的兜底过滤。
 * noticeTypeCode 白名单已经挡掉了结果类栏目，但采购公告里偶尔混入「XX结果公示」
 * 这样的标题（CMS 里选错类型），按标题再挡一层（和 gdgpo 的 isExcludedNoticeType 同思路）。
 */
const EXCLUDED_TITLE_PATTERNS = [/中标/, /成交/, /结果公告/, /结果公示/, /废标/, /流标/, /失败公告/, /终止/, /候选人公示/, /合同公告/, /合同续期/, /作废/];

function isExcludedTitle(title: string): boolean {
  return EXCLUDED_TITLE_PATTERNS.some(p => p.test(title || ''));
}

/**
 * 是否「还能报名」。
 *
 * 这个站和 szecp 不同：**报名截止是结构化字段**（noticeEndTime，白名单内实测
 * 0 条为空），不需要从正文猜，所以据此过滤是安全的 —— 不像 ygcg 那样只能靠
 * 85% 覆盖率的正则推断（那种情况下过滤会丢掉还能报的项目，所以 ygcg 故意不过滤）。
 *
 * 解析不出来时返回 true（保守放过）：宁可多抓一条让用户自己判断，
 * 也不要因为平台改了日期格式就把当天所有在报项目静默丢光。
 */
function isOpenForRegistration(rawEnd: string | null | undefined, nowMs: number): boolean {
  const normalized = normalizeDateTime(rawEnd);
  if (!normalized) return true;
  const t = new Date(normalized.replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? true : t > nowMs;
}

/** 详情页 URL（给用户点的）。CMS 页面参数就是 contentId。 */
function detailPageUrl(contentId: number | string): string {
  return `${BASE_URL}/jyxxDetails.htm?contentId=${contentId}`;
}

async function fetchList(
  keyword: string,
  page: number
): Promise<{ items: SzexgrpListItem[]; totalElements: number }> {
  // **`fields` 必须传空数组**（= 返回全部字段）。传具名字段清单会让接口返回
  // `{"code":106,"message":"System internal error"}` —— 只要清单里有一个平台不认的
  // 字段名就整体报错，且是 HTTP 200 + code 106，不是 4xx。同理 channelId 缺了也 106。
  // 别为了省流量去挑字段：省不了多少，而加错一个字段名就是全量失败。
  const body = {
    channelId: CHANNEL_ID,
    fields: [],
    // title 是平台原生的关键词过滤，实测生效（宣传 → 500 条，标题 100% 命中），
    // 所以不需要抓全量再本地筛。
    title: keyword,
    // 页码**从 0 开始**（不是 1）。传 1 会跳过第一页，静默漏掉最新的 50 条。
    page,
    size: PAGE_SIZE,
  };

  const res = await fetchWithRetry(LIST_API, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`返回非 JSON（前 80 字符：${text.slice(0, 80)}）`);
  }

  if (json?.code !== 200) {
    throw new Error(`接口返回 code=${json?.code}：${json?.message || '未知错误'}`);
  }

  const data = json?.data;
  return {
    items: Array.isArray(data?.content) ? data.content : [],
    totalElements: Number(data?.totalElements) || 0,
  };
}

/**
 * 详情正文。**必须用 GET** —— 同一个 /content/detail 路径用 POST 会返回
 * 「SimpleFreeMarkerView Exception」（HTTP 200 的纯文本），不是 JSON，
 * 于是解析失败被当成网络错误重试三次。列表是 POST、详情是 GET，别顺手写成一样的。
 */
async function fetchDetailHtml(contentId: number): Promise<string> {
  const res = await fetchWithRetry(`${DETAIL_API}?contentId=${contentId}`, { headers: HEADERS }, 2);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`详情返回非 JSON（前 60 字符：${text.slice(0, 60)}）`);
  }
  if (json?.code !== 200) throw new Error(`详情 code=${json?.code}`);
  return String(json?.data?.txt || '');
}

function buildTenderItem(
  item: SzexgrpListItem,
  keyword: string,
  bodyHtml: string | null
): TenderItem {
  const contentText = bodyHtml ? stripHtml(bodyHtml) : '';
  const extracted = contentText
    ? extractFromDetail(contentText)
    : { agencyName: '', contactName: '', contactPhone: '' };
  const { budget, budgetAmount } = contentText ? extractBudget(contentText) : { budget: '', budgetAmount: 0 };
  const regionName = contentText ? extractRegion(contentText) : '';

  return {
    noticeId: String(item.contentId),
    title: item.title || '',
    publishDate: normalizeDateTime(item.releaseTime) || item.releaseTime || '',
    projectCode: item.bidSectionNumber || '',
    purchaserName: item.purchaseCom || '',
    agencyName: item.proxyComName || extracted.agencyName,
    // **列表**不给地区（areaName / projectRegion 实测 50 条全为空串），
    // 但**详情正文**里有结构化的「项目地址」标签且 20/20 命中，所以从那儿取。
    // 不按采购人猜「深圳」：确有外地子公司（深能西部能源（成都）、
    // 深圳高速物业贵州龙里分公司），猜错会让用户的地区偏好白配。
    regionName,
    regionCode: '',
    siteCode: '',
    // purchaseType 是工程/货物/服务，purchaseMethod 是公开招标/询价/竞价。
    // 拼成「采购公告 · 服务 · 公开招标」，用户一眼能看出品类和方式。
    noticeType: [item.noticeType, item.purchaseType, item.purchaseMethod].filter(Boolean).join(' · '),
    contentText: contentText.slice(0, 5000),
    contentHtml: (bodyHtml || '').slice(0, 50000),
    url: detailPageUrl(item.contentId),
    // 附件不在接口里：正文给的是「登录平台下载采购文件」，需要供应商账号。
    attachments: [],
    contactName: extracted.contactName,
    contactPhone: extracted.contactPhone,
    keyword,
    // **不要**把 szexgrp 加进 recommendService 的 PLATFORMS_WITHOUT_BUDGET：
    // 那个集合是给「平台压根不发布预算」的美的/华润用的、给满分；
    // 这个站 20 条抽样 19 条写了采购控制价，抽不到基本是解析问题，
    // 给满分等于奖励抽取失败，应该走 50 分中性兜底。
    budget: budget || '未知',
    budgetAmount,
    rawData: {
      listItem: item,
      // noticeEndTime 就是报名截止（和 noticeCloseTime 实测 100% 相同），
      // 存在 rawData 里给入库时用。
      deadline: normalizeDateTime(item.noticeEndTime),
    },
  };
}

export async function crawlSzexgrp(
  keywords: string[],
  daysLimit: number = 14,
  onProgress?: ProgressCallback
): Promise<{ logId: string; items: TenderItem[] }> {
  const db = getDatabase();
  const logId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tender_crawl_logs (id, platform, status, started_at) VALUES (?, 'szexgrp', 'running', ?)`).run(logId, now);

  const allItems: TenderItem[] = [];
  let totalFound = 0;
  let newAdded = 0;
  let duplicates = 0;
  let errors = 0;
  let skippedByType = 0;
  let skippedByTitle = 0;
  let skippedClosed = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);
  // 报名截止判定统一用同一个时刻，否则一轮抓几分钟、边界项目会前后不一致。
  const nowMs = Date.now();

  const existingHashes = new Set<string>(
    (db.prepare('SELECT content_hash FROM tenders WHERE platform = ?').all('szexgrp') as any[]).map(r => r.content_hash)
  );
  const seenHashes = new Set<string>();

  try {
    for (let ki = 0; ki < keywords.length; ki++) {
      const keyword = keywords[ki];

      onProgress?.({
        step: 'fetching',
        message: `搜索「${keyword}」(${ki + 1}/${keywords.length})`,
        current: ki + 1,
        total: keywords.length,
      });

      const wanted: SzexgrpListItem[] = [];
      let stop = false;

      // 翻到空为止（不看 totalElements —— 它恒报 1000，见 PAGE_SIZE 上面的说明）。
      for (let page = 0; page < MAX_PAGES && !stop; page++) {
        let pageItems: SzexgrpListItem[];
        try {
          if (page > 0) await randomSleep(500, 1200);
          const resp = await fetchList(keyword, page);
          pageItems = resp.items;
        } catch (e: any) {
          onProgress?.({
            step: 'fetching',
            message: `「${keyword}」第 ${page + 1} 页失败: ${e.message}`,
            current: ki + 1, total: keywords.length,
          });
          errors++;
          break;
        }

        if (pageItems.length === 0) break;
        totalFound += pageItems.length;

        for (const it of pageItems) {
          const pub = parseDate(it.releaseTime);
          // 列表按发布时间倒序（实测 page0 末条 > page1 首条），
          // 越过 cutoff 就整体收工，不用翻满 20 页。
          if (pub && pub < cutoffDate) {
            stop = true;
            break;
          }
          if (!WANTED_NOTICE_CODES.has(it.noticeTypeCode)) {
            skippedByType++;
            continue;
          }
          if (isExcludedTitle(it.title)) {
            skippedByTitle++;
            continue;
          }
          if (!isOpenForRegistration(it.noticeEndTime, nowMs)) {
            skippedClosed++;
            continue;
          }
          const hash = generateContentHash('szexgrp', it.title);
          // 详情请求前就去重，省掉最贵的那步。
          if (existingHashes.has(hash) || seenHashes.has(hash)) {
            duplicates++;
            continue;
          }
          seenHashes.add(hash);
          wanted.push(it);
        }
      }

      if (wanted.length > 0) {
        onProgress?.({
          step: 'detail',
          message: `「${keyword}」需抓取 ${wanted.length} 条详情`,
          current: ki + 1, total: keywords.length,
        });

        for (let i = 0; i < wanted.length; i++) {
          const it = wanted[i];
          let bodyHtml: string | null = null;
          try {
            if (i > 0) await randomSleep(300, 800);
            bodyHtml = await fetchDetailHtml(it.contentId);
          } catch {
            // 详情失败不丢数据：列表字段已含标题/采购人/采购方式/截止时间，照样入库。
            // 代价是没有正文和预算 —— 但有链接可点。
            errors++;
          }
          allItems.push(buildTenderItem(it, keyword, bodyHtml));
        }
      }

      if (ki < keywords.length - 1) await randomSleep(800, 1500);
    }

    onProgress?.({ step: 'saving', message: `保存到数据库 (${allItems.length} 条)...`, current: 0, total: allItems.length });

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline, budget, budget_amount, purchaser_name, agency_name, region_name, region_code, project_code, notice_type, procurement_method, content_text, content_html, url, attachments, contact_name, contact_phone, keyword, raw_data, created_at)
      VALUES (?, 'szexgrp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of allItems) {
      // content_hash 是全库唯一索引（不分平台），前缀必须带 platform 才不会跨平台撞标题
      const contentHash = generateContentHash('szexgrp', item.title);
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
      message: `Done: ${newAdded} new, ${duplicates} duplicates, ${skippedByType} skipped (结果/公示类), ${skippedByTitle} skipped (标题命中排除词), ${skippedClosed} skipped (报名已结束)`,
      current: allItems.length, total: allItems.length,
    });

  } catch (e: any) {
    console.error('[szexgrp] Crawl failed:', e);
    db.prepare(`UPDATE tender_crawl_logs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`)
      .run(e.message || 'Unknown error', new Date().toISOString(), logId);
    throw e;
  }

  return { logId, items: allItems };
}

// 仅用于单元测试/离线验证。
export const __testables = {
  stripHtml, normalizeDateTime, extractBudget, extractRegion, extractFromDetail,
  isExcludedTitle, isOpenForRegistration, detailPageUrl, WANTED_NOTICE_CODES,
};
