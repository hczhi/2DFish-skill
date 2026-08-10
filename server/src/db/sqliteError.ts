/**
 * 「这个错是唯一约束冲突吗」。
 *
 * 独立成文件是因为有两处要用，而这个判断**写错了不会报错，只会静默改变行为**：
 * 判宽了（比如 `catch {}` 全吞）会把真正的库故障当成"已存在"，
 * 判窄了会让本该走"已存在"分支的路径抛 500。
 *
 * 只认 code，不匹配 message：message 会带上索引名，而那串名字改一次
 * （比如往索引里加个字段）这里就静默失效。
 */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
