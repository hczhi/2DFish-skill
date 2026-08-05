import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { deleteChats, listChats, recordBotAdded, recordRejected } from './chatStore.js';

// 这张表存在的全部理由是 chat_id 在飞书客户端里看不到 —— 没有它，配白名单
// 只能"先不设防跑一遍、再去日志里抄那串 id"，而绝大多数人不会回来抄。
//
// 所以这里守的都是"抄不到 / 抄错"的那几种失败：名字被空串盖掉、
// 两个入口互相覆盖对方的信息、解绑后残留上一个租户的群。

beforeAll(() => { initDatabase(); });

beforeEach(() => {
  getDatabase().prepare('DELETE FROM feishu_chats').run();
});

describe('recordBotAdded', () => {
  it('第一次记下群名和拉人的人', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群', addedBy: 'ou_boss' });
    const [row] = listChats('cli_a');
    expect(row.name).toBe('产品群');
    expect(row.source).toBe('bot_added');
    expect(row.added_by).toBe('ou_boss');
    expect(row.reject_count).toBe(0);
  });

  it('再次被拉进同一个群时不重复建行', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群' });
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群' });
    expect(listChats('cli_a')).toHaveLength(1);
  });

  it('这次拿不到群名时保留上次查到的 —— 空串盖掉就又只剩一串 id 了', () => {
    // getChatInfo 要 im:chat:readonly，而它不在必需权限里，所以"这次查不到"很常见。
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群' });
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1' });
    expect(listChats('cli_a')[0].name).toBe('产品群');
  });

  it('之前只是被拦过的群，被正式拉进来后来源升级为 bot_added', () => {
    recordRejected({ appId: 'cli_a', chatId: 'oc_1' });
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群' });
    const [row] = listChats('cli_a');
    expect(row.source).toBe('bot_added');
    expect(row.name).toBe('产品群');
    // 拦过几次这件事不该被抹掉：用户正是因为"@ 了没反应"才来看这个页面。
    expect(row.reject_count).toBe(1);
  });
});

describe('recordRejected', () => {
  it('累加计数，而不是每次一行', () => {
    recordRejected({ appId: 'cli_a', chatId: 'oc_x' });
    recordRejected({ appId: 'cli_a', chatId: 'oc_x' });
    recordRejected({ appId: 'cli_a', chatId: 'oc_x' });
    const [row] = listChats('cli_a');
    expect(row.reject_count).toBe(3);
    expect(row.last_rejected_at).toBeTruthy();
  });

  it('已经记过群名的群被拦时不清掉名字', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群' });
    recordRejected({ appId: 'cli_a', chatId: 'oc_1' });
    expect(listChats('cli_a')[0].name).toBe('产品群');
  });
});

describe('listChats', () => {
  it('被拦过的群排在最前面（用户来这个页面就是为了找它）', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_normal', name: '正常群' });
    recordRejected({ appId: 'cli_a', chatId: 'oc_blocked' });
    expect(listChats('cli_a').map((c) => c.chat_id)).toEqual(['oc_blocked', 'oc_normal']);
  });

  it('只返回本应用的会话（一个应用 = 一个飞书租户）', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_a', name: 'A公司的群' });
    recordBotAdded({ appId: 'cli_b', chatId: 'oc_b', name: 'B公司的群' });
    expect(listChats('cli_a').map((c) => c.name)).toEqual(['A公司的群']);
  });

  it('同一个 chat_id 在两个应用下互不干扰（主键是 app_id + chat_id）', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_same', name: '甲' });
    recordBotAdded({ appId: 'cli_b', chatId: 'oc_same', name: '乙' });
    expect(listChats('cli_a')[0].name).toBe('甲');
    expect(listChats('cli_b')[0].name).toBe('乙');
  });
});

describe('deleteChats', () => {
  it('解绑后不留残行 —— 否则重新绑定看到的是上一次的群（机器人可能早被踢了）', () => {
    recordBotAdded({ appId: 'cli_a', chatId: 'oc_1', name: '产品群' });
    recordBotAdded({ appId: 'cli_b', chatId: 'oc_2', name: '别人的群' });
    deleteChats('cli_a');
    expect(listChats('cli_a')).toEqual([]);
    expect(listChats('cli_b')).toHaveLength(1);
  });
});
