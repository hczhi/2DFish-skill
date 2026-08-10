import type { Migration } from '../migrator.js';
import { normalizeBaseUrl } from '../../core/llm/baseUrl.js';

// 修历史数据：base_url 里粘进了完整的 `.../v1/chat/completions`（以及前后空格）。
//
// OpenAI SDK 的 baseURL 是**前缀**，它自己会拼 `/chat/completions`，
// 于是请求打到 `/v1/chat/completions/chat/completions`，上游回
// 404 «Invalid URL (POST /v1/chat/completions /chat/completions)»。
// 这个报错读起来像「key 不对 / 模型不存在」，跟地址没有任何字面关联 ——
// 管理员会反复检查 key。各家平台文档、curl 示例给的都是完整地址，
// 所以这是必然会重复发生的粘贴错误，不是一次性事故：
// 写入路径（upsertProvider / POST /config）和读取路径（decryptRow）
// 都做了同样的归一化，这条迁移只负责把已经躺在库里的行洗一遍。
//
// 归一化是幂等的（见 baseUrl.test.ts），重复跑无害。
// 只截末尾那一段 `/chat/completions`：其余路径都是合法前缀
// （`/compatible-mode/v1`、网关自定义前缀），多截一层会把能用的配置改坏。
export const migration_065: Migration = {
  id: '065_normalize_base_url',
  up(db) {
    const rows = db.prepare('SELECT id, base_url FROM ai_providers').all() as Array<{
      id: string;
      base_url: string | null;
    }>;
    const update = db.prepare('UPDATE ai_providers SET base_url = ? WHERE id = ?');
    for (const r of rows) {
      const fixed = normalizeBaseUrl(r.base_url);
      if (fixed !== (r.base_url ?? '')) update.run(fixed, r.id);
    }

    // 平台级的裸配置（迁移前的老路径，仍作为最终回落）也是同一个手填框。
    const sys = db
      .prepare("SELECT value FROM system_config WHERE key = 'platform_api_base_url'")
      .get() as { value: string } | undefined;
    if (sys) {
      const fixed = normalizeBaseUrl(sys.value);
      if (fixed !== sys.value) {
        db.prepare("UPDATE system_config SET value = ? WHERE key = 'platform_api_base_url'").run(fixed);
      }
    }
  },
};
