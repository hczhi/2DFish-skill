import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Client } from '@larksuiteoapi/node-sdk';
import { initDatabase, getDatabase } from '../../../db/index.js';
import * as store from './store.js';
import { ensureTaskBase, appendTaskRow, importLegacyTasks, COL } from './taskBase.js';

// 任务表的结构是**补建**出来的：迁移里不能调飞书接口，所以后来加的列和视图挂在
// 「下一次派活」上。那段代码因此会被反复执行，而它出错的样子全是「派活成功了」——
// 下面两条守的就是这个。
const APP_ID = 'cli_taskbase';

beforeAll(() => { initDatabase(); });

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_project_tasks').run();
  db.prepare('DELETE FROM feishu_diary_projects').run();
});

/** 一个 070 时代建好的任务 base：有映射，但没有后来加的「飞书任务」列和甘特视图。 */
function seedProject() {
  const p = store.claimProject({
    appId: APP_ID,
    chatId: 'oc_chat',
    name: '甲项目',
    createdBy: 'ou_sender',
    createdByName: '张三',
  });
  const oldMap: Record<string, string> = {};
  for (const col of Object.values(COL)) {
    if (col !== COL.taskUrl) oldMap[col] = `fld_${col}`;
  }
  store.attachTaskBase(p.id, {
    appToken: 'bascn_task',
    tableId: 'tbl_task',
    url: 'https://base/task',
    fieldMap: oldMap,
    boardViewId: 'vew_board',
    personViewId: 'vew_person',
    linkShareClosed: true,
  });
  return store.getProjectById(p.id)!;
}

describe('任务表补建', () => {
  it('补上的列和甘特视图各只建一次 —— 每次派活都建一遍是不会报错的', async () => {
    // 幂等靠的是「新 field_id 存回映射」+「视图 id 存进 task_gantt_view_id」。
    // 少任何一半，用户每派一次活就多一个同名「甘特图」视图（上限 200/base），
    // 而每次派活都成功、回帖里什么异常都看不出来。
    const fieldCreate = vi
      .fn()
      .mockResolvedValue({ code: 0, data: { field: { field_id: 'fld_url' } } });
    const viewCreate = vi
      .fn()
      .mockResolvedValue({ code: 0, data: { view: { view_id: 'vew_gantt' } } });
    const client = {
      bitable: {
        appTableField: { create: fieldCreate },
        appTableView: { create: viewCreate },
      },
    } as unknown as Client;

    const first = await ensureTaskBase(client, seedProject());
    const second = await ensureTaskBase(client, first.project);

    expect(fieldCreate).toHaveBeenCalledTimes(1);
    expect(fieldCreate.mock.calls[0][0].data.field_name).toBe(COL.taskUrl);
    expect(viewCreate).toHaveBeenCalledTimes(1);
    expect(viewCreate.mock.calls[0][0].data.view_type).toBe('gantt');
    // 第二次是彻底的 no-op：连那句「甘特图起止列扫一眼」的提示都不该再出现，
    // 否则每条派活回帖都挂着一句已经做完的事。
    expect(second.warning).toBeNull();
  });
});

/** 一个已经补过列和视图的任务 base，但老行的「飞书任务」还是空的（073 待回填）。 */
function seedUpgraded() {
  const p = seedProject();
  const map: Record<string, string> = {};
  for (const col of Object.values(COL)) map[col] = `fld_${col}`;
  store.attachTaskBase(p.id, {
    appToken: 'bascn_task',
    tableId: 'tbl_task',
    url: 'https://base/task',
    fieldMap: map,
    boardViewId: 'vew_board',
    personViewId: 'vew_person',
    ganttViewId: 'vew_gantt',
    linkShareClosed: true,
  });
  getDatabase()
    .prepare('UPDATE feishu_diary_projects SET task_url_backfilled = 0 WHERE id = ?')
    .run(p.id);
  return store.getProjectById(p.id)!;
}

/** 列名没人改过：field_id → 中文列名。 */
function fieldListMock() {
  return vi.fn().mockResolvedValue({
    code: 0,
    data: {
      items: Object.values(COL).map((col) => ({ field_id: `fld_${col}`, field_name: col })),
    },
  });
}

function seedDbTask(
  projectId: string,
  input: { title: string; messageId: string; url: string; stepIndex?: number }
) {
  store.insertTask({
    appId: APP_ID,
    projectId,
    title: input.title,
    content: '',
    ownerOpenId: 'ou_owner',
    ownerName: '李四',
    startMs: null,
    endMs: null,
    status: 'todo',
    guid: 'g1',
    url: input.url,
    createdBy: 'ou_sender',
    createdByName: '张三',
    messageId: input.messageId,
    stepIndex: input.stepIndex ?? 0,
  });
}

describe('回填老行的飞书任务链接', () => {
  it('只按「助理标记」对齐，标题一样也不算', async () => {
    // 按标题对齐会把链接贴到另一个任务上，而那一格看着完全正常 ——
    // 点进去是别人的活，没有任何地方会报错。
    const project = seedUpgraded();
    seedDbTask(project.id, { title: '写季度报告', messageId: 'om_b', url: 'https://applink/b' });
    const search = vi.fn().mockResolvedValue({
      code: 0,
      // 表里那行是别的消息建的（om_a），只是标题恰好同名。
      data: { items: [{ record_id: 'rec_a', fields: { [COL.title]: '写季度报告', [COL.idem]: 'om_a#0' } }] },
    });
    const batchUpdate = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const client = {
      bitable: {
        appTableField: { list: fieldListMock() },
        appTableRecord: { search, batchUpdate },
      },
    } as unknown as Client;

    await ensureTaskBase(client, project);

    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('已经有链接的格子不覆盖', async () => {
    // 那一格里的链接只可能是我们后来写的、或者用户自己贴的，两种都比库里那份新。
    // 覆盖不报错，只是把用户的手工修正静默吃掉。
    const project = seedUpgraded();
    seedDbTask(project.id, { title: '甲', messageId: 'om_1', url: 'https://applink/old1' });
    seedDbTask(project.id, { title: '乙', messageId: 'om_2', url: 'https://applink/old2' });
    const search = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        items: [
          { record_id: 'rec_1', fields: { [COL.idem]: 'om_1#0' } },
          {
            record_id: 'rec_2',
            fields: { [COL.idem]: 'om_2#0', [COL.taskUrl]: { text: '打开任务', link: 'https://applink/hand' } },
          },
        ],
      },
    });
    const batchUpdate = vi.fn().mockResolvedValue({ code: 0, data: {} });
    const client = {
      bitable: {
        appTableField: { list: fieldListMock() },
        appTableRecord: { search, batchUpdate },
      },
    } as unknown as Client;

    await ensureTaskBase(client, project);

    expect(batchUpdate.mock.calls[0][0].data.records).toEqual([
      { record_id: 'rec_1', fields: { [COL.taskUrl]: { text: '打开任务', link: 'https://applink/old1' } } },
    ]);
    // 补完置位：不置的话这次全表扫描会挂在**每一条**派活指令上，只是慢，没人看得出来。
    expect(store.getProjectById(project.id)!.task_url_backfilled).toBe(1);
  });
});

describe('搬老任务（074，删老「任务」表之前）', () => {
  it('核对不了表里已有的行就返回 ok:false —— 调用方靠它决定不删老表', async () => {
    // 这个返回值是「老任务会不会凭空消失」的唯一开关：老表一删，那些任务在飞书里
    // 就只剩各人任务中心那一条，而 `list_tasks` 只读任务管理表 ——
    // 从此「还有什么没做完」漏掉它们，一句错都不报。
    const project = seedUpgraded();
    seedDbTask(project.id, { title: '老活', messageId: 'om_old', url: 'https://applink/old' });
    const create = vi.fn();
    const client = {
      bitable: {
        appTableField: { list: fieldListMock() },
        appTableRecord: { search: vi.fn().mockRejectedValue(new Error('搜索超时')), create },
      },
    } as unknown as Client;

    const res = await importLegacyTasks(client, project);

    expect(res.ok).toBe(false);
    // 没查重就不许写：写了的话每次派活都把同一批老任务再写一遍，而每次都成功。
    expect(create).not.toHaveBeenCalled();
  });

  it('表里已经有那条标记就不再搬一遍（这段会被反复执行）', async () => {
    const project = seedUpgraded();
    seedDbTask(project.id, { title: '老活', messageId: 'om_old', url: 'https://applink/old' });
    const create = vi.fn();
    const client = {
      bitable: {
        appTableField: { list: fieldListMock() },
        appTableRecord: {
          search: vi.fn().mockResolvedValue({
            code: 0,
            data: { items: [{ record_id: 'rec_x', fields: { [COL.idem]: 'om_old#0' } }] },
          }),
          create,
        },
      },
    } as unknown as Client;

    const res = await importLegacyTasks(client, project);

    expect(res.ok).toBe(true);
    expect(res.imported).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('写一行任务', () => {
  it('「飞书任务」写成超链接对象，不是字符串', async () => {
    // 给字符串不会报错，飞书会把它当文本存下来 —— 表里那一格看着有内容、点不动，
    // 而这一列是「库里那份任务将来砍掉之后还能不能定位到飞书任务」的唯一依靠。
    const project = seedProject();
    const search = vi.fn().mockResolvedValue({ code: 0, data: { items: [] } });
    const create = vi
      .fn()
      .mockResolvedValue({ code: 0, data: { record: { record_id: 'rec1' } } });
    const client = {
      bitable: { appTableRecord: { search, create } },
    } as unknown as Client;

    // 列名直接用中文常量（= 没人改过列名时 resolveFieldNames 给的那份）。
    const names: Record<string, string> = {};
    for (const col of Object.values(COL)) names[col] = col;

    await appendTaskRow(
      client,
      project,
      {
        title: '写季度报告',
        status: 'todo',
        taskUrl: 'https://applink/task/g1',
        messageId: 'om_1',
        stepIndex: 0,
      },
      names
    );

    expect(create.mock.calls[0][0].data.fields[COL.taskUrl]).toEqual({
      text: '打开任务',
      link: 'https://applink/task/g1',
    });
  });
});
