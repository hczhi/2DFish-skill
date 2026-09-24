import { describe, it, expect, vi, beforeEach } from 'vitest';

// 「他自己改写的那一整条提示词」（`PlannedImage.fullPrompt`）只有两种失败方式，两种都读成成功：
// ① 被当成 subject 再套一遍画风模板 —— 发出去的是他那一整条 + 一大段模板，图回来「差不多但不对」，
//    而框里显示的和他写的一字不差；
// ② 只接上备图那条路、没接「换一批图」—— 同一格两条路发的是两条不同的提示词，两边都 200。

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
vi.mock('./assetStore.js', () => ({ rememberAsset: vi.fn(() => true) }));
vi.mock('../appKeyService.js', () => ({ holdPoints: vi.fn(() => null), settlePoints: vi.fn(), releasePoints: vi.fn(), POINT_PRICE: { text: 1, image: 5 } }));

const { generateImage } = await import('../../core/image/imageGateway.js');
const { fillPageImages, previewSpecPrompt } = await import('./imageService.js');

const owner = { userId: 'u1', sdkPk: null, externalUid: null };
const CUSTOM = '一张只有我自己知道要什么的图：正午的柳州钢厂，逆光，画面左边空着放标题。';

beforeEach(() => vi.clearAllMocks());

describe('他改写的那一整条提示词', () => {
  it('备图那条路原样发他写的，不再套画风模板', () => {
    const r = previewSpecPrompt(
      { subject: '等距的算力机房', mode: 'concept', ratio: '3:4', fullPrompt: CUSTOM },
      { owner, index: 1, title: '我们的能力', styleId: 'S-C' }
    );
    expect(r.prompt).toBe(CUSTOM);
    expect(r.prompt).not.toContain('水墨'); // 画风模板一个字都不许再拼进来
    expect(r.custom).toBe(true);
    // 每次都要出声：不说的话他换画风/切背景图之后这一格纹丝不动，只会一张张重画（每张真花钱）。
    expect(r.problems.join('')).toMatch(/改写过的整条/);
    // 尺寸仍然由代码按比例算（交给这一条文字的话 3:4 的槽位会拿到一张横图，被裁掉两边）。
    expect(r.size).toBe('1024x1536');
  });

  it('「换一批图」那条路也发同一条（两条路不能各发一条）', async () => {
    (generateImage as any).mockResolvedValue([
      { url: 'https://cos/a.png', provider: 'img-1', model: 'wanx-v1', storage: 'cos', protocol: 'dashscope', protocolInferred: false },
    ]);
    const html =
      '<section class="slide"><div class="slide-inner">' +
      '<img src="/ppt-cases/ph-16x9.svg" data-img-prompt="等距的算力机房" alt="">' +
      '</div></section>';
    await fillPageImages(html, {
      owner, title: '我们的能力', styleId: 'S-C',
      meta: { brandCn: '云启', brandEn: 'YQ', topic: 'AI 转型' },
      promptOverrides: new Map([[1, CUSTOM]]),
    });
    expect((generateImage as any).mock.calls[0][0]).toBe(CUSTOM);
  });
});
