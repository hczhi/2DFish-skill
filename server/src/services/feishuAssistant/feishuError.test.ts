import { describe, it, expect } from 'vitest';
import {
  describeFeishuError,
  describeFeishuErrorDetail,
  isContactUnavailable,
  isScopeDenied,
} from './feishuError.js';

// 这里的样本是真实报文。
//
// 为什么值得测：SDK 只把详情打进 logger，抛出来的是原始 AxiosError，
// 所以 e.message 永远是 "Request failed with status code 400"。
// 这个函数是「用户在飞书里收到的失败原因」和「一句废话」之间的唯一区别。

/** 复刻 SDK 抛出的形状：AxiosError 上挂着 response.data。 */
function axiosLike(data: unknown): Error {
  const e = new Error('Request failed with status code 400');
  (e as unknown as { response: { data: unknown } }).response = { data };
  return e;
}

const SCOPE_DENIED_REAL = axiosLike({
  code: 99991672,
  msg:
    'Access denied. One of the following scopes is required: [task:task:write, task:task:writeonly].' +
    '应用尚未开通所需的应用身份权限：[task:task:write, task:task:writeonly]，' +
    '点击链接申请并开通任一权限即可：' +
    'https://open.feishu.cn/app/cli_aafb3a5f7b795cb3/auth?q=task:task:write,task:task:writeonly&op_from=openapi&token_type=tenant',
  log_id: '20260804185909A15E80512A3691A0BCA3',
  permission_violations: [
    { type: 'tenant', subject: 'app', scopes: ['task:task:write', 'task:task:writeonly'] },
  ],
});

describe('缺权限（99991672）', () => {
  it('抠出缺的权限点、申请链接，并提醒要发布版本', () => {
    const out = describeFeishuError(SCOPE_DENIED_REAL);

    expect(out).toContain('task:task:write');
    expect(out).toContain('task:task:writeonly');
    // 两个权限是「任一项」而不是「都要」——写成「都要」会让用户白开一个。
    expect(out).toContain('任一项');
    expect(out).toContain('https://open.feishu.cn/app/cli_aafb3a5f7b795cb3/auth');
    // 头号坑：只开权限不发版，表现和没开完全一样。
    expect(out).toContain('发布新版本');
    // 那句废话不该出现在给用户的回复里。
    expect(out).not.toContain('status code 400');
  });

  it('没有 permission_violations 时从 msg 里抠权限点', () => {
    const out = describeFeishuError(
      axiosLike({
        code: 99991672,
        msg: '应用尚未开通所需的应用身份权限：[calendar:calendar.event:create]',
      })
    );
    expect(out).toContain('calendar:calendar.event:create');
    expect(out).toContain('发布新版本');
  });

  it('单个权限时不说「任一项」', () => {
    const out = describeFeishuError(
      axiosLike({ code: 99991672, msg: '权限不足：[im:message]', permission_violations: [{ scopes: ['im:message'] }] })
    );
    expect(out).toContain('im:message');
    expect(out).not.toContain('任一项');
  });
});

// 真实报文：权限点已经开好了，但飞书后台的「数据权限 > 通讯录范围」是空的。
// 原文只有 'no dept authority error' —— 用户照着它完全无从下手，
// 尤其会以为是权限点没开（那里明明已经是绿的）。
const NO_DEPT_AUTHORITY_REAL = axiosLike({
  code: 40004,
  msg: 'no dept authority error',
  log_id: 'LOG40004',
});

describe('通讯录范围没配（40004）', () => {
  it('不照抄飞书原文 —— 「no dept authority error」等于没说', () => {
    const out = describeFeishuError(NO_DEPT_AUTHORITY_REAL, 'cli_myapp');
    expect(out).not.toContain('no dept authority');
    // 必须指到具体那一栏。飞书后台「权限管理」下面有两栏，去错了那栏什么都看不出问题。
    expect(out).toContain('通讯录范围');
    expect(out).toContain('数据权限');
    expect(out).toContain('发布新版本');
  });

  it('kind 和缺权限点分开 —— 前端要导到不同的页面', () => {
    const d = describeFeishuErrorDetail(NO_DEPT_AUTHORITY_REAL, 'cli_myapp');
    expect(d.kind).toBe('contact_scope_empty');
    expect(d.code).toBe(40004);
    expect(d.log_id).toBe('LOG40004');
  });

  it('链接不带 q= —— 那是「勾选这几个权限点」，而权限点用户已经开好了', () => {
    const d = describeFeishuErrorDetail(NO_DEPT_AUTHORITY_REAL, 'cli_myapp');
    expect(d.apply_url).toBe('https://open.feishu.cn/app/cli_myapp/auth');
    expect(d.apply_url).not.toContain('q=');
  });
});

// 真实报文：给同事发私聊时对方不在应用「可用范围」里。
// 原文是英文的，而且一个字都没提「可用范围」在哪配。
const NO_AVAILABILITY_REAL = axiosLike({
  code: 230013,
  msg: 'Bot has NO availability to this user.',
  log_id: 'LOG230013',
});

describe('对方不在可用范围（230013）', () => {
  it('翻译成人话，并指到「应用发布 > 版本管理与发布」', () => {
    const out = describeFeishuError(NO_AVAILABILITY_REAL, 'cli_myapp');
    expect(out).toContain('可用范围');
    expect(out).toContain('版本管理与发布');
    // 说明这不是权限问题，否则用户会去权限页反复确认（那里一切正常）。
    expect(out).toContain('三件不同的事');
    expect(out).toContain('发布新版本');
  });

  it('明确说「新应用默认只有创建者可用」—— 否则会被当成配错了什么', () => {
    // 这是第一次给同事发消息的必经错误，说清"这是默认行为"能省掉一轮排查。
    expect(describeFeishuError(NO_AVAILABILITY_REAL)).toContain('默认只有创建者本人');
  });

  it('链接指向 publish 页，不是权限页', () => {
    const d = describeFeishuErrorDetail(NO_AVAILABILITY_REAL, 'cli_myapp');
    expect(d.kind).toBe('availability_denied');
    expect(d.apply_url).toBe('https://open.feishu.cn/app/cli_myapp/publish');
    // 导到 /auth 是错的：可用范围不在那一页，用户会看到权限全绿然后卡住。
    expect(d.apply_url).not.toContain('/auth');
  });

  it('不被误判成缺权限 —— 三套设置在后台是三个页面', () => {
    expect(isScopeDenied(NO_AVAILABILITY_REAL)).toBe(false);
    expect(isContactUnavailable(NO_AVAILABILITY_REAL)).toBe(false);
  });
});

describe('名册同步该不该降级', () => {
  it('两个 code 都算「通讯录读不到」—— 对用户的后果一样', () => {
    // 只判 99991672 的话，40004 的企业会看到同步整个失败，
    // 而其实降级到群成员就能用。
    expect(isContactUnavailable(SCOPE_DENIED_REAL)).toBe(true);
    expect(isContactUnavailable(NO_DEPT_AUTHORITY_REAL)).toBe(true);
  });

  it('网络/限流/5xx 不算 —— 降级会让用户拿着残缺名册以为成功了', () => {
    expect(isContactUnavailable(new Error('socket hang up'))).toBe(false);
    expect(isContactUnavailable(axiosLike({ code: 99991400, msg: 'too many request' }))).toBe(false);
    expect(isContactUnavailable(axiosLike({ code: 500 }))).toBe(false);
  });

  it('isScopeDenied 仍然只认权限点，没被 40004 污染', () => {
    // 它还被用在别处判「要不要渲染一键授权按钮」，放宽了会把 40004
    // 导到那个全是绿勾的授权页。
    expect(isScopeDenied(NO_DEPT_AUTHORITY_REAL)).toBe(false);
    expect(isScopeDenied(SCOPE_DENIED_REAL)).toBe(true);
  });
});

describe('其他飞书错误', () => {
  it('透出 msg，并带上 code 和 log_id 供管理员排查', () => {
    const out = describeFeishuError(
      axiosLike({ code: 232002, msg: 'calendar not found', log_id: 'LOG123' })
    );
    expect(out).toContain('calendar not found');
    expect(out).toContain('232002');
    expect(out).toContain('LOG123');
  });

  it('msg 为空时回落到 Error.message，而不是返回空串', () => {
    const out = describeFeishuError(axiosLike({ code: 500 }));
    expect(out).toBe('Request failed with status code 400');
  });
});

describe('结构化输出（前端靠它渲染补权限按钮）', () => {
  it('缺权限时给出 kind / scopes / apply_url，前端不需要解析文本', () => {
    const d = describeFeishuErrorDetail(SCOPE_DENIED_REAL, 'cli_aafb3a5f7b795cb3');

    expect(d.kind).toBe('scope_denied');
    expect(d.scopes).toEqual(['task:task:write', 'task:task:writeonly']);
    expect(d.apply_url).toContain('open.feishu.cn/app/cli_aafb3a5f7b795cb3/auth');
    expect(d.code).toBe(99991672);
    expect(d.log_id).toBe('20260804185909A15E80512A3691A0BCA3');
  });

  it('飞书 msg 里没带链接时，用 app_id + scopes 兜底拼一个', () => {
    // 不是每个接口都在 msg 里给链接，而"点一下去开权限"恰恰是这类失败唯一要做的事。
    const d = describeFeishuErrorDetail(
      axiosLike({
        code: 99991672,
        msg: '应用尚未开通所需的应用身份权限：[calendar:calendar.event:create]',
      }),
      'cli_myapp'
    );

    expect(d.apply_url).toBe(
      'https://open.feishu.cn/app/cli_myapp/auth' +
        '?q=calendar%3Acalendar.event%3Acreate&op_from=openapi&token_type=tenant'
    );
  });

  it('优先用飞书给的链接，不用自己拼的（域名分飞书/Lark 两套）', () => {
    const d = describeFeishuErrorDetail(SCOPE_DENIED_REAL, 'cli_different_from_msg');
    expect(d.apply_url).toContain('cli_aafb3a5f7b795cb3');
    expect(d.apply_url).not.toContain('cli_different_from_msg');
  });

  it('没有 app_id 又没有链接时 apply_url 为空（前端据此不渲染按钮）', () => {
    const d = describeFeishuErrorDetail(axiosLike({ code: 99991672, msg: '权限不足：[im:message]' }));
    expect(d.scopes).toEqual(['im:message']);
    expect(d.apply_url).toBeUndefined();
  });

  it('非权限错误标成 api_error，不渲染补权限引导', () => {
    const d = describeFeishuErrorDetail(axiosLike({ code: 232002, msg: 'calendar not found' }));
    expect(d.kind).toBe('api_error');
    expect(d.apply_url).toBeUndefined();
    expect(d.scopes).toBeUndefined();
  });

  it('普通 Error 也是 api_error', () => {
    expect(describeFeishuErrorDetail(new Error('缺少任务标题')).kind).toBe('api_error');
  });
});

describe('非飞书异常原样透出', () => {
  it('普通 Error 用 message', () => {
    expect(describeFeishuError(new Error('缺少任务标题，请在指令里说清楚。'))).toBe(
      '缺少任务标题，请在指令里说清楚。'
    );
  });

  it('响应体是字符串（非 JSON 错误页）时不崩', () => {
    expect(describeFeishuError(axiosLike('<html>502 Bad Gateway</html>'))).toBe(
      'Request failed with status code 400'
    );
  });

  it('抛的不是 Error 也不崩', () => {
    expect(describeFeishuError('炸了')).toBe('炸了');
    expect(describeFeishuError(undefined)).toBe('undefined');
  });
});
