import { describe, it, expect, beforeEach, vi } from 'vitest';

// 图片识别这条路比文件那条**少一道闸门**（没有程序抠出来的原文可以比对数字），
// 所以「读起来完全正常的失败」在这里有两种，这里就守这两种：
//
// ① 这条接入点的模型不认图片：宽松的网关把 image_url 那一段悄悄丢掉，模型照着文件名
//    编一份「客户资料」—— 那份东西在卡片里和真读出来的一模一样，会一路进十二步。
// ② 图里压根没有字（纯产品照）：回一份空的/描述性的资料，界面上看起来就是「这张图内容不多」。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string; finish?: string; reasoning?: number }> = [];
const sent: any[] = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async (params: any, options: any) => {
    sent.push({ params, options });
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return {
      response: {
        choices: [{ message: { content: r.text }, finish_reason: r.finish || 'stop' }],
        usage: { completion_tokens_details: { reasoning_tokens: r.reasoning || 0 } },
      },
      usage: { output_tokens: 200 },
      duration_ms: 8000,
    };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { extractImageText, looksLikeImage } = await import('./imageExtractService.js');

/** 一张最小的合法 PNG（文件头对得上就够 —— 这一层不解码像素）。 */
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

describe('consult 图片识别', () => {
  beforeEach(() => {
    replies.length = 0;
    sent.length = 0;
  });

  it('模型说自己没收到图片时报错，不把它编出来的内容当资料', async () => {
    // 纯文本模型 + 宽松网关 = 图被悄悄丢掉，模型照文件名编一份读起来很正常的资料。
    // 这里必须指到「default 档配的模型不支持看图」上，否则他会一直重传这张图。
    replies.push({ text: 'NO_IMAGE' });
    await expect(extractImageText('u1', '品牌手册第3页.png', png)).rejects.toThrow(/没有收到图片/);
    replies.push({ text: 'NO_IMAGE' });
    await expect(extractImageText('u1', '品牌手册第3页.png', png)).rejects.toThrow(/支持视觉/);
  });

  it('图里没有文字时收下模型的描述，但必须标明这是「描述」不是图里的原文', async () => {
    // 描述本身是有用的（品类、器型、包装风格），所以不再报错。但混进资料而不标明的话，
    // 「模型看着一张白瓶子写出来的话」和客户亲口说的长得一模一样，后面十二步会把它当事实。
    replies.push({ text: 'NO_TEXT\n## 其它可能有用的\n- 一瓶白色包装的洗发水放在木桌上' });
    const r = await extractImageText('u1', '产品照.jpg', png);
    expect(r.text).toContain('白色包装的洗发水');
    expect(r.text).not.toContain('NO_TEXT'); // 标记不许留在资料里
    expect(r.notes.join('\n')).toMatch(/对画面的描述/);
  });

  it('成功时必须说出「这份没有原文可比对」，并如实回花掉的一次额度', async () => {
    // 吞掉这条的话，图片读出来的资料在界面上和文件提取出来的一样可信 —— 而它是模型
    // 一个人读出来的，看错一个数字（12.8 → 128）没有任何一处会露馅。
    replies.push({ text: '## 品牌与公司\n- 玉林制药\n\n## 经营与销量数据\n- 年营收 8600 万' });
    const r = await extractImageText('u1', '第3页.png', png);
    expect(r.text).toContain('8600');
    expect(r.calls).toBe(1);
    expect(r.notes.join('\n')).toMatch(/没有程序抠出来的原文可以比对/);
    // 图片要真的发出去（而且是 data URL —— 不落 COS，客户资料不公开）
    const parts = sent[0].params.messages.at(-1).content;
    expect(parts.some((p: any) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,'))).toBe(true);
    // 视觉能力跟着 default 档走：写成 'fast' 的话那一档常配纯文本模型，图会被悄悄丢掉。
    expect(sent[0].options.tier).toBeUndefined();
  });

  it('iPhone 的 .heic 在花额度之前就拦下来，并说清怎么转成 JPG', async () => {
    // 模型不吃 HEIC。落到「文件头不是图片」那句上的话，那句话对一张明明能看的照片
    // 讲不通，他只会反复传同一张（而每次都可能真花一次额度）。
    const heic = Buffer.concat([Buffer.from('\0\0\0 ftypheic'), Buffer.alloc(64)]);
    expect(looksLikeImage('.heic', heic)).toBe(true);
    await expect(extractImageText('u1', 'IMG_0421.heic', heic)).rejects.toThrow(/JPG/);
    expect(sent).toHaveLength(0); // 一次调用都没发出去
  });
});
