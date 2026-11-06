import { describe, it, expect } from 'vitest';
import { composeBpText } from './attachments.js';
import { splitPages, locateAt } from './quotes.js';
import { buildConsistency } from './consistencyService.js';

const BP = '--- 第 1 页 ---\n公司 2025 年收入 2000 万元。\n--- 第 3 页 ---\n团队 40 人。';
const text = composeBpText(BP, [
  { name: '财务报表.pdf', kind: '文件', text: '--- 第 1 页 ---\n利润表\n--- 第 3 页 ---\n2025 年营业收入 800 万元。', notes: [] },
]);

describe('BP 补充材料', () => {
  it('附件第 3 页的句子标成「附件1 第 3 页」，不会被当成 BP 第 3 页', () => {
    expect(locateAt('2025 年营业收入 800 万元', splitPages(text))).toEqual({ page: 3, doc: '附件1《财务报表.pdf》' });
    expect(locateAt('团队 40 人', splitPages(text))).toEqual({ page: 3, doc: null });
  });

  it('BP 和附件对同一指标说法不一样时，两处原文都核得上、分别标出处', () => {
    const r = buildConsistency({ items: [{ metric: '收入', status: 'conflict', severity: '致命',
      values: [{ quote: '公司 2025 年收入 2000 万元' }, { quote: '2025 年营业收入 800 万元' }] }] }, text);
    expect(r.items[0].values.map((v) => [v.page, v.doc])).toEqual([[1, null], [3, '附件1《财务报表.pdf》']]);
  });
});
