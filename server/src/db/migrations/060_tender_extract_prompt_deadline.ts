import type { Migration } from '../migrator.js';

// 修正 `tender_extract_prompt` 里 deadline 的格式要求。
//
// ── 修的是什么 ──
// 原文写的是 `"deadline": "<截标日期 YYYY-MM-DD。未提及则空>"`，把时分秒要没了。
// 而 szecp / meicloud / ygcg 三个爬虫都能拿到精确到分钟的截止时间
// （前两个有平台字段，ygcg 从正文正则解析）。要求 LLM 只回日期的后果是
// 「今天 17:00 截止，还能报」和「今天已经截止了」在库里长得一模一样。
//
// aiExtractService 那条 UPDATE 已经改成「原值非空就不覆盖」，所以爬虫解析过的
// 不会再被降级 —— 这个迁移管的是另一半：gdgpo 那类爬虫拿不到 deadline、
// 只能靠 AI 补的情况，让 AI 有机会把时分一起给出来。
//
// ── 为什么是逐字节比对，而不是替换那一行 ──
// 这段内容是后台「标讯 > 提取提示词」里用户可编辑的文案（admin.ts 的
// ALLOWED_CONFIG_KEYS 放行了 tender_extract_prompt），库里那份就是有人点了
// 保存才写进去的，没有任何 migration 播种过它。
//
// 所以「用户有没有改过」只有一个可靠判据：**和旧的代码默认值完全相同**。
// 一开始我写成「包含旧的 deadline 行就替换」，测试立刻抓出问题：用户把开头
// 改成「我们公司专用的提取助手」、或者只多打了一个空格，那一行仍然在，
// 于是他的文案照样被我改了一笔。差一个字节就说明有人编辑过，就不该动。
//
// 代价说清楚：改过 prompt 的用户不会自动拿到这个修正，他们的 deadline 仍然只有
// 日期。这是有意的取舍（不能替用户改他的文案）。UPDATE 那条 CASE WHEN 是兜底,
// 爬虫解析到的值不会被这些用户的旧 prompt 冲掉。
const OLD_DEFAULT = `你是一个招标信息结构化提取专家。请从以下 {{count}} 条招标公告中分别提取关键信息。

{{items}}

---

请输出严格 JSON 数组（无 markdown 围栏），每个元素对应一个项目：
[
  {
    "id": "<项目ID，原样返回>",
    "projectName": "<项目全称>",
    "purchaserName": "<采购单位全称>",
    "budgetAmount": <预算金额，单位元。50万=500000。未提及则为0>,
    "budgetText": "<原文预算表述>",
    "projectLocation": "<项目执行地点>",
    "projectType": "<从以下选择：品牌全案/整合营销/媒介投放/活动策划/视频制作/宣传片/设计制作/公关传播/数字营销/舆情监测/其他>",
    "deadline": "<截标日期 YYYY-MM-DD。未提及则空>",
    "procurementMethod": "<公开招标/竞争性磋商/竞争性谈判/询价/单一来源/其他>",
    "qualificationRequirements": ["<资质要求1>"],
    "projectSummary": "<2-3句话概括核心需求>",
    "keyDeliverables": ["<交付物1>"]
  }
]

注意：
- 必须返回 {{count}} 个元素，顺序与输入一致
- budgetAmount 必须是数字（单位：元）
- 没有明确提到的字段给空字符串或空数组
- projectType 尽量归入给定分类`;

// 与 aiExtractService.ts 的 DEFAULT_EXTRACT_PROMPT 保持一致。
// 两处都要改是已知的重复 —— 代码默认值管新装的库，这里管已经存了一份的库。
const NEW_DEFAULT = OLD_DEFAULT
  .replace(
    '    "deadline": "<截标日期 YYYY-MM-DD。未提及则空>",',
    '    "deadline": "<截标时间。原文写了几点就带上：YYYY-MM-DD HH:mm:ss；只写了日期就给 YYYY-MM-DD。未提及则空>",'
  )
  .replace(
    '- projectType 尽量归入给定分类',
    `- projectType 尽量归入给定分类
- deadline 不要自己推算：原文写「公告发布之日起5个工作日」这类相对说法时给空串，
  由入库逻辑保留爬虫解析的值`
  );

export const migration_060: Migration = {
  id: '060_tender_extract_prompt_deadline',
  up(db) {
    const row = db
      .prepare("SELECT value FROM system_config WHERE key = 'tender_extract_prompt'")
      .get() as { value: string } | undefined;

    // 没存过就什么都不做：aiExtractService 会退回代码里的默认值（已经是新版）。
    if (!row?.value) return;
    // 只认「和旧默认值完全一致」。不一致 = 用户编辑过（或已经是新版）→ 不动。
    // 这一条同时保证了幂等：跑过一次之后值就不再等于 OLD_DEFAULT 了。
    if (row.value !== OLD_DEFAULT) return;

    db.prepare("UPDATE system_config SET value = ? WHERE key = 'tender_extract_prompt'").run(NEW_DEFAULT);
  },
};
