import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import { exportVideo, FPS } from './exportService.js';
import { ExplainerError, type StyleId } from './scriptService.js';

// 导出改成后台任务：3 分钟的片子要渲染 5400 帧（几分钟），一个 HTTP 请求等到底的话会撞上 Node 的请求超时，
// 而等的那几分钟页面上什么进度都没有，他会以为卡死了去刷新（刷新之后导出照样在跑、点数照样在冻结）。
// 任务只在内存里（服务重启 = 任务没了，查询时如实回「找不到」）；文件在临时目录，导完留 30 分钟可以重复下载。

export interface ExportJob {
  id: string; userId: string; state: 'running' | 'done' | 'failed'
  done: number; total: number; notes: string[]; error?: string; status?: number
  file: string; title: string; startedAt: number; endedAt?: number
}
const jobs = new Map<string, ExportJob>();
const KEEP_MS = 30 * 60_000;

/** 开一个导出任务。onSettle 在成功 / 失败之后各调一次（扣点结算 / 解冻在调用方） */
export function startExport(spec: { scene: any; style: StyleId }, userId: string, onSettle: (ok: boolean) => void): ExportJob {
  const id = randomUUID();
  const job: ExportJob = {
    id, userId, state: 'running', done: 0, total: Math.round(Number(spec.scene.duration) * FPS[spec.style]),
    notes: [], file: path.join(tmpdir(), `explainer-${id}.mp4`), title: String(spec.scene.title || ''), startedAt: Date.now(),
  };
  jobs.set(id, job);
  exportVideo(spec, job.file, (d, t) => { job.done = d; job.total = t; })
    .then((r) => { job.state = 'done'; job.notes = r.notes; onSettle(true); console.log(`[explainer] export ${spec.style} ${spec.scene.duration}s ${r.frames} frames in ${(r.ms / 1000).toFixed(1)}s`); })
    .catch((e: any) => { job.state = 'failed'; job.error = e?.message || String(e); job.status = e instanceof ExplainerError ? e.status : 500; onSettle(false); })
    .finally(() => {
      job.endedAt = Date.now();
      setTimeout(() => { jobs.delete(id); rm(job.file, { force: true }).catch(() => {}); }, KEEP_MS).unref();
    });
  return job;
}

/** 只给发起导出的那个人看；别人的（或已经过期的）一律当找不到 */
export function getJob(id: string, userId: string): ExportJob | null {
  const j = jobs.get(id);
  return j && j.userId === userId ? j : null;
}
