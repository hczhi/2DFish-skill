// 上游失败的**分类**（不是话术）。
//
// 存在的理由：SDK 的 `APIConnectionTimeoutError` **不设 `name`、`status` 是 undefined**，
// 落到各模块的兜底分支就变成一句原文 `Request timed out.`（18 个字节，HTTP 500）——
// 界面上「模型太慢」和「后端崩了」于是长得一模一样，而两者的解法完全相反（换个快模型 /
// 看服务端栈）。用户读不出成因时只会一路重试，每次等满超时、每次真扣一次额度（硬规则 1）。
//
// **只管分类和成因那半句，不管「怎么办」那半句**：后者每个模块不一样（consult 说「把客户资料
// 删短」，ppt 说「换掉 default 那一档」），合成一份的话总有一个模块在给用不上的建议。
//
// 已知还有一份同样的 instanceof 阶梯在 `api/consult.ts` 的 `fail()` 里（文案是它自己的）。
// 新增一类上游失败时两处都要加 —— 只加一处的话另一个模块把它兜成 500 原文。
import OpenAI from 'openai';

export type UpstreamKind = 'timeout' | 'gateway-timeout' | 'busy' | 'api';

export interface UpstreamFailure {
  kind: UpstreamKind;
  /** 回给前端的状态码。**超时不回 500**：500 在界面上读起来是「我们崩了」。 */
  status: number;
  /** 成因那半句（调用方在后面接自己那句「怎么办」）。 */
  cause: string;
}

/**
 * 认出「这次是上游的问题」，回状态码 + 成因。认不出回 `null`（调用方照旧兜 500 —— 那才是
 * 真的我们这边出错了）。
 */
export function classifyUpstream(e: unknown): UpstreamFailure | null {
  // 连接/读取超时（含重试耗尽）。`instanceof` 是唯一认得出它的办法（见文件头）。
  if (e instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      kind: 'timeout',
      status: 504,
      cause: '等到超时上游都没返回内容（带思维链的模型很容易顶到这个上限）。',
    };
  }
  if (e instanceof OpenAI.APIError) {
    // 上游网关自己掐掉了这次长请求（实测某条接入点 ~300 秒回一句 nginx 的 504 HTML）。
    // 和上一类分开说：那是我们这边的计时器，这是对方的时间上限，原文是一坨 HTML。
    if (e.status === 504 || e.status === 524) {
      return {
        kind: 'gateway-timeout',
        status: 504,
        cause: `上游网关掐掉了这次请求（HTTP ${e.status}）：这条接入点对单次请求有时间上限，而这一次想得太久，撑不进那个上限。`,
      };
    }
    // 上游那台机器忙不过来（实测 `503 system cpu overloaded (current: 97.5%)`）。
    // **必须和「配置错了」分开**：透原文出去读起来像我们坏了，他会去改内容、调参数、
    // 一分钟点五次（每次真扣一次额度），而问题压根不在他那边。
    if (e.status === 429 || e.status === 503 || e.status === 500 || e.status === 502) {
      return {
        kind: 'busy',
        status: 502,
        cause: `上游那台机器现在忙不过来（HTTP ${e.status}）：${e.message}`,
      };
    }
    // 其余（模型名不对 / 余额不足 / 网关 4xx）**要把原文带出去**：兜成 500 的话这些
    // 一句话就能改掉的配置问题只在服务端日志里，而界面上写的是「生成失败」。
    return {
      kind: 'api',
      status: 502,
      cause: `上游模型报错${e.status ? `（HTTP ${e.status}）` : ''}：${e.message}`,
    };
  }
  return null;
}
