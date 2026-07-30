import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import type { TenderItem, ProgressCallback } from './crawlerService.js';

// 美云智数寻源云（sourcing.meicloud.com）
// 接口无需登录 / Cookie / token，WAF 为行为型：高频或并发才 403，低频串行稳定 200。
const BASE_URL = 'https://sourcing.meicloud.com';
const LIST_API = `${BASE_URL}/sourcing/front/business/search`;
const DETAIL_API = `${BASE_URL}/sourcing/front/souRequirementDetail`;

// 前端是 hash 模式路由，详情页必须带 #/。路由名在 bundle 里就叫 sourceDetai
//（官方拼写，结尾无 l），query 参数是 id 而非 headId。
function detailUrl(id: string): string {
  return `${BASE_URL}/#/sourceDetai?id=${id}`;
}

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Referer': `${BASE_URL}/`,
};

const PAGE_SIZE = 20;
const MAX_PAGES = 20;

interface MeicloudListItem {
  id: string;
  title: string;
  tips: any[];
  type: string;
  souringFrom: string;
  salesArea: string;
  sourceNo: string | null;
  expireDate: string;
  companyName: string;
  createdDate: string;
  status: string;
  applys: number;
  publishUserType: string;
  gscWxUrl: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomSleep(min: number, max: number): Promise<void> {
  return sleep(min + Math.random() * (max - min));
}

// 行为型 WAF：命中 403 要停 1~2 分钟，而不是像 gdgpo 那样退避 429。
async function fetchWithBackoff(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 403) {
      const waitTime = 60000 + attempt * 30000 + Math.random() * 15000;
      console.log(`[meicloud] WAF 403, waiting ${Math.round(waitTime / 1000)}s before retry ${attempt + 1}/${maxRetries}`);
      await sleep(waitTime);
      continue;
    }
    return res;
  }
  throw new Error('被风控拦截（403），多次重试后仍失败');
}

function generateContentHash(platform: string, title: string): string {
  return createHash('md5').update(`${platform}:${title}`).digest('hex');
}

// 只保留在招中的需求。RESULT（已出结果）/ EXPIRED（已过期）都无法再报名，不入库。
function isWanted(item: MeicloudListItem): boolean {
  return item.status === 'PUBLISHED';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 列表返回 ISO 带时区（2026-07-22T09:57:09.000+0000），详情返回已转好的本地时间
// （2026-07-22 17:57:09）。统一成本地墙上时间 "YYYY-MM-DD HH:mm:ss"。
function toLocalDateTime(raw: string): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return raw.replace('T', ' ');
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : formatLocal(d);
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(' ', 'T') : raw);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchList(keyword: string, pageNo: number): Promise<{ items: MeicloudListItem[]; pages: number }> {
  const params = new URLSearchParams({
    keywords: keyword,
    sellArea: '',
    sourcingType: '',
    orderBy: '',
    sortType: '',
    pageSize: String(PAGE_SIZE),
    pageNo: String(pageNo),
  });

  const res = await fetchWithBackoff(`${LIST_API}?${params}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[meicloud] List API returned ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`列表接口返回 ${res.status}`);
  }

  const json = await res.json() as any;
  if (json?.success === false) {
    throw new Error(`列表接口报错: ${json?.retMsg || json?.retCode || 'unknown'}`);
  }
  return {
    items: json?.data?.list || [],
    pages: json?.data?.pages || 1,
  };
}

// 4 个详情接口都是 POST，headId 放在 query string 而不是 body。
async function postDetail(path: string, headId: string): Promise<any> {
  const res = await fetchWithBackoff(`${DETAIL_API}/${path}?headId=${headId}`, {
    method: 'POST',
    headers: HEADERS,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const json = await res.json() as any;
  return json?.data ?? null;
}

function buildTenderItem(
  item: MeicloudListItem,
  head: any,
  demands: any,
  attachs: any,
  details: any,
  keyword: string
): TenderItem {
  const contentHtml = head?.requirementDesc || '';
  const abstract = head?.requirementAbstract || '';
  const contentText = stripHtml([abstract, contentHtml].filter(Boolean).join('\n'));

  // fileDocId 实测为 null，暂时拿不到可下载地址，只留文件名。
  const attachments = Array.isArray(attachs)
    ? attachs.map((a: any) => ({ fileName: a?.attachmentName || '', url: '' }))
    : [];

  return {
    noticeId: item.id,
    title: head?.requirementTitle || item.title,
    publishDate: toLocalDateTime(head?.publishTime || item.createdDate),
    projectCode: head?.requirementNo || '',
    purchaserName: head?.companyName || item.companyName || '',
    agencyName: '',
    regionName: item.salesArea || head?.tradingPlace || '',
    regionCode: '',
    siteCode: 'meicloud',
    noticeType: item.type || head?.requirementType || '',
    contentText: contentText.slice(0, 5000),
    contentHtml: contentHtml.slice(0, 50000),
    url: detailUrl(item.id),
    attachments,
    // 平台把联系人整体打码（linkMan "****" / contactTel "134****5608"），存了也用不了。
    contactName: '',
    contactPhone: '',
    keyword,
    // 该平台不发布预算金额，标记为未知；预算轴由 recommendService 按平台给满分。
    budget: '未知',
    budgetAmount: 0,
    rawData: { listItem: item, head, demands, attachs, details },
  };
}

export async function crawlMeicloud(
  keywords: string[],
  daysLimit: number = 14,
  onProgress?: ProgressCallback
): Promise<{ logId: string; items: TenderItem[] }> {
  const db = getDatabase();
  const logId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tender_crawl_logs (id, platform, status, started_at) VALUES (?, 'meicloud', 'running', ?)`).run(logId, now);

  const allItems: TenderItem[] = [];
  let totalFound = 0;
  let newAdded = 0;
  let duplicates = 0;
  let errors = 0;
  let skippedByStatus = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);

  const existingHashes = new Set<string>(
    (db.prepare('SELECT content_hash FROM tenders WHERE platform = ?').all('meicloud') as any[]).map(r => r.content_hash)
  );
  const seenHashes = new Set<string>();

  try {
    for (let ki = 0; ki < keywords.length; ki++) {
      const keyword = keywords[ki];
      onProgress?.({ step: 'fetching', message: `搜索关键词: ${keyword} (${ki + 1}/${keywords.length})`, current: ki + 1, total: keywords.length });

      // 列表按 createdDate 倒序返回，因此翻到整页都早于 cutoff 就可以提前收工。
      const recentItems: MeicloudListItem[] = [];
      let pages = 1;
      let stop = false;

      for (let page = 1; page <= Math.min(pages, MAX_PAGES) && !stop; page++) {
        let pageItems: MeicloudListItem[];
        try {
          if (page > 1) await randomSleep(1000, 2000);
          const resp = await fetchList(keyword, page);
          pageItems = resp.items;
          pages = resp.pages;
        } catch (e: any) {
          onProgress?.({ step: 'fetching', message: `"${keyword}" 第 ${page} 页请求失败: ${e.message}`, current: ki + 1, total: keywords.length });
          errors++;
          break;
        }

        if (pageItems.length === 0) break;

        for (const it of pageItems) {
          const created = parseDate(it.createdDate);
          if (created && created < cutoffDate) {
            stop = true;
            continue;
          }
          recentItems.push(it);
        }
      }

      onProgress?.({ step: 'fetching', message: `"${keyword}" ${recentItems.length} 条在 ${daysLimit} 天内`, current: ki + 1, total: keywords.length });

      // 非在招状态在列表阶段就丢掉，省下每条 4 个详情 POST
      const wantedItems = recentItems.filter(isWanted);
      const skippedNow = recentItems.length - wantedItems.length;
      if (skippedNow > 0) {
        skippedByStatus += skippedNow;
        onProgress?.({ step: 'fetching', message: `"${keyword}" 忽略 ${skippedNow} 条非在招公告（已出结果/已过期）`, current: ki + 1, total: keywords.length });
      }

      const newItems = wantedItems.filter(item => {
        const hash = generateContentHash('meicloud', item.title);
        if (existingHashes.has(hash) || seenHashes.has(hash)) return false;
        seenHashes.add(hash);
        return true;
      });

      if (wantedItems.length > 0 && newItems.length < wantedItems.length) {
        onProgress?.({ step: 'fetching', message: `"${keyword}" 去重后 ${newItems.length} 条新数据（跳过 ${wantedItems.length - newItems.length} 条已有）`, current: ki + 1, total: keywords.length });
      }

      totalFound += newItems.length;

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        onProgress?.({ step: 'detail', message: `[${keyword}] ${i + 1}/${newItems.length}: ${item.title.slice(0, 30)}`, current: i + 1, total: newItems.length });

        try {
          // 详情由 4 个独立接口拼成，全部串行且每次间隔 ≥1s
          await randomSleep(1000, 2000);
          const head = await postDetail('getHead', item.id);
          await randomSleep(1000, 2000);
          const details = await postDetail('getDetails', item.id);
          await randomSleep(1000, 2000);
          const demands = await postDetail('getDemands', item.id);
          await randomSleep(1000, 2000);
          const attachs = await postDetail('getAttachs', item.id);

          allItems.push(buildTenderItem(item, head, demands, attachs, details, keyword));
        } catch (e: any) {
          console.error(`[meicloud] Failed detail for ${item.id}:`, e.message);
          allItems.push(buildTenderItem(item, null, null, null, null, keyword));
          errors++;
        }
      }

      if (ki < keywords.length - 1) {
        await randomSleep(2000, 4000);
      }
    }

    onProgress?.({ step: 'saving', message: `保存到数据库 (${allItems.length} 条)...`, current: 0, total: allItems.length });

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline, budget, budget_amount, purchaser_name, agency_name, region_name, region_code, project_code, notice_type, procurement_method, content_text, content_html, url, attachments, contact_name, contact_phone, keyword, raw_data, created_at)
      VALUES (?, 'meicloud', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of allItems) {
      // content_hash 是全库唯一索引（不分平台），前缀必须带 platform 才不会跨平台撞标题
      const contentHash = generateContentHash('meicloud', item.title);
      const deadline = toLocalDateTime(item.rawData?.head?.expirationTime || item.rawData?.listItem?.expireDate || '');
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
      if (result.changes > 0) {
        newAdded++;
      } else {
        duplicates++;
      }
    }

    db.prepare(`UPDATE tender_crawl_logs SET status = 'completed', total_found = ?, new_added = ?, duplicates = ?, errors = ?, completed_at = ? WHERE id = ?`)
      .run(totalFound, newAdded, duplicates, errors, new Date().toISOString(), logId);

    onProgress?.({ step: 'done', message: `Done: ${newAdded} new, ${duplicates} duplicates, ${skippedByStatus} skipped (非在招)`, current: allItems.length, total: allItems.length });

  } catch (e: any) {
    console.error('[meicloud] Crawl failed:', e);
    db.prepare(`UPDATE tender_crawl_logs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`)
      .run(e.message || 'Unknown error', new Date().toISOString(), logId);
    throw e;
  }

  return { logId, items: allItems };
}
