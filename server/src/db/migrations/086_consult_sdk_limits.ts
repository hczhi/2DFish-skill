import type { Migration } from '../migrator.js';

// 每把 consult pk 自己的天花板（084 的对外接入）。
//
// 两个数**都有非空缺省值**，新发的 key 一出生就有上限：pk 是写在第三方页面 JS 里的公开
// 字符串，抄走它的人在白名单域名内（同一个 iframe 宿主、或者那个站上的 XSS）就能一直调
// `/draft`。绑定账号走平台渠道时还有 10 次/天兜着，但**开了专属渠道的账号绕过 ai_quota**
// —— 那一档没有任何上限，烧的是他自己那把 key 的真钱，而每一次调用都返回一份正常的草稿，
// 后台只看到额度在涨。所以「没配就不限」（ai_app_quota 的语义）在这里是错的缺省。
//
// 用量记在 key 这一行上（读时按日期归零，和 ai_quota 一个写法），不另开表：管理员必须
// 在后台看得见「这个接入方今天烧了多少」—— 看不见的话额度打满之后他只会收到接入方一句
// 「你们系统坏了」，而两边都不知道是限额。
export const migration_086: Migration = {
  id: '086_consult_sdk_limits',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(consult_sdk_keys)`).all() as Array<{ name: string }>;
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has('daily_ai_limit')) {
      db.exec(`ALTER TABLE consult_sdk_keys ADD COLUMN daily_ai_limit INTEGER NOT NULL DEFAULT 50`);
    }
    if (!has('max_projects')) {
      db.exec(`ALTER TABLE consult_sdk_keys ADD COLUMN max_projects INTEGER NOT NULL DEFAULT 200`);
    }
    if (!has('ai_used_today')) {
      db.exec(`ALTER TABLE consult_sdk_keys ADD COLUMN ai_used_today INTEGER NOT NULL DEFAULT 0`);
    }
    if (!has('ai_used_date')) {
      db.exec(`ALTER TABLE consult_sdk_keys ADD COLUMN ai_used_date TEXT`);
    }
  },
};
