import type { Migration } from '../migrator.js';

// 咨询项目的归属键从「一个 user_id」变成「user_id + sdk_pk + external_uid」（084 的对外接入）。
//
// 少了这两列，一把 pk 下所有终端用户共用同一个 owner：`listProjects` 会把 A 客户的品牌
// 资料和整份客户原始资料列给 B 客户看 —— 那个列表读起来就是一列正常的项目，进度数、字数
// 全都对，没有任何一处报错。这是这条链路上最像成功的失败。
//
// 平台自己的用户两列都是 NULL，所以归属判定一律用 SQLite 的 NULL 安全比较 `IS ?`
// （`= ?` 对 NULL 永远为假 —— 用它的话老项目一条都读不出来，界面上是「项目都不见了」）。
// 也因此**绑定账号自己在网页上的项目和它名下的第三方租户是互相看不见的**：sdk_pk 一个是
// NULL 一个是那把 pk。这是想要的 —— 顾问自己的工作台不该混进第三方客户的项目里。
export const migration_085: Migration = {
  id: '085_consult_project_tenant',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(consult_projects)`).all() as Array<{ name: string }>;
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has('sdk_pk')) db.exec(`ALTER TABLE consult_projects ADD COLUMN sdk_pk TEXT`);
    if (!has('external_uid')) db.exec(`ALTER TABLE consult_projects ADD COLUMN external_uid TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_consult_projects_owner
         ON consult_projects(user_id, sdk_pk, external_uid, updated_at)`
    );
  },
};
