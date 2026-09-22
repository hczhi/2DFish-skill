// 「这条接入点上到底哪种发法能真的关掉思维链」—— 对着一条 ai_providers 记录把各家的
// 关法逐个发一次，判据只有一个：`usage.completion_tokens_details.reasoning_tokens` 是不是 0。
//
// 为什么要有这个脚本：各家网关认的键不是同一个，而**发出去不等于生效**（宽松的网关对不认识
// 的键既不报错也不照办），所以「关没关掉」只能靠 reasoning_tokens 反着核。猜键的代价是
// 后台勾着「不深度思考」而每次调用照旧慢十倍，界面上一切正常。
//
// 会真的调 AI（每条一次，max_tokens 400，烧的是这条接入点自己的 key），不写库。
// 用法（DB_PATH 指向库的拷贝更安全；不带 providerId 时跑种子那条 default-llm）：
//   ./node_modules/.bin/tsx scripts/probe-nothinking-forms.mts [providerId]
import dotenv from 'dotenv';
dotenv.config();
import OpenAI from 'openai';
import { initDatabase } from '../src/db/index.js';
import { getProvider } from '../src/services/aiProviderService.js';

initDatabase();

const id = process.argv[2] || 'default-llm';
const p = getProvider(id) as any;
if (!p) { console.error(`找不到 provider「${id}」`); process.exit(1); }
if (!p.api_key) { console.error('这条 provider 的 key 解不开（CONFIG_ENCRYPTION_KEY 没配？）'); process.exit(1); }
console.log(`provider ${id}: ${p.model} @ ${p.base_url}\n`);

const client = new OpenAI({ apiKey: p.api_key, baseURL: p.base_url, timeout: 120_000, maxRetries: 0 });

/** [说明, 额外 body, 换个模型名] */
const CASES: Array<[string, Record<string, unknown>, string?]> = [
  ['(什么都不发)', {}],
  ['四个键一起', {
    enable_thinking: false, thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'minimal',
  }],
  ['enable_thinking:false', { enable_thinking: false }],
  ['chat_template_kwargs', { chat_template_kwargs: { enable_thinking: false } }],
  ['thinking:{type:disabled}', { thinking: { type: 'disabled' } }],
  ['thinking:false', { thinking: false }],
  ['reasoning_effort:minimal', { reasoning_effort: 'minimal' }],
  ['reasoning_effort:none', { reasoning_effort: 'none' }],
  ['reasoning_effort:low', { reasoning_effort: 'low' }],
  ['reasoning:{enabled:false}', { reasoning: { enabled: false } }],
  ['reasoning:{max_tokens:0}', { reasoning: { max_tokens: 0 } }],
  ['thinking:{type:disabled,budget:0}', { thinking: { type: 'disabled', budget_tokens: 0 } }],
  ['模型名 -nothinking', {}, `${p.model}-nothinking`],
  ['模型名 -non-thinking', {}, `${p.model}-non-thinking`],
  ['模型名 :nothinking', {}, `${p.model}:nothinking`],
];

for (const [label, extra, modelOverride] of CASES) {
  const t = Date.now();
  try {
    const r = await client.chat.completions.create({
      model: modelOverride || p.model,
      messages: [{ role: 'user', content: '用一句话说明天空为什么是蓝的' }],
      max_tokens: 400,
      temperature: 0,
      ...extra,
    } as any);
    const u: any = r.usage || {};
    const reasoning = u.completion_tokens_details?.reasoning_tokens;
    console.log(
      `${reasoning === 0 ? '✅' : '➖'} ${label.padEnd(32)} 思维链=${reasoning === undefined ? '上游没报' : reasoning}`
      + ` 输出=${u.completion_tokens} finish=${r.choices?.[0]?.finish_reason} ${Date.now() - t}ms 实际模型=${r.model}`
    );
  } catch (e: any) {
    console.log(`❌ ${label.padEnd(32)} HTTP ${e?.status} ${String(e?.message).slice(0, 110)} ${Date.now() - t}ms`);
  }
}
