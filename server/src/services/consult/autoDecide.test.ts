import { describe, it, expect } from 'vitest';

import { autoPicksFor } from './autoDecideService.js';
import { decidedToText } from './chatService.js';

// 「AI 替他在那几处取舍上拍板」的两条「出错时伪装成成功」的路径 —— 两条都不报错，
// 出来的记录和正文读起来完全正常：
// ① 挑错了那一个选项：`recommend` 是自由文本，短 label 常是长 label 的子串，
//    比对顺序错一位就把「它推荐的那条」记成「另一条」，而那条记录和真的一模一样，
//    整份方案的地基从此是错的（事后翻正文看不出是哪一处）；
// ② 谁定的标错：AI 掷硬币定的那几处若显示成「顾问已拍板」，整份方案里唯一能看出
//    地基是谁定的那一段（正文开头的方法论速览、对话里那条拍板记录）就是一句假话，
//    而最该复核的那几处再没人看第二眼。

const sheet = (points: any[]) => ({ points, noFork: '', missing: [], dropped: [], truncated: false, discussion: { used: 0, dropped: 0, text: '' } }) as any;

describe('consult AI 自动拍板', () => {
  it('推荐的 label 是另一个 label 的子串时，挑的是被推荐那个，不是先撞上的那个', () => {
    const picks = autoPicksFor(
      sheet([
        {
          id: 'd1',
          question: '主攻哪一批客户？',
          methodRef: '操法 2',
          basis: '定位那一步没定死',
          options: [
            { label: '稳住', detail: '守着现有车场', cost: '放弃新城市' },
            { label: '稳住存量 + 打新城', detail: '两条腿走', cost: '预算摊薄' },
          ],
          recommend: '建议「稳住存量 + 打新城」，现金流撑得住。',
        },
      ])
    );
    expect(picks[0].label).toBe('稳住存量 + 打新城');
    expect(picks[0].by).toBe('ai-recommend');
  });

  it('推荐那句指不到唯一一个选项时记成 ai-fallback，不冒充「按建议定的」', () => {
    const picks = autoPicksFor(
      sheet([
        {
          id: 'd1',
          question: '画像分几类？',
          methodRef: '操法 3',
          basis: '资料里两种都说得通',
          options: [
            { label: '分两类', detail: '', cost: '颗粒度粗' },
            { label: '分四类', detail: '', cost: '执行成本高' },
          ],
          recommend: '两种都行，看你团队执行力。',
        },
      ])
    );
    expect(picks[0].by).toBe('ai-fallback');
  });

  it('AI 定的那批，拍板记录开头不能写成「已经由你定了」', () => {
    const text = decidedToText({
      picks: [
        { question: '主攻哪一批客户？', label: '稳住存量', cost: '放弃新城市', by: 'ai-recommend' },
        { question: '画像分几类？', label: '分两类', cost: '颗粒度粗', by: 'ai-fallback' },
      ],
    });
    expect(text).not.toContain('已经由你定了');
    expect(text).toContain('AI 替你定的');
    // 掷硬币那一处要单独标出来：混成一句「AI 定的」的话，它和有理由的选择长得一样
    expect(text).toContain('连建议都没给准');
  });

  it('老记录（没有 by 这一列）照旧算他自己定的', () => {
    const text = decidedToText({
      picks: [{ question: '主攻哪一批客户？', label: '稳住存量', cost: '放弃新城市' }],
    });
    expect(text).toContain('已经由你定了');
    expect(text).not.toContain('AI 替你定的');
  });
});
