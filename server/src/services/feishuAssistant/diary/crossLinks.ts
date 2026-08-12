import type { Client } from '@larksuiteoapi/node-sdk';
import { assertOk, describeFeishuError } from '../feishuError.js';
import * as store from './store.js';
import type { DiaryProjectRow } from './store.js';
import {
  backfillIndexTaskLinks,
  ensureIndexTaskColumn,
  taskBaseUrl,
  type Warning,
} from './bitable.js';

// 三张表之间的互跳（074）。
//
// 一个项目现在有两个 base：项目日记（记录 + 复盘，对群**只读**）和任务管理
// （对群**可编辑**）。分开是被权限粒度逼的（见 070/taskBase.ts 的文件头），
// 代价是它们之间没有任何入口 —— 两个 base 都不在任何人的云文档空间里
// （建表时没传 folder_token，表归机器人身份所有），链接分享也是关掉的。
// 所以群消息一被刷走，用户手上有哪张表就只剩哪张，另一张只能 @ 助理问回来。
//
// 补的办法是各建一张一行的「🔗 相关链接」表：日记 base 指向任务表，任务 base
// 指向日志表，项目总表多一列指向任务表。多维表格没有「在文档里插一句话」这种
// 能力（appTable 只有表），所以入口只能是一张表 —— 它会出现在 tab 栏上，
// 而 tab 栏正是用户找东西的地方。
//
// 全部失败都只降级成 warning：这只是导航，不是数据。

/** tab 栏上看到的名字。带个图标是为了在几张数据表之间一眼能认出它不是数据。 */
const LINK_TABLE_NAME = '🔗 相关链接';

const F_TEXT = 1;
const F_URL = 15;

/** 第一列必须能当索引列（文本可以，超链接也可以，人员不行）。 */
const LINK_FIELDS = [
  { field_name: '名称', type: F_TEXT },
  { field_name: '链接', type: F_URL },
  { field_name: '说明', type: F_TEXT },
];

/**
 * 建一张「相关链接」表，并写进那一行。
 *
 * **表建出来了但行没写进去**也要把 table_id 存下来（调用方负责），否则下次派活
 * 又建一张同名表 —— 一个 base 里两张「🔗 相关链接」，而每次都成功。
 * 所以这里返回 tableId 和 warning 两样东西，两者可以同时非空。
 */
async function createLinkTable(
  client: Client,
  appToken: string,
  row: { name: string; url: string; note: string },
): Promise<{ tableId: string; warning: Warning }> {
  const created = assertOk(
    await client.bitable.appTable.create({
      path: { app_token: appToken },
      data: {
        table: { name: LINK_TABLE_NAME, default_view_name: '链接', fields: LINK_FIELDS },
      },
    }),
    '建「相关链接」表',
  );
  const tableId = created.data?.table_id ?? '';
  if (!tableId) return { tableId: '', warning: null };

  try {
    assertOk(
      await client.bitable.appTableRecord.create({
        path: { app_token: appToken, table_id: tableId },
        data: {
          fields: {
            名称: row.name,
            // 超链接列收的是 {text, link}；给个纯字符串会被当文本存进去，
            // 不报错，只是那一格点不动 —— 而这张表的全部用处就是「能点」。
            链接: { text: row.name, link: row.url },
            说明: row.note,
          },
        },
      }),
      '写「相关链接」那一行',
    );
  } catch (e) {
    return {
      tableId,
      warning: `「${LINK_TABLE_NAME}」表建好了但那一行没写进去（${describeFeishuError(e)}）。`,
    };
  }
  return { tableId, warning: null };
}

/**
 * 给这个项目的两个 base 各补一张「相关链接」表（有了就不动）。
 *
 * 幂等靠库里那两列 id，**不靠去飞书列一遍表名**：用户手动删掉这张表之后，
 * 看现状的写法会一直重建，他删一次我们加一次，而每次都成功。
 *
 * 任务 base 还没建出来（老项目、或者建的时候失败过）时只补日记那侧能补的部分 ——
 * 少一个链接不该拦住派活。
 */
export async function ensureLinkTables(
  client: Client,
  project: DiaryProjectRow,
): Promise<{ project: DiaryProjectRow; warning: Warning }> {
  const warnings: string[] = [];
  let current = project;

  const taskUrl = taskBaseUrl(current);
  if (current.base_app_token && !current.link_table_id && taskUrl) {
    try {
      const made = await createLinkTable(client, current.base_app_token, {
        name: '任务管理表',
        url: taskUrl,
        note: '本项目的任务 / 甘特图都在那张表里，进展直接在表里改（本群可编辑）。',
      });
      if (made.tableId) store.setLinkTable(current.id, 'diary', made.tableId);
      if (made.warning) warnings.push(made.warning);
    } catch (e) {
      warnings.push(
        `日志表里没能加上任务表的入口（${describeFeishuError(e)}），下次派活时会再试。`,
      );
    }
    current = store.getProjectById(current.id)!;
  }

  if (current.task_base_app_token && !current.task_link_table_id && current.url) {
    try {
      const made = await createLinkTable(client, current.task_base_app_token, {
        name: '项目日志表',
        url: current.url,
        note: '本项目的日志和复盘都在那张表里（本群只读，要记事在群里 @ 我）。',
      });
      if (made.tableId) store.setLinkTable(current.id, 'task', made.tableId);
      if (made.warning) warnings.push(made.warning);
    } catch (e) {
      warnings.push(
        `任务表里没能加上日志表的入口（${describeFeishuError(e)}），下次派活时会再试。`,
      );
    }
    current = store.getProjectById(current.id)!;
  }

  return { project: current, warning: warnings.length ? warnings.join('\n') : null };
}

/**
 * 项目总表那一列「任务表」：老总表补列 + 老行补链接（074）。
 *
 * 两步分开置位：列建成了但补链接失败时，只该重试后面那一步。
 * 补链接**只补库里认得的那些行**（有 index_record_id 和任务 base 的项目），
 * 别的行留空 —— 我们不知道它们对应哪个项目，猜一个填进去比空着糟得多。
 */
export async function ensureIndexTaskEntry(client: Client, appId: string): Promise<Warning> {
  const warnings: string[] = [];
  const added = await ensureIndexTaskColumn(client, appId);
  if (added) warnings.push(added);

  const links = store
    .listProjects(appId)
    .filter((p) => p.index_record_id && taskBaseUrl(p))
    .map((p) => ({ recordId: p.index_record_id as string, name: p.name, url: taskBaseUrl(p) }));
  const filled = await backfillIndexTaskLinks(client, appId, links);
  if (filled) warnings.push(filled);

  return warnings.length ? warnings.join('\n') : null;
}
