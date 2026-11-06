import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import type { ExtraSource } from './sources.js';

// 报告页人工补的资料（migration 126）。补了不会自己生效 —— 要「重跑这一章」，界面上那颗按钮就在面板里。

export const MATERIAL_CHAPTERS = ['credit', 'team', 'industry', 'competitors', 'investors'] as const;
export type MaterialChapter = (typeof MATERIAL_CHAPTERS)[number];
export type MaterialKind = 'url' | 'file' | 'exclude';

/** 一份补充资料的正文上限。只拒不截：截掉的后半篇里那几个数字，他会以为 AI 读过。 */
export const MAX_MATERIAL_CHARS = 80_000;
/** 每章最多补几份（含排除）。再多的话这一章的资料预算全被它们吃掉，检索结果一条都进不去。 */
export const MAX_MATERIALS_PER_CHAPTER = 10;

export interface Material {
  id: string; chapter: MaterialChapter; kind: MaterialKind;
  title: string; url: string; chars: number; created_at: string;
}

export function listMaterials(reportId: string): Material[] {
  return (getDatabase()
    .prepare(`SELECT id, chapter, kind, title, url, length(content) AS chars, created_at FROM bp_report_materials WHERE report_id = ? ORDER BY created_at`)
    .all(reportId) as Material[]);
}

export function countMaterials(reportId: string, chapter: string): number {
  return (getDatabase().prepare(`SELECT count(*) n FROM bp_report_materials WHERE report_id = ? AND chapter = ?`).get(reportId, chapter) as { n: number }).n;
}

export function addMaterial(input: { reportId: string; chapter: MaterialChapter; kind: MaterialKind; title: string; url: string; content: string }): string {
  const id = uuidv4();
  getDatabase()
    .prepare(`INSERT INTO bp_report_materials (id, report_id, chapter, kind, title, url, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.reportId, input.chapter, input.kind, input.title, input.url, input.content, new Date().toISOString());
  return id;
}

export function deleteMaterial(reportId: string, id: string): boolean {
  return getDatabase().prepare(`DELETE FROM bp_report_materials WHERE id = ? AND report_id = ?`).run(id, reportId).changes === 1;
}

/** 给 gatherSources 的那两样：本章要排除的链接、本章的补充资料。 */
export function materialsFor(reportId: string, chapter: MaterialChapter): { exclude: Set<string>; extra: ExtraSource[] } {
  const rows = getDatabase()
    .prepare(`SELECT kind, title, url, content FROM bp_report_materials WHERE report_id = ? AND chapter = ? ORDER BY created_at`)
    .all(reportId, chapter) as { kind: MaterialKind; title: string; url: string; content: string }[];
  return {
    exclude: new Set(rows.filter((r) => r.kind === 'exclude').map((r) => r.url)),
    extra: rows.filter((r) => r.kind !== 'exclude').map((r) => ({ title: r.title, url: r.url, content: r.content })),
  };
}
