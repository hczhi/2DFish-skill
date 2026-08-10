import { type ActionDef, requireStr } from './types.js';

/**
 * 兜底动作：不调任何飞书 API，只把话说回去。
 *
 * 存在的意义有两个：
 * 1. 用户就是来聊天/问「你能干什么」的，不该被硬塞进某个功能动作里；
 * 2. 意图解析拿不准时有个安全出口。没有它，LLM 会被迫在几个写操作里硬选一个,
 *    而误建一个任务比答一句「没听懂」糟糕得多。
 */
export const replyAction: ActionDef = {
  name: 'reply',
  description:
    '只回复文字，不执行任何操作。用于闲聊、回答关于助理能力的提问，以及**指令不明确或听不懂时的兜底**。' +
    '拿不准该用哪个动作时一律选这个，并在 text 里说明还需要用户补充什么。',
  params: {
    text: '必填。要回复给用户的内容，支持 markdown。',
  },
  examples: ['你能做什么', '你好', '帮我搞一下那个事情（指令不明确 → 用本动作追问）'],
  // 「我目前会：……」的清单里不该出现「回一句话」——那不是用户来找助理办的事。
  hint: undefined,
  scopes: [],
  async run(params) {
    const text = requireStr(params, 'text', '回复内容');
    return { summary: text };
  },
};
