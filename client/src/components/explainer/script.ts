import { api, apiGet, apiPost } from '../../lib/api'
import type { StyleId, Scene, Layout } from './scene'

// 剧本（第一步 AI 的产物，给人看、给人改）。形状和服务端 services/explainer/scriptService.ts 的 Script 一致。
// 叙事角色 / 版式的名字和服务端 services/explainer/vocab.ts 一致
export const ROLES = ['hook', 'setup', 'develop', 'turn', 'payoff', 'close'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_NAMES: Record<Role, string> = { hook: '开场钩子', setup: '铺垫', develop: '展开', turn: '反转', payoff: '高潮', close: '收束' }
export const LAYOUT_NAMES: Record<Layout, string> = { hero: '主角放大', reveal: '大字揭示', compare: '左右对比', flow: '流程链', hub: '中心发散', timeline: '时间线', grid: '平均分格' }
export interface Treatment { hook: string; structure: string[]; turn: string; ending: string }
export interface ScriptShot { seconds: number; heading: string; visual: string; elements: string[]; note: string; role?: Role; layout?: Layout }
export interface Script { title: string; summary: string; style: StyleId; duration: number; shots: ScriptShot[]; treatment?: Treatment }
export const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180] as const
export const MAX_SHOTS = 30
export const MAX_PROMPT = 4000
export const durationText = (d: number) => (d >= 60 ? `${d / 60 >= 1 && d % 60 === 0 ? d / 60 : (d / 60).toFixed(1)} 分钟` : `${d} 秒`)

/** calls = 这次实际调了几次 AI（售卖型 key 每次 1 点，页面上要如实说） */
export function writeScript(body: { style: StyleId; prompt: string; duration: number }) {
  return apiPost<{ script: Script; notes: string[]; calls: number; review: { found: number; revised: boolean; remaining: number } }>('/api/explainer/script', body)
}

export function writeScene(script: Script) {
  return apiPost<{ scene: Scene; notes: string[]; calls: number }>('/api/explainer/scene', { script })
}

/**
 * 导出 MP4（后台任务）：提交 → 每 1.5 秒查一次进度（onProgress）→ 下载文件。
 * 3 分钟的片子要渲染几分钟，一个请求等到底会撞超时、而且等的时候什么进度都看不到。
 */
export async function exportVideo(scene: Scene, style: StyleId, onProgress: (done: number, total: number) => void): Promise<{ blob: Blob; notes: string[] }> {
  const start = await apiPost<{ id: string; total: number }>('/api/explainer/export', { scene, style })
  onProgress(0, start.total)
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    const j = await apiGet<{ state: 'running' | 'done' | 'failed'; done: number; total: number; notes: string[]; error?: string }>(`/api/explainer/export/${start.id}`)
    onProgress(j.done, j.total)
    if (j.state === 'failed') throw new Error(`导出失败：${j.error || '原因不明'}`)
    if (j.state === 'done') {
      const res = await api(`/api/explainer/export/${start.id}/file`)
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `下载失败（HTTP ${res.status}）`) }
      return { blob: await res.blob(), notes: j.notes }
    }
  }
}

/** 画面是按哪一版剧本生成的：剧本改过之后要能看出「预览里还是旧画面」 */
export const scriptKey = (s: Script) => JSON.stringify({ t: s.title, d: s.duration, sh: s.shots })

// 浏览器本地自动保存（作者定的第一版不落库）。存的是整个编辑状态，打开页面时恢复。
const KEY = 'explainer:draft:v1'
export interface Draft {
  style: StyleId; prompt: string; duration: number; script: Script | null; notes: string[]
  scene?: Scene | null; sceneNotes?: string[]; sceneFrom?: string
}
export function loadDraft(): Draft | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Draft) : null } catch { return null }
}
/** 存不进去（隐私模式 / 配额满）要说出来：不说的话他以为存了，刷新之后剧本没了 */
export function saveDraft(d: Draft): string {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return '' } catch (e: any) { return `本地保存失败（${e?.name || e}），刷新页面会丢掉剧本` }
}
