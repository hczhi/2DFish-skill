import { describe, it, expect } from 'vitest';
import { parseFirstJson, parseFirstJsonArray, parseFirstJsonAny } from './parseJson.js';

describe('parseFirstJson', () => {
  it('解析裸 JSON 对象', () => {
    expect(parseFirstJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('剥掉 markdown 围栏', () => {
    expect(parseFirstJson('```json\n{"score":88}\n```')).toEqual({ score: 88 });
    expect(parseFirstJson('```\n{"score":88}\n```')).toEqual({ score: 88 });
  });

  it('JSON 后面还有解释文字时仍能解析（贪婪正则在这里必挂）', () => {
    const text = '{"score":90}\n\n以上是我的评分，供参考。';
    expect(parseFirstJson(text)).toEqual({ score: 90 });
  });

  it('JSON 前面有前言时仍能解析', () => {
    expect(parseFirstJson('好的，结果如下：\n{"ok":true}')).toEqual({ ok: true });
  });

  it('模型多吐一个示例 JSON 时，贪婪正则会横跨两段而失败，这里只取第一段', () => {
    const text = '{"a":1}\n比如还可以是 {"a":2}';
    // 贪婪 /\{[\s\S]*\}/ 会匹配到 `{"a":1}\n比如还可以是 {"a":2}` —— 不是合法 JSON。
    expect(() => JSON.parse(text.match(/\{[\s\S]*\}/)![0])).toThrow();
    expect(parseFirstJson(text)).toEqual({ a: 1 });
  });

  it('字符串内部出现 } 时不会提前截断', () => {
    const text = '{"note":"这里有个 } 符号","v":1}';
    expect(parseFirstJson(text)).toEqual({ note: '这里有个 } 符号', v: 1 });
  });

  it('字符串内转义引号不会破坏配平', () => {
    const text = String.raw`{"q":"他说\"你好\" 然后走了","n":2}`;
    expect(parseFirstJson(text)).toEqual({ q: '他说"你好" 然后走了', n: 2 });
  });

  it('嵌套对象正确配平', () => {
    expect(parseFirstJson('前言 {"a":{"b":{"c":[1,2,{"d":3}]}}} 后记'))
      .toEqual({ a: { b: { c: [1, 2, { d: 3 }] } } });
  });

  it('无 JSON / 非法 JSON / 空输入 返回 null（不抛错）', () => {
    expect(parseFirstJson('完全没有 json')).toBeNull();
    expect(parseFirstJson('{不是合法json}')).toBeNull();
    expect(parseFirstJson('{"未闭合":1')).toBeNull();
    expect(parseFirstJson('')).toBeNull();
  });
});

describe('parseFirstJsonArray', () => {
  it('解析数组并忽略尾部文字', () => {
    expect(parseFirstJsonArray('[{"id":1},{"id":2}]\n共 2 条')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('拿到的是对象而非数组时返回 null', () => {
    expect(parseFirstJsonArray('{"a":1}')).toBeNull();
  });

  it('数组元素字符串里含 ] 不提前截断', () => {
    expect(parseFirstJsonArray('["a]b","c"]')).toEqual(['a]b', 'c']);
  });
});

describe('parseFirstJsonAny', () => {
  it('对象在前取对象，数组在前取数组', () => {
    expect(parseFirstJsonAny('{"a":1} 然后 [1,2]')).toEqual({ a: 1 });
    expect(parseFirstJsonAny('[1,2] 然后 {"a":1}')).toEqual([1, 2]);
  });

  it('只有一种时也能拿到', () => {
    expect(parseFirstJsonAny('结果：[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseFirstJsonAny('结果：{"a":1}')).toEqual({ a: 1 });
  });
});
