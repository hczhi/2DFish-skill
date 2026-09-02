import { describe, it, expect, vi, beforeEach } from 'vitest';

// 配图这条路上每种失败都读成「设计上就是留白」：某一张没生成出来那一格还是占位图（和
// 「这一页只有一张图」一模一样）、背景图那种槽位换不回去时预览里一切正常、额度撞墙时
// 抛掉整个结果会让已经花过钱的那几张凭空消失。所以这几条必须有测试。

class FakeQuotaExceeded extends Error {
  dailyLimit = 10;
}

vi.mock('../../core/llm/gateway.js', () => ({
  checkAndDeductAppQuota: vi.fn(),
  checkAndDeductQuota: vi.fn(),
  QuotaExceededError: FakeQuotaExceeded,
}));
vi.mock('../../core/llm/client.js', () => ({ logAIUsage: vi.fn() }));
vi.mock('../../core/image/imageGateway.js', () => ({ generateImage: vi.fn() }));
vi.mock('../../services/aiProviderService.js', () => ({
  resolveImageProvider: vi.fn(() => ({
    id: 'img-1', model: 'wanx-v1', owner_user_id: null, kind: 'image', enabled: 1,
  })),
}));

const { generateImage } = await import('../../core/image/imageGateway.js');
const { checkAndDeductQuota } = await import('../../core/llm/gateway.js');
const { fillPageImages, findImageSlots, PptImageError } = await import('./imageService.js');

const ctx = { userId: 'u1', title: '三阶段路径', meta: { brandCn: '云启', brandEn: 'YQ', topic: 'AI 转型' } };

/** 一页两格：一个 <img src>，一个 background-image。 */
const twoSlots =
  '<section class="slide"><div class="slide-inner">' +
  '<img src="/ppt-cases/ph-16x9.svg" data-img-prompt="等距的算力机房" alt="">' +
  '<div class="p5-visual" style="background-image:url(/ppt-cases/ph-3x4.svg)" data-img-prompt="一位工程师侧影"></div>' +
  '</div></section>';

function ok(url: string) {
  return [{ url, provider: 'img-1', model: 'wanx-v1', storage: 'cos', protocol: 'dashscope', protocolInferred: false }];
}

beforeEach(() => vi.clearAllMocks());

describe('给一页配图', () => {
  it('两种槽位（src 和 background-image）都换得回去', async () => {
    // 只认 src 的话背景图那一格永远停在占位图上，而 problems 里一个字都不说。
    (generateImage as any)
      .mockResolvedValueOnce(ok('https://cos/a.png'))
      .mockResolvedValueOnce(ok('https://cos/b.png'));
    const r = await fillPageImages(twoSlots, ctx);
    expect(r.html).toContain('src="https://cos/a.png"');
    expect(r.html).toContain('url(https://cos/b.png)');
    expect(r.html).not.toContain('ph-');
    expect(r.problems).toEqual([]);
    // 预览由服务端用 deckShell 拼，占位符必须已经填掉
    expect(r.previewHtml).toContain('https://cos/a.png');
    expect(r.previewHtml).not.toContain('{{');
  });

  it('某一张失败时那一格保留占位图，并把上游原文点名报出来', async () => {
    // 把 src 换成一个坏地址的话，破图和「这一格本来是空的」在屏幕上长得一样。
    (generateImage as any)
      .mockResolvedValueOnce(ok('https://cos/a.png'))
      .mockRejectedValueOnce(new Error('模型 wanx-v9 不存在'));
    const r = await fillPageImages(twoSlots, ctx);
    expect(r.html).toContain('src="https://cos/a.png"');
    expect(r.html).toContain('url(/ppt-cases/ph-3x4.svg)');
    expect(r.problems.join(' ')).toMatch(/第 2 张.*wanx-v9 不存在/);
    expect(r.images[1].error).toContain('wanx-v9');
  });

  it('额度撞墙时不回滚已经生成的那几张', async () => {
    // 抛掉整个结果的话，那几张已经花过钱的图凭空消失，用户只能再花一遍。
    (generateImage as any).mockResolvedValueOnce(ok('https://cos/a.png'));
    (checkAndDeductQuota as any)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new FakeQuotaExceeded('quota'); });
    const r = await fillPageImages(twoSlots, ctx);
    expect(r.quotaExceeded).toBe(true);
    expect(r.html).toContain('src="https://cos/a.png"');
    expect(r.problems.join(' ')).toMatch(/额度用完/);
  });

  it('已经生成过的图默认跳过，不重复花钱', async () => {
    const filled = twoSlots.replace('/ppt-cases/ph-16x9.svg', 'https://cos/old.png');
    (generateImage as any).mockResolvedValue(ok('https://cos/new.png'));
    const r = await fillPageImages(filled, ctx);
    expect((generateImage as any).mock.calls.length).toBe(1); // 只做了还是占位图的那一格
    expect(r.images[0].skipped).toBe(true);
    expect(r.html).toContain('https://cos/old.png');
  });

  it('图落在本机磁盘上必须出声', async () => {
    // 换机器/多实例之后那几张就是 404，而生成那一刻预览里一切正常。
    (generateImage as any).mockResolvedValue([
      { url: '/uploads/a.png', provider: 'img-1', model: 'wanx-v1', storage: 'local', protocol: 'openai', protocolInferred: true },
    ]);
    const r = await fillPageImages(twoSlots, ctx);
    expect(r.problems.join(' ')).toMatch(/本机磁盘/);
  });

  it('这一页没有图槽位时抛错，而不是回一个「成功 0 张」', async () => {
    // 回成功的话界面上和「配好图了」分不开，而这一页一张图都没换。
    await expect(
      fillPageImages('<section class="slide"><div class="slide-inner">纯文字页</div></section>', ctx)
    ).rejects.toThrow(PptImageError);
    expect((generateImage as any).mock.calls.length).toBe(0);
  });

  it('画风认不出时抛错，不悄悄回落成默认那套', async () => {
    // 回落的话用户选了「国风水墨」拿到的是等距 SaaS 插画，每张单看都不错、一处不报错。
    await expect(fillPageImages(twoSlots, { ...ctx, styleId: 'S-Z' })).rejects.toThrow(/没有画风 S-Z/);
    expect((generateImage as any).mock.calls.length).toBe(0);
  });

  it('选中的画风真的进了提示词，而且槽位的 mode 决定用哪一路模板', async () => {
    (generateImage as any).mockResolvedValue(ok('https://cos/a.png'));
    const html = twoSlots.replace('data-img-prompt="等距的算力机房"', 'data-img-prompt="等距的算力机房" data-img-mode="data"');
    const r = await fillPageImages(html, { ...ctx, styleId: 'S-C' });
    const first = (generateImage as any).mock.calls[0][0] as string;
    expect(first.toLowerCase()).toContain('ink'); // 水墨那套
    expect(first.toLowerCase()).toContain('infographic'); // data 那一路
    expect(first).not.toMatch(/\{\{|<[^>]{2,40}>/); // 占位符全换掉了
    expect(r.style).toEqual({ id: 'S-C', name: '国风水墨' });
    expect(r.images[0].mode).toBe('data');
    expect(r.images[1].mode).toBe('concept'); // 没写 mode 的按 concept 算
  });

  it('槽位没有可写回的地址时不生成（生成了也贴不上去 = 白花钱）', () => {
    const slots = findImageSlots('<section><span data-img-prompt="一张图"></span></section>');
    expect(slots[0].via).toBe('none');
  });
});
