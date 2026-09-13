// 展示稿的归属键（100/101）。**一份** —— deckStore 和 assetStore 各拼一遍 WHERE 的话，
// 稿子按公司共用而素材按员工隔离，界面上是「同事的稿子我打得开，但里面那几张图我挑不到」，
// 两处都不报错。
//
// 租户 = **一家公司** = `(绑定账号, 那把 pk)`。第三方页面传的 `external_uid` 只记「这一份/这一张
// 是谁建的」，**不参与筛选**：写进 WHERE 的话公司 A 的每个员工各自一个空工作台，看不到同事的
// 稿子和素材，而每个接口都是 200（他们只会说「我们的东西丢了」）。
//
// 网页登录的用户后两项是 null（平台自己就是一个租户）。比较必须用 **NULL 安全的 `IS ?`**：
// `= ?` 对 NULL 永远为假 —— 老稿子和老素材一条都读不出来，界面上是「我的东西都不见了」。

export interface PptOwner {
  /** 绑定的平台账号。钱（AI/生图额度）永远记在这个 id 上，不是记在租户上。 */
  userId: string;
  /** 哪把对外 key；网页登录是 null。**这一项才是「哪家公司」。** */
  sdkPk: string | null;
  /** 第三方那边的终端用户 id，只用来记「谁建的」和展示，不参与筛选。 */
  externalUid: string | null;
}

/** 网页登录的用户（平台租户）。 */
export function platformOwner(userId: string): PptOwner {
  return { userId, sdkPk: null, externalUid: null };
}

/** WHERE 片段。`prefix` 给带 JOIN 的查询用（`tenantSql('a.')`）。 */
export function tenantSql(prefix = ''): string {
  return `${prefix}user_id IS ? AND ${prefix}sdk_pk IS ?`;
}

export function tenantArgs(o: PptOwner): [string, string | null] {
  return [o.userId, o.sdkPk];
}
