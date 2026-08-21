import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../db/index.js';
import { upsertProvider, deleteProvider } from './aiProviderService.js';
import { createRelayKey, findRelayKeyByRaw } from './relayKeyService.js';

initDatabase();

// 两条都是「关掉了接口，下游却照样通，而后台显示已关闭」的路径。

const USER = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM llm_relay_keys').run();
  db.prepare('DELETE FROM ai_providers').run();
});

function addProvider(id?: string) {
  return upsertProvider({
    id,
    kind: 'llm',
    tier: 'default',
    label: '专属default',
    model: 'qwen-plus',
    base_url: 'https://example.test/v1',
    api_key: 'sk-upstream',
    owner_user_id: USER,
  });
}

describe('对外中转 key 的失效', () => {
  it('删掉接入点后再建一条同 id 的，那把 key 不会跟着活过来', () => {
    // provider 的 id 是外部可指定的（种子那条就叫 default-llm）。只靠调用时
    // 「查不到那条 provider 就拒」的话，重建之后这把早该失效的 key 会接着转发 ——
    // 下游一切正常，管理员以为自己已经把接口断掉了。
    const p = addProvider('default-llm');
    const { key } = createRelayKey(USER, p.id, '给某个下游');

    const { revokedRelayKeys } = deleteProvider(p.id);
    expect(revokedRelayKeys).toBe(1);

    addProvider('default-llm'); // 同 id 重建
    const found = findRelayKeyByRaw(key)!;
    expect(found.enabled).toBe(0);
    expect(found.revoked_at).not.toBeNull();
    expect(found.revoke_reason).toContain('删除');
  });

  it('已失效的 key 仍然查得到，才能回「接口已关闭」而不是「无效的 key」', () => {
    // 查不到就当不存在的话，两种情况会共用一句「无效的 API Key」，
    // 下游会一直去核对那把没抄错的 key，而真实原因是这边把接入点删了。
    const p = addProvider();
    const { key } = createRelayKey(USER, p.id);
    deleteProvider(p.id);

    expect(findRelayKeyByRaw(key)).toBeTruthy();
    expect(findRelayKeyByRaw('sk-mmpla-nonexistent')).toBeUndefined();
  });
});
