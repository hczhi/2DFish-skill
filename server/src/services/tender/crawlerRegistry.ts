import { crawlGdgpo, type CrawlProgress, type ProgressCallback } from './crawlerService.js';
import { crawlMeicloud } from './meicloudCrawlerService.js';
import { crawlSzecp } from './szecpCrawlerService.js';
import { crawlYgcg } from './ygcgCrawlerService.js';

export interface CrawlerDef {
  id: string;
  name: string;
  description: string;
  crawl: (keywords: string[], daysLimit: number, onProgress?: ProgressCallback) => Promise<{ logId: string; items: any[] }>;
}

const registry: Map<string, CrawlerDef> = new Map();

registry.set('gdgpo', {
  id: 'gdgpo',
  name: '广东省政府采购网',
  description: '广东省政府采购网 (ygp.gdzwfw.gov.cn)',
  crawl: crawlGdgpo,
});

registry.set('meicloud', {
  id: 'meicloud',
  name: '美的询源云',
  description: '美云智数寻源云 (sourcing.meicloud.com)',
  crawl: crawlMeicloud,
});

registry.set('szecp', {
  id: 'szecp',
  name: '华润守正',
  description: '华润守正采购交易平台 (www.szecp.com.cn)',
  crawl: crawlSzecp,
});

registry.set('ygcg', {
  id: 'ygcg',
  name: '广州国企阳光采购',
  description: '广州国企阳光采购信息发布平台 (ygcg.gzggzy.cn)',
  crawl: crawlYgcg,
});

export function getCrawler(platformId: string): CrawlerDef | undefined {
  return registry.get(platformId);
}

export function getAllPlatforms(): Array<{ id: string; name: string; description: string }> {
  return Array.from(registry.values()).map(c => ({ id: c.id, name: c.name, description: c.description }));
}

export function registerCrawler(def: CrawlerDef) {
  registry.set(def.id, def);
}
