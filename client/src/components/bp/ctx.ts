import type { ComputedRef, InjectionKey } from 'vue'

// 报告页往下传的那几样（补充资料面板 / 来源列表的「排除」按钮要用）。由 BpReport.vue provide。

export interface Material { id: string; chapter: string; kind: 'url' | 'file' | 'exclude'; title: string; url: string; chars: number; created_at: string }

export interface BpReportCtx {
  reportId: string
  materials: ComputedRef<Material[]>
  /** 报告在跑时不许改补充资料（跑到一半换资料，前后几章用的不是同一组）。 */
  editable: ComputedRef<boolean>
  refresh: () => Promise<void>
  rerun: (step: string) => void
}

export const BP_CTX: InjectionKey<BpReportCtx> = Symbol('bpReportCtx')
