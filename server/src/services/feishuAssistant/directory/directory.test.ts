import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../../db/index.js';
import {
  countUsers,
  findByName,
  listDepartments,
  listUsers,
  normalizeName,
  replaceDirectory,
  setSyncState,
  deleteDirectory,
} from './store.js';
import { syncDirectory } from './sync.js';

// 名册这一层测三件「错了很难查」的事：
//   1. 归一化必须写读一致 —— 分开实现会出现「存进去了但查不到」，而且没有任何报错；
//   2. 整批替换必须是原子的、且失败不清空 —— 半张空名册比一份旧名册糟得多；
//   3. 降级只在**缺权限**时发生 —— 网络抖动降级会给出一份不完整的名册，
//      而用户以为同步成功了。

const APP = 'cli_dir_test';

beforeAll(() => { initDatabase(); });

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_directory_users').run();
  db.prepare('DELETE FROM feishu_directory_departments').run();
  db.prepare('DELETE FROM feishu_apps').run();
});

/** 建一行 feishu_apps，syncDirectory 要往上面写状态。 */
function seedApp(appId = APP) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO feishu_apps
         (id, user_id, name, app_id, app_secret, enabled, allowed_chats, conn_state, created_at, updated_at)
       VALUES (?, 'u1', '测试', ?, 'x', 1, '[]', 'idle', ?, ?)`
    )
    .run(`row-${appId}`, appId, now, now);
}

function syncRow(appId = APP) {
  return getDatabase()
    .prepare(
      'SELECT dir_sync_state, dir_sync_error, dir_user_count, dir_source FROM feishu_apps WHERE app_id = ?'
    )
    .get(appId) as {
    dir_sync_state: string;
    dir_sync_error: string | null;
    dir_user_count: number;
    dir_source: string;
  };
}

describe('normalizeName', () => {
  it('去空格、间隔号，英文转小写', () => {
    expect(normalizeName(' 张 三 ')).toBe('张三');
    expect(normalizeName('张·三')).toBe('张三');
    expect(normalizeName('张　三')).toBe('张三'); // 全角空格
    expect(normalizeName('Tom Lee')).toBe('tomlee');
    expect(normalizeName('L.J.')).toBe('lj');
  });

  it('全是分隔符时归一化成空串（调用方据此当「没说名字」处理）', () => {
    expect(normalizeName('  ·  ')).toBe('');
  });
});

describe('replaceDirectory', () => {
  it('写入后能按归一化后的名字查到', () => {
    replaceDirectory(APP, [{ openId: 'ou_a', name: ' 张 三 ' }], []);
    // 存的时候归一化了，查的时候也归一化 —— 两边必须是同一个函数。
    expect(findByName(APP, '张三').map((u) => u.open_id)).toEqual(['ou_a']);
    expect(findByName(APP, '张·三').map((u) => u.open_id)).toEqual(['ou_a']);
  });

  it('是**整批替换**：上一次同步里有、这一次没有的人要消失', () => {
    replaceDirectory(APP, [
      { openId: 'ou_a', name: '张三' },
      { openId: 'ou_b', name: '李四' },
    ], []);
    // 李四离职并从通讯录移除。留着他只会让助理一直能给一个失效 open_id 发消息。
    replaceDirectory(APP, [{ openId: 'ou_a', name: '张三' }], []);

    expect(countUsers(APP)).toBe(1);
    expect(findByName(APP, '李四')).toEqual([]);
  });

  it('只影响本 app 的行', () => {
    replaceDirectory(APP, [{ openId: 'ou_a', name: '张三' }], []);
    replaceDirectory('cli_other', [{ openId: 'ou_b', name: '李四' }], []);

    expect(countUsers(APP)).toBe(1);
    expect(countUsers('cli_other')).toBe(1);
    expect(findByName(APP, '李四')).toEqual([]);
  });

  it('丢掉没有 open_id 或没有姓名的行 —— 两者缺一都没法用', () => {
    replaceDirectory(APP, [
      { openId: '', name: '张三' },
      { openId: 'ou_b', name: '   ' },
      { openId: 'ou_c', name: '王五' },
    ], []);
    expect(countUsers(APP)).toBe(1);
  });

  it('部门一并存下来（同名歧义时唯一的区分依据）', () => {
    replaceDirectory(APP, [], [
      { department_id: 'od_1', name: '销售部', parent_id: '0', member_count: 3 },
    ]);
    expect(listDepartments(APP)).toEqual([
      { department_id: 'od_1', name: '销售部', parent_id: '0', member_count: 3 },
    ]);
  });
});

describe('findByName 的精确匹配', () => {
  beforeEach(() => {
    replaceDirectory(APP, [
      { openId: 'ou_zs', name: '张三', departmentNames: '销售部' },
      { openId: 'ou_zw', name: '张伟', departmentNames: '技术部' },
      { openId: 'ou_ls1', name: '李四', departmentNames: '销售部' },
      { openId: 'ou_ls2', name: '李四', departmentNames: '技术部' },
      { openId: 'ou_gone', name: '赵六', isResigned: true },
    ], []);
  });

  it('不做前缀匹配 —— 「张」不该命中任何人', () => {
    // 这是刻意的。只有一个人姓张时前缀匹配最危险：它会默默把消息
    // 发给用户根本没想过的那个人。
    expect(findByName(APP, '张')).toEqual([]);
  });

  it('同名返回全部，由调用方处理歧义', () => {
    expect(findByName(APP, '李四')).toHaveLength(2);
  });

  it('在职的排在前面', () => {
    replaceDirectory(APP, [
      { openId: 'ou_old', name: '钱七', isResigned: true },
      { openId: 'ou_new', name: '钱七' },
    ], []);
    expect(findByName(APP, '钱七')[0].open_id).toBe('ou_new');
  });

  it('空名字返回空数组，不返回全表', () => {
    expect(findByName(APP, '   ')).toEqual([]);
  });
});

describe('listUsers（后台名册页）', () => {
  beforeEach(() => {
    replaceDirectory(APP, [
      { openId: 'ou_zs', name: '张三', departmentNames: '销售部', jobTitle: '销售经理' },
      { openId: 'ou_ls', name: '李四', departmentNames: '技术部', jobTitle: '后端工程师' },
    ], []);
  });

  it('不带 q 时全列，带总数', () => {
    const { users, total } = listUsers({ appId: APP });
    expect(total).toBe(2);
    expect(users).toHaveLength(2);
  });

  it('这里**允许**模糊搜索 —— 由人来选，不是自动执行', () => {
    expect(listUsers({ appId: APP, q: '张' }).total).toBe(1);
    expect(listUsers({ appId: APP, q: '技术部' }).total).toBe(1);
    expect(listUsers({ appId: APP, q: '工程师' }).total).toBe(1);
  });

  it('分页的 total 是过滤后的总数，不是本页条数', () => {
    const { users, total } = listUsers({ appId: APP, limit: 1 });
    expect(users).toHaveLength(1);
    expect(total).toBe(2);
  });
});

describe('deleteDirectory', () => {
  it('只清本 app 的人和部门', () => {
    replaceDirectory(APP, [{ openId: 'ou_a', name: '张三' }], [
      { department_id: 'od_1', name: '销售部', parent_id: '0', member_count: 1 },
    ]);
    replaceDirectory('cli_other', [{ openId: 'ou_b', name: '李四' }], []);

    deleteDirectory(APP);

    expect(countUsers(APP)).toBe(0);
    expect(listDepartments(APP)).toEqual([]);
    expect(countUsers('cli_other')).toBe(1);
  });
});

describe('setSyncState', () => {
  it('只更新传了的字段（错误信息不会被后续的状态更新抹掉）', () => {
    seedApp();
    setSyncState(APP, 'failed', { error: '缺权限' });
    setSyncState(APP, 'syncing');
    const row = syncRow();
    expect(row.dir_sync_state).toBe('syncing');
    expect(row.dir_sync_error).toBe('缺权限');
  });
});

// ==================== 同步引擎 ====================

/** 缺权限的错误，形状与 SDK 抛出的 AxiosError 一致。 */
function scopeError(): Error {
  const e = new Error('Request failed with status code 403');
  (e as unknown as { response: { data: unknown } }).response = {
    data: { code: 99991672, msg: 'Access denied. One of the following scopes is required: [contact:user.base:readonly]' },
  };
  return e;
}

/**
 * 通讯录**范围**没配（权限点是开的）。飞书给的 code 是 40004，
 * 原文 'no dept authority error'。和 99991672 是两回事，但后果一样：读不到通讯录。
 */
function noDeptAuthorityError(): Error {
  const e = new Error('Request failed with status code 403');
  (e as unknown as { response: { data: unknown } }).response = {
    data: { code: 40004, msg: 'no dept authority error' },
  };
  return e;
}

/** 分页返回的 helper：一页拉完。 */
const page = (items: unknown[]) => ({ data: { items, has_more: false } });

describe('syncDirectory 主路（通讯录）', () => {
  it('遍历部门树 + 逐部门拉人，去重后整批写库', async () => {
    seedApp();
    // 部门树：根下有 od_1，od_1 下有 od_2，od_2 无子部门。
    const children = vi.fn(async ({ path }: { path: { department_id: string } }) => {
      if (path.department_id === '0') {
        return page([{ open_department_id: 'od_1', name: '销售部', parent_department_id: '0', member_count: 2 }]);
      }
      if (path.department_id === 'od_1') {
        return page([{ open_department_id: 'od_2', name: '华东组', parent_department_id: 'od_1', member_count: 1 }]);
      }
      return page([]);
    });
    const findByDepartment = vi.fn(async ({ params }: { params: { department_id: string } }) => {
      if (params.department_id === 'od_1') {
        return page([
          { open_id: 'ou_zs', name: '张三', job_title: '经理', department_ids: ['od_1'] },
          // 同一个人同时在 od_1 和 od_2 —— 会被拉到两次。
          { open_id: 'ou_ls', name: '李四', department_ids: ['od_1', 'od_2'] },
        ]);
      }
      if (params.department_id === 'od_2') {
        return page([{ open_id: 'ou_ls', name: '李四', department_ids: ['od_1', 'od_2'] }]);
      }
      return page([]);
    });

    const client = {
      contact: { v3: { department: { children }, user: { findByDepartment } } },
    } as unknown as Client;

    const res = await syncDirectory(client, APP);

    expect(res.source).toBe('contact');
    expect(res.userCount).toBe(2); // 李四没被算两遍
    expect(res.departmentCount).toBe(2);
    // 根部门也被拉过 —— 直属公司根的人（常见于高管）不在任何子部门里。
    expect(findByDepartment.mock.calls.some((c) => c[0].params.department_id === '0')).toBe(true);
    // 跨部门的人，部门名要合并而不是被覆盖。
    expect(findByName(APP, '李四')[0].department_names).toBe('销售部 / 华东组');

    const row = syncRow();
    expect(row.dir_sync_state).toBe('ok');
    expect(row.dir_user_count).toBe(2);
    expect(row.dir_source).toBe('contact');
  });

  it('已删除的部门跳过', async () => {
    seedApp();
    const client = {
      contact: {
        v3: {
          department: {
            children: vi.fn(async ({ path }: { path: { department_id: string } }) =>
              path.department_id === '0'
                ? page([
                    { open_department_id: 'od_live', name: '在用', parent_department_id: '0' },
                    { open_department_id: 'od_dead', name: '已删', parent_department_id: '0', status: { is_deleted: true } },
                  ])
                : page([])
            ),
          },
          // 至少要有一个人：一个人都没有会被当成「通讯录范围是空的」而降级。
          user: {
            findByDepartment: vi.fn(async () => page([{ open_id: 'ou_a', name: '张三' }])),
          },
        },
      },
    } as unknown as Client;

    const res = await syncDirectory(client, APP);
    expect(res.departmentCount).toBe(1);
  });

  it('离职标记带进名册（people.ts 靠它给出「已离职」而不是「找不到」）', async () => {
    seedApp();
    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => page([])) },
          user: {
            findByDepartment: vi.fn(async () =>
              page([{ open_id: 'ou_gone', name: '赵六', status: { is_resigned: true } }])
            ),
          },
        },
      },
    } as unknown as Client;

    await syncDirectory(client, APP);
    expect(findByName(APP, '赵六')[0].is_resigned).toBe(1);
  });
});

describe('syncDirectory 降级', () => {
  /** 通讯录一律缺权限，群成员那条路按传入的行为响应。 */
  function clientWithChats(chatMembers: unknown[][]): Client {
    return {
      contact: {
        v3: {
          department: { children: vi.fn(async () => { throw scopeError(); }) },
          user: { findByDepartment: vi.fn(async () => { throw scopeError(); }) },
        },
      },
      im: {
        v1: {
          chat: { list: vi.fn(async () => page(chatMembers.map((_, i) => ({ chat_id: `oc_${i}` })))) },
          chatMembers: {
            get: vi.fn(async ({ path }: { path: { chat_id: string } }) => {
              const idx = Number(path.chat_id.replace('oc_', ''));
              return page(chatMembers[idx] ?? []);
            }),
          },
        },
      },
    } as unknown as Client;
  }

  it('通讯录范围没配（40004）也降级 —— 权限点开了不等于读得到人', async () => {
    seedApp();
    // 这个企业的权限点全是绿的，飞书只回一句 'no dept authority error'。
    // 之前只判 99991672，于是整个同步失败，用户拿着这句话完全无从下手。
    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => { throw noDeptAuthorityError(); }) },
          user: { findByDepartment: vi.fn() },
        },
      },
      im: {
        v1: {
          chat: { list: vi.fn(async () => page([{ chat_id: 'oc_0' }])) },
          chatMembers: { get: vi.fn(async () => page([{ member_id: 'ou_zs', name: '张三' }])) },
        },
      },
    } as unknown as Client;

    const res = await syncDirectory(client, APP);
    expect(res.source).toBe('chats');
    expect(countUsers(APP)).toBe(1);
    // 说明里要指到「数据权限 > 通讯录范围」，不是笼统的「缺权限」。
    expect(syncRow().dir_sync_error).toContain('通讯录范围');
  });

  it('通讯录调通但可读成员是 0 人时也降级（飞书这时不报错）', async () => {
    seedApp();
    // 权限范围里没勾任何部门时，接口全部 200，只是什么都不返回。
    // 不拦的话会走进整批替换，把上次的好名册清成 0 人还显示「已同步」。
    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => page([])) },
          user: { findByDepartment: vi.fn(async () => page([])) },
        },
      },
      im: {
        v1: {
          chat: { list: vi.fn(async () => page([{ chat_id: 'oc_0' }])) },
          chatMembers: { get: vi.fn(async () => page([{ member_id: 'ou_zs', name: '张三' }])) },
        },
      },
    } as unknown as Client;

    const res = await syncDirectory(client, APP);
    expect(res.source).toBe('chats');
    expect(syncRow().dir_sync_error).toContain('通讯录范围');
  });

  it('两条路都拿不到人时算失败，**不写一份 0 人的空名册**', async () => {
    seedApp();
    replaceDirectory(APP, [{ openId: 'ou_zs', name: '张三' }], []);

    // 场景：管理员收回了通讯录权限，且机器人还没进任何群。
    // 写空数组的话用户会从一份好名册变成零人，而状态是「已同步」。
    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => { throw scopeError(); }) },
          user: { findByDepartment: vi.fn() },
        },
      },
      im: {
        v1: {
          chat: { list: vi.fn(async () => page([])) },
          chatMembers: { get: vi.fn() },
        },
      },
    } as unknown as Client;

    await expect(syncDirectory(client, APP)).rejects.toThrow(/没能从群里收集到人|拉进任何群/);
    expect(countUsers(APP)).toBe(1); // 旧名册还在
    expect(syncRow().dir_sync_state).toBe('failed');
  });

  it('缺通讯录权限时降级到群成员，并把实情记进 dir_source', async () => {
    seedApp();
    const client = clientWithChats([
      [{ member_id: 'ou_zs', name: '张三' }, { member_id: 'ou_ls', name: '李四' }],
      // 跨群重复的人只算一次。
      [{ member_id: 'ou_ls', name: '李四' }, { member_id: 'ou_ww', name: '王五' }],
    ]);

    const res = await syncDirectory(client, APP);

    expect(res.source).toBe('chats');
    expect(res.userCount).toBe(3);
    // 用户必须知道自己拿到的只是群成员，否则「查不到某人」会被当成 bug。
    expect(res.note).toContain('只覆盖机器人在的群');
    // 而且要说清真实原因和怎么补 —— 光说「降级了」他不知道下一步做什么。
    expect(res.note).toContain('contact:user.base:readonly');
    const row = syncRow();
    expect(row.dir_source).toBe('chats');
    expect(row.dir_sync_state).toBe('ok');
    expect(row.dir_sync_error).toContain('只覆盖机器人在的群');
    // 这条路拿不到部门，写空壳只会让后台的架构树显示成空。
    expect(listDepartments(APP)).toEqual([]);
  });

  it('**只有**缺权限才降级：网络错误直接失败，不给一份残缺名册', async () => {
    seedApp();
    const chatList = vi.fn(async () => page([]));
    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => { throw new Error('socket hang up'); }) },
          user: { findByDepartment: vi.fn(async () => page([])) },
        },
      },
      im: { v1: { chat: { list: chatList }, chatMembers: { get: vi.fn() } } },
    } as unknown as Client;

    await expect(syncDirectory(client, APP)).rejects.toThrow(/socket hang up/);
    // 关键：兜底路一次都没走。走了的话用户会拿到一份不完整的名册，
    // 而失败的真实原因（网络）被掩盖成「权限没开」。
    expect(chatList).not.toHaveBeenCalled();
    expect(syncRow().dir_sync_state).toBe('failed');
  });

  it('同步失败时**不清空**已有名册 —— 一次抖动不该让助理突然不认识任何人', async () => {
    seedApp();
    replaceDirectory(APP, [{ openId: 'ou_zs', name: '张三' }], []);

    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => { throw new Error('飞书 5xx'); }) },
          user: { findByDepartment: vi.fn() },
        },
      },
    } as unknown as Client;

    await expect(syncDirectory(client, APP)).rejects.toThrow();
    expect(countUsers(APP)).toBe(1);
    expect(findByName(APP, '张三')).toHaveLength(1);
  });

  it('失败原因是人话，不是「Request failed with status code 403」', async () => {
    seedApp();
    const client = {
      contact: {
        v3: {
          department: { children: vi.fn(async () => { throw scopeError(); }) },
          user: { findByDepartment: vi.fn() },
        },
      },
      im: {
        v1: {
          chat: { list: vi.fn(async () => { throw scopeError(); }) },
          chatMembers: { get: vi.fn() },
        },
      },
    } as unknown as Client;

    // 两条路都缺权限 —— 这才算真失败。
    await expect(syncDirectory(client, APP)).rejects.not.toThrow(/status code 403/);
    expect(syncRow().dir_sync_error).toContain('contact:user.base:readonly');
  });
});
