// word-extractor 不带类型声明（只有 lib/word.js）。用到的就是下面这几个成员，
// 其余不声明 —— 声明成 any 的话将来 getBody() 拼错名字会静默拿到 undefined，
// 而 undefined 往下走的表现是「提取出 0 字」，看起来像文件本身没有文字。
declare module 'word-extractor' {
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
    getTextboxes(options?: { mainDocument?: boolean; headersFooters?: boolean }): string;
  }
  class WordExtractor {
    // 参数名故意不叫 `source`：`aiAppRegistry.test.ts` 全仓扫 `source:` 字面量来核
    // AI 应用白名单，占这个键名会让那个守卫报假失败（同 xhs 模板里 `origin` 不叫 `source`）。
    extract(input: Buffer | string): Promise<Document>;
  }
  export = WordExtractor;
}
