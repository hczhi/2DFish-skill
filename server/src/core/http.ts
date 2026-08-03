import type { Request, Response } from 'express';
import type { Database } from 'better-sqlite3';

// ============================================================================
// API 层的三个高频样板：分页解析、字段级 PATCH、SSE 初始化。
// 抽出来的目的不只是少写几行，每一处都修掉了散落副本里的真实缺陷：
//
//   parsePagination —— 旧写法有两种，其中 `Math.min(50, parseInt(x) || 20)`
//     缺下界钳制：page_size=-5 会算出负数 LIMIT。这里统一钳到 [1, max]。
//
//   patchRow —— 旧写法有两类：
//     (a) 逐字段一条 UPDATE（tender.ts）——N 次写、非原子，中途出错留下半更新；
//     (b) 手拼 `${field} = ?` 片段（6 个文件）——列名是字符串插值进 SQL 的，
//         只靠调用点自己记得先过 allowed 白名单，漏一次就是注入。
//     收口后列名必须先过标识符校验再插值，安全由构造保证而非靠调用方自律。
//
//   initSSE —— 5 处一模一样的三行响应头 + 各自重写一遍 sendEvent。
// ============================================================================

/** SQL 标识符（表名/列名）白名单形状。只允许字母数字下划线。 */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(name: string, kind: 'table' | 'column'): void {
  if (!IDENT_RE.test(name)) {
    // 走到这里说明代码里写死的表名/列名有问题，是开发期错误，不是用户输入问题。
    throw new Error(`非法的 ${kind} 名: ${name}`);
  }
}

// ==================== 分页 ====================

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginationOptions {
  /** 默认每页条数 */
  defaultSize?: number;
  /** 每页条数上限，防止 page_size=100000 拖垮库 */
  maxSize?: number;
}

/**
 * 从 query 里解析 page / page_size，并钳到合法区间。
 * 非法输入（负数、0、NaN、超大值）一律回落到安全值，绝不产出负数 LIMIT/OFFSET。
 */
export function parsePagination(req: Request, opts: PaginationOptions = {}): Pagination {
  const { defaultSize = 20, maxSize = 100 } = opts;

  const rawPage = parseInt(req.query.page as string, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawSize = parseInt(req.query.page_size as string, 10);
  const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : defaultSize;
  const pageSize = Math.min(size, maxSize);

  return { page, pageSize, offset: (page - 1) * pageSize };
}

// ==================== 字段级 PATCH ====================

export interface PatchSpec {
  /** 允许被更新的列。不在这个列表里的 body 字段一律忽略。 */
  columns: string[];
  /** 需要转成 0/1 存的列（SQLite 没有 boolean 类型）。 */
  booleans?: string[];
  /** 需要 JSON.stringify 后存的列。 */
  json?: string[];
  /** 是否顺带写 updated_at（表得有这一列）。默认 true。 */
  touchUpdatedAt?: boolean;
}

/**
 * 按白名单从 body 里挑出要更新的列，拼成一条 UPDATE 执行。
 *
 * 返回被更新的列数；返回 0 表示 body 里没有任何可更新字段
 * （调用方通常应回 400 "no fields to update"）。
 *
 * 与旧写法的区别：一条 SQL 完成（原子），且列名在插值前强制过标识符校验。
 */
export function patchRow(
  db: Database,
  table: string,
  spec: PatchSpec,
  body: Record<string, any>,
  where: Record<string, any>
): number {
  assertIdent(table, 'table');

  const booleans = new Set(spec.booleans || []);
  const jsonCols = new Set(spec.json || []);

  const sets: string[] = [];
  const values: any[] = [];

  for (const col of spec.columns) {
    if (body[col] === undefined) continue;
    assertIdent(col, 'column');

    let val = body[col];
    if (booleans.has(col)) val = val ? 1 : 0;
    else if (jsonCols.has(col)) val = JSON.stringify(val ?? null);

    sets.push(`${col} = ?`);
    values.push(val);
  }

  const changedColumns = sets.length;
  if (changedColumns === 0) return 0;

  if (spec.touchUpdatedAt !== false) {
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
  }

  const whereKeys = Object.keys(where);
  if (whereKeys.length === 0) throw new Error('patchRow 必须带 where 条件');
  for (const k of whereKeys) assertIdent(k, 'column');
  const whereSql = whereKeys.map((k) => `${k} = ?`).join(' AND ');
  values.push(...whereKeys.map((k) => where[k]));

  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereSql}`).run(...values);
  return changedColumns;
}

// ==================== SSE ====================

export type SendEvent = (event: string, data: unknown) => void;

/**
 * 初始化 SSE 响应头并返回 sendEvent。
 * 加了两个原来各处都漏的头：
 *   X-Accel-Buffering: no —— nginx 默认会缓冲响应体，导致流式输出攒到最后才吐；
 *   flushHeaders()      —— 让客户端立刻拿到 200 和头，而不是等第一个 chunk。
 */
export function initSSE(res: Response): SendEvent {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  return (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}
