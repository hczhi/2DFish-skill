// 流式生成撞上模型输出上限时，前面的内容是好的、没有任何错误 —— 稿子和写完的
// 长得一模一样，只是结尾断在半句话上。前端靠 `truncated` 事件才能提示，
// 不发的话用户直接就采纳/发布了。手测测不出来，所以有这个测试。
import { describe, it, expect } from 'vitest';
import { streamToSSE } from './xhs.js';

function fakeRes() {
  const written: string[] = [];
  return {
    written,
    res: {
      setHeader() {},
      flushHeaders() {},
      write(s: string) { written.push(s); return true; },
      end() {},
      writableEnded: false,
    } as any,
  };
}

async function* chunks(finishReason: string | null) {
  yield { choices: [{ delta: { content: '第一段。' } }] };
  yield { choices: [{ delta: { content: '第二段被截在这' }, finish_reason: finishReason }] };
}

describe('xhs 流式转发', () => {
  it('撞到输出上限时要发 truncated 事件（结尾断了但一切看着正常）', async () => {
    const { res, written } = fakeRes();
    await streamToSSE(res, chunks('length'), () => {});
    const events = written.filter((w) => w.includes('truncated'));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].replace(/^data: /, '').trim())).toEqual({ truncated: true });
    // 正常写完的流不能带这个标记，否则每篇稿子都挂一句假警告，用户就不再看它了。
    const ok = fakeRes();
    await streamToSSE(ok.res, chunks('stop'), () => {});
    expect(ok.written.some((w) => w.includes('truncated'))).toBe(false);
  });
});
