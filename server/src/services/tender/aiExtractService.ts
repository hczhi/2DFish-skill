import { getDatabase } from '../../db/index.js';
import { jsonGateway } from '../../core/llm/parseJson.js';

export interface ExtractedTenderData {
  projectName: string;
  purchaserName: string;
  budgetAmount: number;
  budgetText: string;
  projectLocation: string;
  projectType: string;
  deadline: string;
  procurementMethod: string;
  qualificationRequirements: string[];
  projectSummary: string;
  keyDeliverables: string[];
  /** 是否落在关键词库覆盖的业务范围内。缺省按 true —— 见 relevanceRule()。 */
  relevant: boolean;
  /** 判为不相关的一句话理由（相关时为空） */
  relevantReason: string;
}

const BATCH_SIZE = 3;

// max_tokens 必须够装满一批的完整 JSON。原来是 2000：一批 3 条、每条十来个字段
// 外加中文 projectSummary / qualificationRequirements，实测单批就要 1300+ 输出 token，
// 正文长一点、资质条目多几条就顶到上限 —— 而截断的 JSON 数组括号配不平，
// parseFirstJsonArray 返回 null，整批 0 条结果，日志却是一句
// 「LLM 调用完成，提取到 0 条结果」+ ✅ 已完成。这是这个模块最典型的假成功。
const MAX_OUTPUT_TOKENS = 4000;

interface BatchResult {
  data: Map<string, ExtractedTenderData>;
  prompt: string;
  response: string;
  /** 这一批为什么没出结果（解析失败 / 被截断 / 报错）。空 = 正常。 */
  problem: string;
}

function getExtractPromptTemplate(): string | null {
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'tender_extract_prompt'").get() as any;
  return row?.value || null;
}

const DEFAULT_EXTRACT_PROMPT = `你是一个招标信息结构化提取专家。请从以下 {{count}} 条招标公告中分别提取关键信息。

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
    "deadline": "<截标时间。原文写了几点就带上：YYYY-MM-DD HH:mm:ss；只写了日期就给 YYYY-MM-DD。未提及则空>",
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
- projectType 尽量归入给定分类
- deadline 不要自己推算：原文写「公告发布之日起5个工作日」这类相对说法时给空串，
  由入库逻辑保留爬虫解析的值`;

/** 关键词库里启用的关键词 —— 「相关」的定义就是这一批词，不是写死的行业清单。 */
function loadEnabledKeywords(): string[] {
  return (getDatabase()
    .prepare('SELECT keyword FROM tender_keyword_pool WHERE enabled = 1 ORDER BY sort_order')
    .all() as Array<{ keyword: string }>)
    .map((r) => r.keyword)
    .filter(Boolean);
}

// 相关性判断这段**写在代码里**，拼在模板后面，不放进 DEFAULT_EXTRACT_PROMPT。
// 原因：system_config.tender_extract_prompt 里存着一份用户可编辑的副本，且它
// 优先级更高（getExtractPromptTemplate）。只改默认值的话，装着旧副本的部署里
// 模型压根不会返回 relevant 字段 —— 而 relevant 缺省是 true，于是闸门形同不存在，
// 没有任何一处会报错，用户只会以为「AI 判得不准」。
//
// 缺省为 true（而不是 false）是另一半：判错方向的代价不对称。误放一条无关标讯
// 用户在列表里看一眼就划过去了；误杀一条相关的，它从此不在标讯列表、不参与评分、
// 不进多维表格，用户根本不知道有这条 —— 唯一的痕迹是草稿库「已作废」里的一行。
// 所以「拿不准就放行」也要写进 prompt。
function relevanceRule(keywords: string[]): string {
  return `

---

【相关性判断】除上述字段外，每个元素还必须带这两个字段：
  "relevant": <true 或 false>,
  "relevantReason": "<relevant 为 false 时，用一句话说明这个项目实际在采购什么>"

我们只做以下业务（关键词库）：${keywords.join('、')}

判定规则：
- 只有当项目采购的东西**和上面每一个关键词都明显无关**时才给 false。
  例如校车接送、食堂餐饮、土建施工、医疗设备、软件运维、保洁安保这类。
- 沾到其中任意一个方向就给 true —— 包括：项目名里没写但内容涉及宣传/传播/
  推广/内容制作/活动执行/展陈布置/直播/新媒体运营 的。
- **拿不准就给 true。** 判错成 false 的那一条会被作废、不再出现在任何列表里，
  代价远大于多留一条无关的。`;
}

async function extractBatch(
  items: Array<{ id: string; title: string; contentText: string; regionName: string }>,
  userId: string
): Promise<BatchResult> {
  const results = new Map<string, ExtractedTenderData>();

  const itemsBlock = items.map((item, i) => `
### 项目 ${i + 1} (ID: ${item.id})
- 标题：${item.title}
- 地区：${item.regionName}
- 正文：${item.contentText.slice(0, 1500)}
`).join('\n---\n');

  const template = getExtractPromptTemplate() || DEFAULT_EXTRACT_PROMPT;
  const keywords = loadEnabledKeywords();
  const prompt = template
    .replace(/\{\{count\}\}/g, String(items.length))
    .replace(/\{\{items\}\}/g, itemsBlock)
    // 关键词库为空时不拼这段：那种情况下「和全部关键词都无关」对任何项目都成立，
    // 闸门会把整批作废掉，而日志只会写「N 条判为不相关」。
    + (keywords.length > 0 ? relevanceRule(keywords) : '');

  let responseContent = '';
  let problem = '';
  try {
    // jsonGateway 而不是裸 aiGateway：解析失败会自动重试一次，并且把
    // finish_reason 带回来 —— 「被截断」和「模型胡说」得说成两句不同的话，
    // 否则用户只能看到一句「提取到 0 条」，无从下手。
    const { parsed, raw, finish } = await jsonGateway<any>(
      () => ({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS }),
      { userId, source: 'tender', operation: 'extract-batch' },
      { mode: 'array', attempts: 2 }
    );
    responseContent = raw;

    if (!parsed) {
      problem = finish === 'length'
        ? `模型返回被截断（finish_reason=length，max_tokens=${MAX_OUTPUT_TOKENS}），JSON 不完整`
        : `模型返回无法解析成 JSON 数组（finish_reason=${finish || '未知'}）`;
      return { data: results, prompt, response: responseContent, problem };
    }

    const norm = (item: any): ExtractedTenderData => ({
      projectName: item.projectName || '',
      purchaserName: item.purchaserName || '',
      budgetAmount: item.budgetAmount || 0,
      budgetText: item.budgetText || '',
      projectLocation: item.projectLocation || '',
      projectType: item.projectType || '其他',
      deadline: item.deadline || '',
      procurementMethod: item.procurementMethod || '',
      qualificationRequirements: item.qualificationRequirements || [],
      projectSummary: item.projectSummary || '',
      keyDeliverables: item.keyDeliverables || [],
      // 只有显式的 false 才算不相关：字段缺失、拼错、返回字符串 "false" 之外的
      // 任何东西都放行（见 relevanceRule 里关于代价不对称的注释）。
      relevant: item.relevant !== false && item.relevant !== 'false',
      relevantReason: item.relevant === false || item.relevant === 'false'
        ? String(item.relevantReason || '与关键词库无关（模型未给理由）')
        : '',
    });

    const inputIds = new Set(items.map((it) => it.id));
    for (const item of parsed) {
      if (item?.id && inputIds.has(String(item.id))) results.set(String(item.id), norm(item));
    }

    // 模型没把 id 原样带回来（换了字段名、截短了 UUID、或干脆没写）时按顺序对齐：
    // prompt 里写死了「顺序与输入一致」，条数又刚好对得上，这时候丢掉整批
    // 只会表现成「提取到 0 条」。但必须**说出来** —— 顺序对齐一旦是错的，
    // 就是把 A 的预算写到 B 那一行，而回帖是「✅ 已提取」。
    if (results.size === 0 && parsed.length === items.length) {
      items.forEach((it, i) => results.set(it.id, norm(parsed[i])));
      problem = '模型没有原样返回 id，已按输入顺序对齐（请抽查一条的采购人/预算是否张冠李戴）';
    } else if (results.size < items.length) {
      problem = `模型只返回了 ${results.size}/${items.length} 条可用结果`;
    }
  } catch (e: any) {
    console.error(`[tender] Batch AI extract failed:`, e.message);
    responseContent = `错误: ${e.message}`;
    problem = `调用失败：${e.message}`;
  }

  return { data: results, prompt, response: responseContent, problem };
}

export interface ExtractRunResult {
  /** 真正写进库、状态可以推进到 extracted 的条数（含被判为不相关的） */
  processed: number;
  /** 送去提取但没拿到结果的条数（调用方必须报出来，见 api/tender.ts） */
  failed: number;
  /** 判为「和关键词库无关」的标讯 id + 理由；调用方据此置 status='rejected' */
  rejected: Array<{ id: string; reason: string }>;
  /** 每批的失败原因，去重后给管理员看 */
  problems: string[];
}

export async function runAIExtractForTenders(
  tenderIds: string[],
  userId: string,
  onLog?: (msg: string, detail?: string) => void
): Promise<ExtractRunResult> {
  const db = getDatabase();
  let processed = 0;
  const problems: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  // Load all unprocessed tenders
  const tenders: Array<{ id: string; title: string; content_text: string; region_name: string }> = [];
  for (const id of tenderIds) {
    const tender = db.prepare('SELECT id, title, content_text, region_name, ai_extracted FROM tenders WHERE id = ?').get(id) as any;
    if (!tender || tender.ai_extracted) continue;
    tenders.push(tender);
  }

  if (tenders.length === 0) {
    return { processed: 0, failed: 0, rejected: [], problems: ['选中的标讯都已经提取过了（要重跑请用强制模式）'] };
  }

  onLog?.(`待提取 ${tenders.length} 条，分 ${Math.ceil(tenders.length / BATCH_SIZE)} 批处理（每批 ${BATCH_SIZE} 条）`);

  // Process in batches
  for (let i = 0; i < tenders.length; i += BATCH_SIZE) {
    const batch = tenders.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tenders.length / BATCH_SIZE);

    onLog?.(`第 ${batchNum}/${totalBatches} 批：${batch.map(t => t.title.slice(0, 15)).join(', ')}`);

    const batchItems = batch.map(t => ({
      id: t.id,
      title: t.title,
      contentText: t.content_text || '',
      regionName: t.region_name || '',
    }));

    const batchResult = await extractBatch(batchItems, userId);

    const detail = `📤 Prompt:\n${batchResult.prompt.slice(0, 800)}...\n\n📥 Response:\n${batchResult.response.slice(0, 2000)}${batchResult.response.length > 2000 ? '...' : ''}`;
    if (batchResult.problem) {
      problems.push(batchResult.problem);
      onLog?.(`⚠️ 第 ${batchNum} 批：${batchResult.problem}（提取到 ${batchResult.data.size}/${batch.length} 条）`, detail);
    } else {
      onLog?.(`第 ${batchNum} 批 LLM 调用完成，提取到 ${batchResult.data.size} 条结果`, detail);
    }

    for (const tender of batch) {
      const result = batchResult.data.get(tender.id);
      if (result) {
        // deadline 和 budget_amount / purchaser_name 一样只在空时才写。
        //
        // 原来是无条件覆盖，两个后果：
        //   1. 爬虫解析出的「2026-08-11 17:00:00」被压成「2026-08-11」——
        //      prompt 只要 YYYY-MM-DD，而 szecp/meicloud/ygcg 三个爬虫都从
        //      平台字段或正文里拿到了精确到分钟的截止时间。丢掉时分意味着
        //      「今天 17:00 截止」看起来和「今天已过」没区别。
        //   2. LLM 没读出来（正文里写「公告发布之日起 5 个工作日」这类）时返回空串，
        //      直接把爬虫辛苦解析的值擦掉。ygcg 现在全量入库、不按状态过滤，
        //      deadline 是用户区分「已过期」和「压根没写截止时间」的唯一依据,
        //      擦掉它等于把这个判断依据也擦掉了。
        // 反过来 gdgpo 不解析 deadline（列表接口没这个字段），它的空值仍由 AI 补上,
        // 所以这个 CASE 对 gdgpo 是纯增益、对其余三个是保护。
        db.prepare(`
          UPDATE tenders SET
            ai_extracted = ?,
            project_type = ?,
            project_location = ?,
            deadline = CASE WHEN deadline IS NULL OR deadline = '' THEN ? ELSE deadline END,
            qualification_requirements = ?,
            project_summary = ?,
            budget_amount = CASE WHEN budget_amount = 0 THEN ? ELSE budget_amount END,
            purchaser_name = CASE WHEN purchaser_name = '' THEN ? ELSE purchaser_name END
          WHERE id = ?
        `).run(
          JSON.stringify(result),
          result.projectType,
          result.projectLocation,
          result.deadline,
          JSON.stringify(result.qualificationRequirements),
          result.projectSummary,
          result.budgetAmount,
          result.purchaserName,
          tender.id
        );
        processed++;
        if (!result.relevant) {
          rejected.push({ id: tender.id, reason: result.relevantReason });
          onLog?.(`🗑 判为不相关，将作废：${tender.title.slice(0, 25)} —— ${result.relevantReason}`);
        }
      }
    }

    onLog?.(`第 ${batchNum}/${totalBatches} 批完成，已处理 ${processed}/${tenders.length}`);
  }

  return { processed, failed: tenders.length - processed, rejected, problems: [...new Set(problems)] };
}
