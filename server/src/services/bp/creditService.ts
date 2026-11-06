import type { FactCard } from './factCardService.js';
import { gatherSources, numbersBacked, nameBacked, srcList, DOCS_RULES, type Source, type Gathered, type ExtraSource } from './sources.js';
import type { Keywords } from './keywordsService.js';
import { bpJson } from './llm.js';
import { bpMethod, CREDIT_SLOT, CREDIT_METHOD } from './prompts.js';
import { norm } from './quotes.js';

// 5.9 企业信用档案（skill 的 S2.5）。只有公开网页检索（Tavily），企查查 / 裁判文书网这类库基本搜不到。
// 这一章最危险的失败有两种，都读起来像查过：
//   ① **同名公司**：「XX 科技有限公司 被执行 300 万」—— 其实是另一个省的同名公司。所以每条的被引资料里
//      必须出现这家公司的**全称**（`nameBacked(全称)`），出现的只是简称的那几条从引用里剔掉；剔空了这一项就当没查到；
//   ② **把「没查到」写成「没有」**：涉诉一栏写「无」，读者当成「这家公司没官司」。所以查不到的那句话由代码写
//      （`NOT_FOUND`），并且对风险类单独指去哪个官方库核 —— 模型给的「无 / 0 条 / 未发现」一律当没查到。
// 这一章**不打断流水线**：没有公司全称、检索全部失败时整章标 skipped 并说出原因，后面几章照跑
// （它不是后面任何一章的必要输入，为它停掉整份报告不划算；但必须出声）。

export const ITEMS = [
  { key: 'legalRep', label: '法定代表人', risk: false },
  { key: 'capital', label: '注册资本', risk: false },
  { key: 'founded', label: '成立日期', risk: false },
  { key: 'shareholders', label: '主要股东 / 实控人', risk: false },
  { key: 'ip', label: '专利 / 软著', risk: false },
  { key: 'lawsuits', label: '涉诉 / 被执行', risk: true },
  { key: 'penalties', label: '行政处罚', risk: true },
  { key: 'abnormal', label: '经营异常', risk: true },
] as const;

const NOT_FOUND = '公开网页未检索到（不代表没有）';
const WHERE_TO_CHECK = '正式尽调请查：国家企业信用信息公示系统 / 中国执行信息公开网 / 中国裁判文书网';
const EMPTY_WORDS = /^(无|暂无|没有|未发现|未检索到|0\s*条?|none|n\/a|-)$/i;

export interface CreditItem {
  key: string; label: string; risk: boolean;
  found: boolean;
  value: string;
  /** 和 BP 说法的对照（对不上时写出来）。 */
  bpCheck: string;
  src: number[];
  /** 数字在被引资料里找不到。 */
  unsourced: boolean;
  /** 模型引了资料，但那几条里都没有这家公司的全称（多半是同名 / 简称命中），已剔掉。 */
  otherCompany: boolean;
}

export interface Credit {
  skipped: string | null;
  company: string;
  queries: string[];
  failedQueries: { q: string; error: string }[];
  sources: Source[];
  items: CreditItem[];
  whereToCheck: string;
  userMaterials?: number;
  excluded?: number;
  promptSource: 'skill' | 'default';
}

const str = (v: any) => String(v ?? '').trim();

/** BP 里的公司全称。只认带「公司 / 集团 / 有限 / Inc / Ltd」的写法 —— 拿简称去搜工商信息，搜回来的大半是别家。 */
export function fullNameOf(card: Pick<FactCard, 'sections'>): string | null {
  const it = card.sections.find((s) => s.key === 'company')?.items.find((i) => i.field === '公司名称' && i.label !== 'missing');
  const v = it?.value.trim() || '';
  return /(公司|集团|有限|股份|Inc\.?|Ltd\.?|LLC)/i.test(v) ? v : null;
}

/** 纯函数：模型输出 → 核验过的档案。 */
export function buildCredit(parsed: any, contents: Map<number, string>, company: string): CreditItem[] {
  return ITEMS.map((def) => {
    const r = parsed?.items?.[def.key] || {};
    const value = str(r?.value);
    const cited = srcList(r?.src, contents);
    const src = cited.filter((n) => nameBacked(company, [n], contents));
    const otherCompany = cited.length > 0 && src.length === 0;
    const found = !!value && !EMPTY_WORDS.test(value) && src.length > 0;
    return {
      key: def.key, label: def.label, risk: def.risk, found,
      value: found ? value : NOT_FOUND,
      bpCheck: found ? str(r?.bp_check) : '',
      src: found ? src : [],
      unsourced: found && !numbersBacked(value, src, contents),
      otherCompany,
    };
  });
}

function skippedCredit(reason: string, company = '', g?: Gathered): Credit {
  return {
    skipped: reason, company, queries: g?.queries || [], failedQueries: g?.failedQueries || [], sources: g?.sources || [],
    items: [], whereToCheck: WHERE_TO_CHECK, promptSource: 'default',
  };
}

export async function runCredit(input: {
  card: FactCard; keywords?: Keywords; materials?: { exclude: Set<string>; extra: ExtraSource[] };
  filename: string; userId: string;
}): Promise<Credit> {
  const company = fullNameOf(input.card);
  if (!company) {
    return skippedCredit('BP 里没有写公司全称（带「有限公司」之类的那种），拿简称查工商信息搜回来的大半是同名的别家，这一章没查。');
  }
  const queries = [
    `"${company}" 法定代表人 注册资本 成立日期`,
    `"${company}" 股东 股权结构 实际控制人`,
    `"${company}" 专利 软件著作权`,
    `"${company}" 被执行人 裁判文书 诉讼`,
    `"${company}" 行政处罚 经营异常`,
  ];
  let g: Gathered;
  try {
    g = await gatherSources(queries, {
      chapter: '企业信用档案', focus: [company, ...(input.keywords?.aliases || []), '法定代表人', '注册资本', '股东', '被执行', '处罚', '专利'],
      exclude: input.materials?.exclude, extra: input.materials?.extra,
    });
  } catch (e: any) {
    return skippedCredit(String(e?.message || e), company);
  }
  // 一条资料都没提到全称：多半全是同名 / 简称命中，喂给模型只会让它从别家的信息里挑。
  const mentions = [...g.contents.entries()].filter(([, c]) => norm(c).includes(norm(company)));
  if (!mentions.length) {
    return skippedCredit(`检索回来的 ${g.sources.length} 条资料里没有一条出现「${company}」这个全称，没法确认是这家公司，这一章没整理。`, company, g);
  }

  const method = bpMethod(CREDIT_SLOT, CREDIT_METHOD);
  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
items 的键只能是：${ITEMS.map((i) => `${i.key}（${i.label}）`).join('、')}。
- value：资料里写的内容；查不到就留空字符串（不要写「无」「0 条」）。
- src：依据的资料编号，被引资料里必须出现「${company}」这个全称 —— 系统会去原文核，没出现全称的引用会被剔掉。
- bp_check：和 BP 里的说法对照（如「BP 称 12 项专利，资料显示 3 项」），对得上或 BP 没提就留空。

只输出 JSON：
{"items":{"legalRep":{"value":"","src":[1],"bp_check":""}}}`,
    user: `## 要查的公司\n${company}\n\n## BP 里的相关说法\n${input.card.sections.flatMap((s) => s.items.filter((i) => i.label !== 'missing' && (s.key === 'company' || s.key === 'team' || i.field.includes('技术'))).map((i) => `- ${i.field}：${i.value}`)).join('\n')}\n\n${DOCS_RULES}\n\n## 检索资料（编号即 src）\n${g.docs}`,
    userId: input.userId, operation: 'credit', label: '企业信用档案', filename: input.filename, maxTokens: 8_000,
  });
  return {
    skipped: null, company, queries: g.queries, failedQueries: g.failedQueries, sources: g.sources,
    items: buildCredit(parsed, g.contents, company), whereToCheck: WHERE_TO_CHECK,
    userMaterials: input.materials?.extra.length || 0, excluded: input.materials?.exclude.size || 0,
    promptSource: method.origin,
  };
}
