import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';

export interface TenderItem {
  noticeId: string;
  title: string;
  publishDate: string;
  projectCode: string;
  purchaserName: string;
  agencyName: string;
  regionName: string;
  regionCode: string;
  siteCode: string;
  noticeType: string;
  contentText: string;
  contentHtml: string;
  url: string;
  attachments: Array<{ fileName: string; url: string }>;
  contactName: string;
  contactPhone: string;
  keyword: string;
  budget: string;
  budgetAmount: number;
  rawData: any;
}

interface ListItem {
  noticeId: string;
  noticeTitle: string;
  publishDate: string;
  projectCode: string;
  siteCode: string;
  regionCode: string;
  regionName: string;
  noticeSecondType: string;
  noticeSecondTypeDesc: string;
  tradingProcess: string;
  projectType: string;
  edition: string;
  datasetName: string;
  pubServicePlat: string;
  projectOwner: string;
  noticeNature: string;
}

const BASE_URL = 'https://ygp.gdzwfw.gov.cn';
const LIST_API = `${BASE_URL}/ggzy-portal/search/v2/items`;
const SINGLE_NODE_API = `${BASE_URL}/ggzy-portal/center/apis/trading-notice/new/singleNode`;
const DETAIL_API = `${BASE_URL}/ggzy-portal/center/apis/trading-notice/new/detail`;

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Origin': 'https://ygp.gdzwfw.gov.cn',
  'Referer': 'https://ygp.gdzwfw.gov.cn/',
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomSleep(min: number, max: number): Promise<void> {
  return sleep(min + Math.random() * (max - min));
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      const waitTime = (attempt + 1) * 10000 + Math.random() * 5000;
      console.log(`[tender] Rate limited (429), waiting ${Math.round(waitTime / 1000)}s before retry ${attempt + 1}/${maxRetries}`);
      await sleep(waitTime);
      continue;
    }
    return res;
  }
  throw new Error('Rate limited after max retries');
}

function generateContentHash(platform: string, title: string): string {
  return createHash('md5').update(`${platform}:${title}`).digest('hex');
}

function parsePublishDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Format: "20260709143218" (yyyyMMddHHmmss)
  if (/^\d{14}$/.test(dateStr)) {
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    const h = dateStr.slice(8, 10);
    const min = dateStr.slice(10, 12);
    const s = dateStr.slice(12, 14);
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
  }
  // Format: "20260709" (yyyyMMdd)
  if (/^\d{8}$/.test(dateStr)) {
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    return new Date(`${y}-${m}-${d}`);
  }
  // Try standard parse
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateToISO(dateStr: string): string {
  const d = parsePublishDate(dateStr);
  if (!d) return dateStr;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractBudget(text: string): { budget: string; budgetAmount: number } {
  const patterns = [
    /预算[金额：:]*\s*([\d,.]+)\s*万?元/,
    /控制价[：:]*\s*([\d,.]+)\s*万?元/,
    /合同估算价[：:]*\s*([\d,.]+)\s*万?元/,
    /([\d,.]+)\s*万元/,
  ];
  for (const pat of patterns) {
    const match = text.match(pat);
    if (match) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num) && num > 0) {
        const isWan = text.includes('万');
        const amount = isWan ? num * 10000 : num;
        return { budget: match[0], budgetAmount: amount };
      }
    }
  }
  return { budget: '', budgetAmount: 0 };
}

async function fetchList(keyword: string, pageNo: number = 1, pageSize: number = 15): Promise<ListItem[]> {
  const body = {
    type: 'trading-type',
    openConvert: false,
    keyword,
    siteCode: '44',
    secondType: 'D',
    tradingProcess: '',
    thirdType: '[]',
    projectType: '',
    publishStartTime: '',
    publishEndTime: '',
    pageNo,
    pageSize,
  };

  const res = await fetchWithRetry(LIST_API, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[tender] List API returned ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`List API returned ${res.status}`);
  }
  const json = await res.json() as any;
  const items = json?.data?.pageData || json?.data?.data || [];
  if (items.length === 0) {
    console.log(`[tender] fetchList("${keyword}") returned 0 items. Response keys: ${JSON.stringify(Object.keys(json?.data || {}))}`);
  }
  return items;
}

async function fetchNodeId(item: ListItem): Promise<string | null> {
  // singleNode API needs the right siteCode level — try region code fallbacks
  const siteCode = item.regionCode || '44';
  const codesToTry = [siteCode];
  // Add parent codes: 440101 → 440100 → 44
  if (siteCode.length === 6) {
    codesToTry.push(siteCode.slice(0, 4) + '00'); // city level
    codesToTry.push(siteCode.slice(0, 2));        // province level
  } else if (siteCode.length === 4) {
    codesToTry.push(siteCode.slice(0, 2));
  }

  for (const code of codesToTry) {
    const params = new URLSearchParams({
      siteCode: code,
      tradingType: item.noticeSecondType || '',
      bizCode: item.tradingProcess || '',
      classify: item.projectType || '',
    });

    const res = await fetchWithRetry(`${SINGLE_NODE_API}?${params}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) continue;
    const json = await res.json() as any;
    const data = json?.data;
    if (!data) continue;
    if (typeof data === 'string') return data;
    if (data.nodeId || data.id) return data.nodeId || data.id;
  }

  return null;
}

async function fetchDetail(item: ListItem, nodeId: string): Promise<any> {
  const params = new URLSearchParams({
    nodeId,
    version: item.edition || 'v3',
    tradingType: item.noticeSecondType || '',
    noticeId: item.noticeId,
    bizCode: item.tradingProcess || '',
    projectCode: item.projectCode || '',
    siteCode: item.regionCode || '44',
  });

  const res = await fetchWithRetry(`${DETAIL_API}?${params}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return null;
  const json = await res.json() as any;
  return json?.data || null;
}

function parseDetail(item: ListItem, detail: any, keyword: string): TenderItem {
  let contentHtml = '';
  let contentText = '';
  const attachments: Array<{ fileName: string; url: string }> = [];
  let purchaserName = item.projectOwner || '';
  let agencyName = '';
  let contactName = '';
  let contactPhone = '';

  if (detail?.tradingNoticeColumnModelList) {
    for (const col of detail.tradingNoticeColumnModelList) {
      if (col.viewStyle === 'richText' && col.richtext) {
        contentHtml += col.richtext;
      }
      if (col.multiKeyValueTableList) {
        for (const table of col.multiKeyValueTableList) {
          for (const field of table) {
            switch (field.code) {
              case 'PURCHASER_ORG_NAME':
                if (field.value) purchaserName = field.value;
                break;
              case 'AGENCY_NAME':
                if (field.value) agencyName = field.value;
                break;
              case 'MANAGER_NAME':
                if (field.value) contactName = field.value;
                break;
              case 'MANAGER_LINK_PHONE':
                if (field.value) contactPhone = field.value;
                break;
            }
          }
        }
      }
      if (col.noticeFileBOList) {
        for (const file of col.noticeFileBOList) {
          attachments.push({ fileName: file.fileName || '', url: file.url || '' });
        }
      }
    }
  }

  contentText = stripHtml(contentHtml);
  const { budget, budgetAmount } = extractBudget(contentText);

  const detailUrl = `${BASE_URL}/#/44/new/jygg/v3/${item.noticeSecondType}?noticeId=${item.noticeId}&projectCode=${item.projectCode || ''}&bizCode=${item.tradingProcess || ''}&siteCode=${item.regionCode || '44'}&publishDate=${item.publishDate || ''}&classify=${item.projectType || ''}`;

  return {
    noticeId: item.noticeId,
    title: detail?.title || item.noticeTitle,
    publishDate: formatDateToISO(detail?.publishDate || item.publishDate),
    projectCode: item.projectCode || '',
    purchaserName,
    agencyName,
    regionName: item.regionName || '',
    regionCode: item.regionCode || '',
    siteCode: item.regionCode || '44',
    noticeType: item.datasetName || item.noticeNature || '',
    contentText: contentText.slice(0, 5000),
    contentHtml: contentHtml.slice(0, 50000),
    url: detailUrl,
    attachments,
    contactName,
    contactPhone,
    keyword,
    budget,
    budgetAmount,
    rawData: { listItem: item, detail },
  };
}

function parseListOnly(item: ListItem, keyword: string): TenderItem {
  const detailUrl = `${BASE_URL}/#/44/new/jygg/v3/${item.noticeSecondType}?noticeId=${item.noticeId}&projectCode=${item.projectCode || ''}&bizCode=${item.tradingProcess || ''}&siteCode=${item.regionCode || '44'}&publishDate=${item.publishDate || ''}&classify=${item.projectType || ''}`;

  return {
    noticeId: item.noticeId,
    title: item.noticeTitle,
    publishDate: formatDateToISO(item.publishDate),
    projectCode: item.projectCode || '',
    purchaserName: item.projectOwner || '',
    agencyName: '',
    regionName: item.regionName || '',
    regionCode: item.regionCode || '',
    siteCode: item.regionCode || '44',
    noticeType: item.datasetName || item.noticeNature || '',
    contentText: '',
    contentHtml: '',
    url: detailUrl,
    attachments: [],
    contactName: '',
    contactPhone: '',
    keyword,
    budget: '',
    budgetAmount: 0,
    rawData: { listItem: item },
  };
}

export interface CrawlProgress {
  step: string;
  message: string;
  current: number;
  total: number;
}

export type ProgressCallback = (progress: CrawlProgress) => void;

export async function crawlGdgpo(
  keywords: string[],
  daysLimit: number = 14,
  onProgress?: ProgressCallback
): Promise<{ logId: string; items: TenderItem[] }> {
  const db = getDatabase();
  const logId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tender_crawl_logs (id, platform, status, started_at) VALUES (?, 'gdgpo', 'running', ?)`).run(logId, now);

  const allItems: TenderItem[] = [];
  let totalFound = 0;
  let newAdded = 0;
  let duplicates = 0;
  let errors = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);

  // Pre-load existing hashes for early dedup
  const existingHashes = new Set<string>(
    (db.prepare('SELECT content_hash FROM tenders WHERE platform = ?').all('gdgpo') as any[]).map(r => r.content_hash)
  );
  const seenHashes = new Set<string>();

  try {
    for (let ki = 0; ki < keywords.length; ki++) {
      const keyword = keywords[ki];
      onProgress?.({ step: 'fetching', message: `搜索关键词: ${keyword} (${ki + 1}/${keywords.length})`, current: ki + 1, total: keywords.length });

      let listItems: ListItem[];
      try {
        listItems = await fetchList(keyword, 1, 15);
        onProgress?.({ step: 'fetching', message: `"${keyword}" 返回 ${listItems.length} 条结果`, current: ki + 1, total: keywords.length });
      } catch (e: any) {
        onProgress?.({ step: 'fetching', message: `"${keyword}" 请求失败: ${e.message}`, current: ki + 1, total: keywords.length });
        errors++;
        continue;
      }

      const recentItems = listItems.filter(item => {
        if (!item.publishDate) return true;
        const pubDate = parsePublishDate(item.publishDate);
        if (!pubDate) return true;
        return pubDate >= cutoffDate;
      });

      if (listItems.length > 0 && recentItems.length < listItems.length) {
        onProgress?.({ step: 'fetching', message: `"${keyword}" ${listItems.length} 条中 ${recentItems.length} 条在时间范围内`, current: ki + 1, total: keywords.length });
      }

      // Early dedup: skip items already in DB or already seen this run
      const newItems = recentItems.filter(item => {
        const hash = generateContentHash('gdgpo', item.noticeTitle);
        if (existingHashes.has(hash) || seenHashes.has(hash)) return false;
        seenHashes.add(hash);
        return true;
      });

      if (recentItems.length > 0 && newItems.length < recentItems.length) {
        onProgress?.({ step: 'fetching', message: `"${keyword}" 去重后 ${newItems.length} 条新数据（跳过 ${recentItems.length - newItems.length} 条已有）`, current: ki + 1, total: keywords.length });
      }

      totalFound += newItems.length;

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        onProgress?.({ step: 'detail', message: `[${keyword}] ${i + 1}/${newItems.length}: ${item.noticeTitle.slice(0, 30)}`, current: i + 1, total: newItems.length });

        let tenderItem: TenderItem;
        try {
          await randomSleep(1500, 3000);
          const nodeId = await fetchNodeId(item);
          if (nodeId) {
            await randomSleep(1000, 2000);
            const detail = await fetchDetail(item, nodeId);
            tenderItem = detail ? parseDetail(item, detail, keyword) : parseListOnly(item, keyword);
          } else {
            tenderItem = parseListOnly(item, keyword);
          }
        } catch (e: any) {
          console.error(`[tender] Failed detail for ${item.noticeId}:`, e.message);
          tenderItem = parseListOnly(item, keyword);
          errors++;
        }

        allItems.push(tenderItem);
      }

      if (ki < keywords.length - 1) {
        await randomSleep(3000, 6000);
      }
    }

    // Save to database
    onProgress?.({ step: 'saving', message: `保存到数据库 (${allItems.length} 条)...`, current: 0, total: allItems.length });

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO tenders (id, platform, notice_id, content_hash, title, publish_date, budget, budget_amount, purchaser_name, agency_name, region_name, region_code, project_code, notice_type, procurement_method, content_text, content_html, url, attachments, contact_name, contact_phone, keyword, raw_data, created_at)
      VALUES (?, 'gdgpo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of allItems) {
      const contentHash = generateContentHash('gdgpo', item.title);
      const result = insertStmt.run(
        uuidv4(),
        item.noticeId,
        contentHash,
        item.title,
        item.publishDate,
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

    onProgress?.({ step: 'done', message: `Done: ${newAdded} new, ${duplicates} duplicates`, current: allItems.length, total: allItems.length });

  } catch (e: any) {
    console.error('[tender] Crawl failed:', e);
    db.prepare(`UPDATE tender_crawl_logs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`)
      .run(e.message || 'Unknown error', new Date().toISOString(), logId);
    throw e;
  }

  return { logId, items: allItems };
}
