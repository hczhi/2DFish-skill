import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../db/index.js';
import {
  upsertProvider, resolveLLMProvider, appChannelStatus, listProviders,
  dedicatedChannelStatus, DedicatedChannelError,
} from './aiProviderService.js';

initDatabase();

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function mkUser(id: string, name: string, dedicated = false) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO user (id, username, password_hash, role, use_dedicated_ai, created_at, updated_at)
       VALUES (?, ?, 'x', 'user', ?, ?, ?)`
    )
    .run(id, name, dedicated ? 1 : 0, now, now);
}

/** 加一条可用 provider。api_key 非空是被 pickProvider 筛的硬条件。 */
function addProvider(o: {
  tier: string; owner?: string | null; app?: string; label: string; model?: string; enabled?: boolean; key?: string;
}) {
  return upsertProvider({
    kind: 'llm',
    tier: o.tier,
    label: o.label,
    model: o.model ?? o.label,
    base_url: 'https://example.test/v1',
    api_key: o.key ?? 'sk-test',
    enabled: o.enabled === false ? 0 : 1,
    owner_user_id: o.owner ?? null,
    scope_app: o.app ?? '',
  });
}

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers').run();
  db.prepare('DELETE FROM user').run();
  mkUser(USER, 'alice');
  mkUser(OTHER, 'bob');
});

describe('平台侧：按应用覆盖', () => {
  it('没配应用专用时，走通用配置（与升级前行为一致）', () => {
    addProvider({ tier: 'default', label: '通用default' });
    expect(resolveLLMProvider('default', undefined, 'xhs')?.label).toBe('通用default');
  });

  it('配了应用专用就优先用它', () => {
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用' });
    expect(resolveLLMProvider('default', undefined, 'xhs')?.label).toBe('xhs专用');
  });

  it('给 xhs 配的 key 绝不会被 tender 捡走', () => {
    // scope_app 必须精确匹配。少了这个条件，一个应用的专用 key 会漏给全站，
    // 表现是「按应用分流看起来配好了，其实所有应用都在用同一把」。
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用' });
    expect(resolveLLMProvider('default', undefined, 'tender')?.label).toBe('通用default');
  });

  it('不传 app 时只看通用配置', () => {
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用' });
    expect(resolveLLMProvider('default')?.label).toBe('通用default');
  });

  it('应用内缺档时先回落到该应用的 default，再回落通用', () => {
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'strong', label: '通用strong' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs-default' });
    // xhs 没配 strong：应当用 xhs 自己的 default，而不是通用的 strong ——
    // 「这个应用整体换一把 key」是配置者的意图，跨回通用等于意图被无声推翻。
    expect(resolveLLMProvider('strong', undefined, 'xhs')?.label).toBe('xhs-default');
  });

  it('应用一条都没配时回落通用的同档', () => {
    addProvider({ tier: 'strong', label: '通用strong' });
    addProvider({ tier: 'default', label: '通用default' });
    expect(resolveLLMProvider('strong', undefined, 'xhs')?.label).toBe('通用strong');
  });

  it('禁用的应用专用配置不生效，回落通用', () => {
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用', enabled: false });
    expect(resolveLLMProvider('default', undefined, 'xhs')?.label).toBe('通用default');
  });

  it('api_key 为空的应用专用配置不生效，回落通用', () => {
    // 空 key 拿去调 OpenAI 报的是 401，和「没配」完全两回事，必须在这里筛掉。
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用', key: '' });
    expect(resolveLLMProvider('default', undefined, 'xhs')?.label).toBe('通用default');
  });

  it('未知应用名不会误命中任何专用配置', () => {
    // 白名单挡的是后台输入；万一库里有历史脏数据，解析也不该乱认。
    addProvider({ tier: 'default', label: '通用default' });
    addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用' });
    expect(resolveLLMProvider('default', undefined, 'XHS')?.label).toBe('通用default');
  });
});

describe('专属渠道 + 按应用', () => {
  beforeEach(() => {
    getDatabase().prepare('UPDATE user SET use_dedicated_ai = 1 WHERE id = ?').run(USER);
  });

  it('专属用户的应用专用配置优先于他的通用配置', () => {
    addProvider({ tier: 'default', owner: USER, label: '专属通用' });
    addProvider({ tier: 'default', owner: USER, app: 'xhs', label: '专属xhs' });
    expect(resolveLLMProvider('default', USER, 'xhs')?.label).toBe('专属xhs');
  });

  it('专属用户绝不会用到平台配置，哪怕平台有该应用的专用配置', () => {
    // 052 的核心不变量：付钱的人不能被掉包。
    addProvider({ tier: 'default', app: 'xhs', label: '平台xhs' });
    addProvider({ tier: 'default', owner: USER, label: '专属通用' });
    expect(resolveLLMProvider('default', USER, 'xhs')?.label).toBe('专属通用');
  });

  it('专属用户一条都没配时报错，不静默用平台 key', () => {
    addProvider({ tier: 'default', label: '平台default' });
    addProvider({ tier: 'default', app: 'xhs', label: '平台xhs' });
    expect(() => resolveLLMProvider('default', USER, 'xhs')).toThrow(DedicatedChannelError);
  });

  it('一个用户的专属配置不会被另一个用户用到', () => {
    getDatabase().prepare('UPDATE user SET use_dedicated_ai = 1 WHERE id = ?').run(OTHER);
    addProvider({ tier: 'default', owner: USER, app: 'xhs', label: 'alice的xhs' });
    addProvider({ tier: 'default', owner: OTHER, label: 'bob的通用' });
    expect(resolveLLMProvider('default', OTHER, 'xhs')?.label).toBe('bob的通用');
  });

  it('完备性只算通用配置：只给 xhs 配齐三档不算 ready', () => {
    // 否则开关会被放开，而其他应用一点就撞 DedicatedChannelError ——
    // 报错点离配置动作很远，正是 052 想避免的那种故障。
    for (const t of ['default', 'strong', 'fast']) {
      addProvider({ tier: t, owner: USER, app: 'xhs', label: `xhs-${t}` });
    }
    const st = dedicatedChannelStatus(USER);
    expect(st.ready).toBe(false);
    expect(st.missingTiers).toEqual(['default', 'strong', 'fast']);
  });

  it('通用三档配齐才算 ready', () => {
    for (const t of ['default', 'strong', 'fast']) {
      addProvider({ tier: t, owner: USER, label: `通用-${t}` });
    }
    expect(dedicatedChannelStatus(USER).ready).toBe(true);
  });
});

describe('appChannelStatus：把回落说出来', () => {
  it('逐档报告实际命中的配置，并标出哪些档是回落来的', () => {
    addProvider({ tier: 'default', owner: USER, label: '通用default' });
    addProvider({ tier: 'strong', owner: USER, label: '通用strong' });
    addProvider({ tier: 'fast', owner: USER, label: '通用fast' });
    addProvider({ tier: 'fast', owner: USER, app: 'xhs', label: 'xhs-fast' });

    const st = appChannelStatus(USER, 'xhs');
    const byTier = Object.fromEntries(st.map((r) => [r.tier, r]));

    expect(byTier.fast.label).toBe('xhs-fast');
    expect(byTier.fast.fallbackToShared).toBe(false);
    // 只配了 fast，strong 静默走通用（可能是贵得多的模型）—— 这就是要说出来的那件事
    expect(byTier.strong.label).toBe('通用strong');
    expect(byTier.strong.fallbackToShared).toBe(true);
  });

  it('报告的路径和 resolveLLMProvider 实际走的路径一致', () => {
    // 两处逻辑分叉比不报告更糟：界面写「应用专用」，实际烧的是通用那把 key。
    addProvider({ tier: 'default', owner: USER, label: '通用default' });
    addProvider({ tier: 'strong', owner: USER, label: '通用strong' });
    addProvider({ tier: 'fast', owner: USER, label: '通用fast' });
    addProvider({ tier: 'default', owner: USER, app: 'xhs', label: 'xhs-default' });
    getDatabase().prepare('UPDATE user SET use_dedicated_ai = 1 WHERE id = ?').run(USER);

    for (const r of appChannelStatus(USER, 'xhs')) {
      const actual = resolveLLMProvider(r.tier, USER, 'xhs');
      expect(actual?.id, `${r.tier} 档报告与实际不一致`).toBe(r.providerId);
    }
  });

  it('应用内配了 default、别的档没配时，那些档算「应用专用」而不是回落', () => {
    // pickLLMForApp 的第二步（app+default）也属于「这个应用自己的配置」，
    // 报成回落会让管理员以为自己漏配了。
    addProvider({ tier: 'default', owner: USER, label: '通用default' });
    addProvider({ tier: 'default', owner: USER, app: 'xhs', label: 'xhs-default' });
    const byTier = Object.fromEntries(appChannelStatus(USER, 'xhs').map((r) => [r.tier, r]));
    expect(byTier.strong.label).toBe('xhs-default');
    expect(byTier.strong.fallbackToShared).toBe(false);
  });

  it('一条都没配时 providerId 为 null，不抛错', () => {
    // 这个函数的职责是**报告**缺档，自己先炸的话后台面板直接 500。
    getDatabase().prepare('UPDATE user SET use_dedicated_ai = 1 WHERE id = ?').run(USER);
    const st = appChannelStatus(USER, 'xhs');
    expect(st.every((r) => r.providerId === null)).toBe(true);
    expect(st.every((r) => r.fallbackToShared === false)).toBe(true);
  });
});

describe('upsertProvider 的 scope_app 归一', () => {
  it('不传 scope_app 时存成空串，能被通用查询命中', () => {
    // 存成 NULL 的话，`COALESCE(scope_app,'') = ''` 之外的写法会让这行凭空消失。
    const p = addProvider({ tier: 'default', label: 'x' });
    expect(p.scope_app).toBe('');
    expect(resolveLLMProvider('default')?.id).toBe(p.id);
  });

  it('编辑时不传 scope_app 不会把已有的应用归属抹掉', () => {
    const p = addProvider({ tier: 'default', app: 'xhs', label: 'xhs专用' });
    const updated = upsertProvider({ id: p.id, label: '改个名' });
    expect(updated.scope_app).toBe('xhs');
    expect(resolveLLMProvider('default', undefined, 'xhs')?.label).toBe('改个名');
  });

  it('列表里通用配置排在应用专用之前', () => {
    addProvider({ tier: 'default', owner: USER, app: 'xhs', label: 'xhs专用' });
    addProvider({ tier: 'default', owner: USER, label: '通用' });
    expect(listProviders(USER).map((p) => p.label)).toEqual(['通用', 'xhs专用']);
  });
});
