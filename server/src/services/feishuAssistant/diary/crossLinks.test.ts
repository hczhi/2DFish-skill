import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../../db/index.js';
import * as store from './store.js';
import { ensureLinkTables, ensureIndexTaskEntry } from './crossLinks.js';

// 三张表之间的互跳入口（074）。全是导航，失败只是 warning ——
// 所以这里守的不是「有没有建出来」，而是**重复建**和**永远重试**这两种
// 「每次都成功、只是越来越怪」的失败。
const APP_ID = 'cli_crosslinks';

beforeAll(() => {
  initDatabase();
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_diary_projects').run();
  db.prepare('DELETE FROM feishu_diary_indexes').run();
});

function seedProject() {
  const p = store.claimProject({
    appId: APP_ID,
    chatId: 'oc_chat',
    name: '甲项目',
    createdBy: 'ou_sender',
    createdByName: '张三',
  });
  store.attachProjectBitable(p.id, {
    baseAppToken: 'bascn_diary',
    recordTableId: 'tbl_log',
    reviewTableId: 'tbl_sum',
    url: 'https://base/diary',
    linkShareClosed: true,
  });
  store.attachTaskBase(p.id, {
    appToken: 'bascn_task',
    tableId: 'tbl_task',
    url: 'https://base/task',
    fieldMap: {},
    boardViewId: 'vew_board',
    personViewId: 'vew_person',
    linkShareClosed: true,
  });
  return store.getProjectById(p.id)!;
}

describe('两个 base 的「相关链接」表', () => {
  it('各建一张，第二次派活一张都不再建', async () => {
    // 幂等靠库里那两列 table_id。看现状（去飞书列一遍表名）的写法在用户手动
    // 删掉这张表之后会无限重建；而不存 id 的写法每次派活都多一张同名表 ——
    // 一个 base 里躺着五张「🔗 相关链接」，每次都建成功、回帖里看不出异常。
    const tableCreate = vi
      .fn()
      .mockImplementation(async () => ({ code: 0, data: { table_id: `tbl_${tableCreate.mock.calls.length}` } }));
    const recordCreate = vi.fn().mockResolvedValue({ code: 0, data: { record: { record_id: 'rec' } } });
    const client = {
      bitable: { appTable: { create: tableCreate }, appTableRecord: { create: recordCreate } },
    } as unknown as Client;

    const first = await ensureLinkTables(client, seedProject());
    expect(first.warning).toBeNull();
    expect(tableCreate.mock.calls.map((c) => c[0].path.app_token)).toEqual([
      'bascn_diary',
      'bascn_task',
    ]);
    // 日记那侧指向任务表，任务那侧指向日志表 —— 反了的话两张表各自指着自己。
    expect(recordCreate.mock.calls[0][0].data.fields['链接']).toEqual({
      text: '任务管理表',
      link: 'https://base/task?view=vew_board',
    });
    expect(recordCreate.mock.calls[1][0].data.fields['链接'].link).toBe('https://base/diary');

    const second = await ensureLinkTables(client, first.project);
    expect(tableCreate).toHaveBeenCalledTimes(2);
    expect(second.warning).toBeNull();
  });

  it('表建出来了但那一行没写进去，id 照样存下来', async () => {
    // 不存的话下次派活又建一张同名表，而这次的 warning 已经被刷走了。
    const tableCreate = vi.fn().mockResolvedValue({ code: 0, data: { table_id: 'tbl_link' } });
    const recordCreate = vi.fn().mockRejectedValue(new Error('写行失败'));
    const client = {
      bitable: { appTable: { create: tableCreate }, appTableRecord: { create: recordCreate } },
    } as unknown as Client;

    const res = await ensureLinkTables(client, seedProject());

    expect(res.project.link_table_id).toBe('tbl_link');
    expect(res.warning).toMatch(/没写进去/);
  });
});

describe('项目总表的「任务表」列', () => {
  function seedIndex() {
    store.saveIndex({
      appId: APP_ID,
      baseAppToken: 'bascn_index',
      tableId: 'tbl_index',
      url: 'https://base/index',
      linkShareClosed: true,
    });
    // 074 之前建的总表：没有这一列，老行也没链接。
    getDatabase()
      .prepare('UPDATE feishu_diary_indexes SET task_col_added = 0, task_col_backfilled = 0 WHERE app_id = ?')
      .run(APP_ID);
  }

  it('列只补一次、老行只回填一次', async () => {
    // 两个都是「重复执行也不报错」的操作：飞书拒同名列（于是每次派活挂一句永远
    // 不会好的 warning），而回填是全表逐行 update（于是每次派活都慢一点，
    // 谁都看不出来）。所以幂等只能靠存下来的那两位。
    seedIndex();
    const project = seedProject();
    store.setProjectIndexRecord(project.id, 'rec_p1');

    const fieldList = vi.fn().mockResolvedValue({ code: 0, data: { items: [] } });
    const fieldCreate = vi.fn().mockResolvedValue({ code: 0, data: { field: { field_id: 'fld' } } });
    const recordUpdate = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const client = {
      bitable: {
        appTableField: { list: fieldList, create: fieldCreate },
        appTableRecord: { update: recordUpdate },
      },
    } as unknown as Client;

    expect(await ensureIndexTaskEntry(client, APP_ID)).toBeNull();
    expect(fieldCreate).toHaveBeenCalledTimes(1);
    expect(recordUpdate.mock.calls[0][0].path.record_id).toBe('rec_p1');
    expect(recordUpdate.mock.calls[0][0].data.fields['任务表'].link).toBe(
      'https://base/task?view=vew_board'
    );

    expect(await ensureIndexTaskEntry(client, APP_ID)).toBeNull();
    expect(fieldCreate).toHaveBeenCalledTimes(1);
    expect(recordUpdate).toHaveBeenCalledTimes(1);
  });

  it('列已经在表里就不再建（飞书拒同名列 = 永远不会好的 warning）', async () => {
    seedIndex();
    const fieldList = vi
      .fn()
      .mockResolvedValue({ code: 0, data: { items: [{ field_id: 'fld', field_name: '任务表' }] } });
    const fieldCreate = vi.fn();
    const client = {
      bitable: {
        appTableField: { list: fieldList, create: fieldCreate },
        appTableRecord: { update: vi.fn() },
      },
    } as unknown as Client;

    expect(await ensureIndexTaskEntry(client, APP_ID)).toBeNull();
    expect(fieldCreate).not.toHaveBeenCalled();
    expect(store.getIndex(APP_ID)!.task_col_added).toBe(1);
  });
});
