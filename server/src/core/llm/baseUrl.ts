/**
 * 归一化 OpenAI 兼容接入点的 base_url。
 *
 * OpenAI SDK 的 `baseURL` 是**前缀**，它自己会在后面拼 `/chat/completions`。
 * 而各家平台文档给的示例地址（以及 curl 示例、Apifox 导出）都是**完整的**
 * `https://host/v1/chat/completions` —— 管理员照着粘进来，SDK 就请求到
 * `/v1/chat/completions/chat/completions`，上游回 404 «Invalid URL»。
 * 这个 404 长得像「key 不对 / 模型不存在」，实际是多了一段路径，
 * 光看报错几乎不可能想到，所以这里主动截掉而不是提示管理员自己改。
 *
 * 前后空格同理：复制粘贴常带一个尾随空格。SDK 不 trim，
 * 请求会打到 `https://host/v1%20/chat/completions`，同样是 404。
 *
 * 只截 `/chat/completions` 这一段：其余路径（网关自定义前缀、`/compatible-mode/v1`
 * 之类）都是合法前缀，多截一层会把能用的配置改坏。
 */
export function normalizeBaseUrl(raw: string | null | undefined): string {
  let url = String(raw ?? '').trim();
  if (!url) return '';
  // 先去尾部斜杠，`/v1/chat/completions/` 这种写法才能被下面认出来
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/i, '');
  return url.replace(/\/+$/, '');
}
