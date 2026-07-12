import { crawlGdgpo, type CrawlProgress, type ProgressCallback } from './crawlerService.js';

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

export function getCrawler(platformId: string): CrawlerDef | undefined {
  return registry.get(platformId);
}

export function getAllPlatforms(): Array<{ id: string; name: string; description: string }> {
  return Array.from(registry.values()).map(c => ({ id: c.id, name: c.name, description: c.description }));
}

export function registerCrawler(def: CrawlerDef) {
  registry.set(def.id, def);
}
