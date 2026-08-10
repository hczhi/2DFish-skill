import { getDatabase } from '../../db/index.js';
import { aiGateway } from '../../core/llm/gateway.js';
import { parseFirstJsonArray } from '../../core/llm/parseJson.js';

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
}

const BATCH_SIZE = 3;

interface BatchResult {
  data: Map<string, ExtractedTenderData>;
  prompt: string;
  response: string;
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
  const prompt = template
    .replace(/\{\{count\}\}/g, String(items.length))
    .replace(/\{\{items\}\}/g, itemsBlock);

  let responseContent = '';
  try {
    const { response } = await aiGateway(
      { messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2000 },
      { userId, source: 'tender', operation: 'extract-batch' }
    );
    responseContent = response.choices[0]?.message?.content || '';
    const parsed = parseFirstJsonArray<any>(responseContent);
    if (parsed) {
      for (const item of parsed) {
        if (!item.id) continue;
        results.set(item.id, {
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
        });
      }
    }
  } catch (e: any) {
    console.error(`[tender] Batch AI extract failed:`, e.message);
    responseContent = `错误: ${e.message}`;
  }

  return { data: results, prompt, response: responseContent };
}

export async function runAIExtractForTenders(
  tenderIds: string[],
  userId: string,
  onLog?: (msg: string, detail?: string) => void
): Promise<number> {
  const db = getDatabase();
  let processed = 0;

  // Load all unprocessed tenders
  const tenders: Array<{ id: string; title: string; content_text: string; region_name: string }> = [];
  for (const id of tenderIds) {
    const tender = db.prepare('SELECT id, title, content_text, region_name, ai_extracted FROM tenders WHERE id = ?').get(id) as any;
    if (!tender || tender.ai_extracted) continue;
    tenders.push(tender);
  }

  if (tenders.length === 0) return 0;

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

    const detail = `📤 Prompt:\n${batchResult.prompt.slice(0, 800)}...\n\n📥 Response:\n${batchResult.response.slice(0, 800)}${batchResult.response.length > 800 ? '...' : ''}`;
    onLog?.(`第 ${batchNum} 批 LLM 调用完成，提取到 ${batchResult.data.size} 条结果`, detail);

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
      }
    }

    onLog?.(`第 ${batchNum}/${totalBatches} 批完成，已处理 ${processed}/${tenders.length}`);
  }

  return processed;
}
