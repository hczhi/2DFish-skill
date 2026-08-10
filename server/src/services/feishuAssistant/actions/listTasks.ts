import { type ActionDef, type ActionContext, str } from './types.js';
import { fmtForHuman } from './time.js';
import { resolvePerson } from './people.js';
import * as store from '../diary/store.js';
import * as taskBase from '../diary/taskBase.js';
import { priorityLabel } from '../diary/taskStatus.js';

/**
 * 「本群还有哪些活在办」/「张三手上有什么」。
 *
 * ── 这个动作是「表格就是数据源」兑现的地方 ──
 * 读的是那张**开放编辑**的任务管理表，不是库里那份（068 的
 * `feishu_project_tasks` 现在只剩 update_task 反查 guid 在用）。所以群成员在表里
 * 手动改的进展、换的负责人、拖的日期，助理下一句话就知道 —— 这正是用户要的
 * 「和飞书状态同步」，而它靠的不是双向写，是**只有一份数据**。
 *
 * ── 三件出错时会伪装成成功的事 ──
 * 1. **读失败绝不能回「没有在办任务」。** 权限掉了、接口挂了、表被删了，
 *    降级成空列表的话回帖是一句语法正常的好消息，而用户会以为活都干完了。
 *    所以 queryTasks 读失败是抛的，这里不 catch。
 * 2. **认不出来的进展算在办**（taskBase.isOpen）。单选列的选项在飞书界面上能
 *    随手加，有人标了「待验收」，归成"不在办"就等于这条活凭空消失。
 *    回帖里照原样显示他写的那几个字。
 * 3. **读满上限要说出来**（truncated）。「只读到前 300 条」和「一共就这些」
 *    在回帖里完全同形。
 */

/** 一屏最多列几条。多了在群里是一堵墙，没人看。 */
const MAX_LINES = 20;

export const listTasksAction: ActionDef = {
  name: 'list_tasks',
  description:
    '看**本群项目**的任务管理表里现在有哪些活：在办的、某个人手上的、或者全部。' +
    '用户说「还有什么没做完」「谁在忙什么」「张三手上有几个活」「任务列表」' +
    '「进度怎么样」这类话时用它。\n' +
    // 和复盘拉开：两个都是"看情况"，但一个看任务表、一个看日志。串了之后用户
    // 拿到的东西是反的 —— 问「还有什么没做完」收到一份基于日志的时间段总结。
    '注意：这是看**任务**（谁负责、什么时候截止、做到哪了）。' +
    '问「这周干了什么」「复盘一下」是 review_diary，那个读的是日志。',
  params: {
    owner:
      '可选。只看某个人手上的活时填**姓名**（如「张三」），不要填 open_id。' +
      '用户说「张三手上有什么」「我还有几个活」时填（说"我"就填说话人自己的名字，' +
      '或者留空由系统处理）。问的是整个项目就留空。',
    include_done:
      '可选，布尔。用户明确说「包括已完成的」「全部任务」「所有的」时填 true。' +
      '默认只看还在办的（未完成的）。',
    mine:
      '可选，布尔。用户说「我的任务」「我手上有什么」时填 true —— ' +
      '这时不要在 owner 里编他的名字，系统知道他是谁。',
  },
  examples: [
    '还有什么没做完',
    '任务列表',
    '张三手上有几个活',
    '我的任务',
    '所有任务都列一下，包括做完的',
    '现在进度怎么样',
  ],
  hint: '看本群项目的任务表：谁在办什么、什么时候截止（「还有什么没做完」「张三手上有几个活」）',
  // 只读表格。任务表在独立 base 里，权限点仍然是 bitable:app。
  scopes: ['bitable:app'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    if (ctx.chatType !== 'group') {
      return { summary: '任务表是跟项目群绑定的，请到项目群里 @ 我问。' };
    }
    const project = store.getProjectByChat(ctx.appId, ctx.chatId);
    if (!project) {
      return {
        summary:
          '这个群还没有对应的项目，所以还没有任务表。\n' +
          '先说一句「新建项目：XXX」我就把项目和两张表建起来。',
      };
    }
    if (!project.task_base_table_id) {
      return {
        summary:
          `**${project.name}** 的任务管理表还没建出来（这个项目是老版本建的）。\n` +
          '派一个任务（「给 @某人 建个任务：……」）我就把表建起来。',
      };
    }

    // 只看某个人的：**姓名解析失败要抛**，不能退化成"看全部"。
    // 退化的后果是他问「张三手上有什么」，拿到一屏所有人的活，而回帖里没有
    // 任何地方说过「我没找到张三」—— 他会以为张三真有这么多活。
    const wantedName = str(params, 'owner');
    const mine = params.mine === true || params.mine === 'true';
    const filterOpenId = wantedName
      ? resolvePerson(wantedName, ctx).openId
      : mine
        ? ctx.senderOpenId
        : '';
    const filterLabel = wantedName || (mine ? (ctx.senderName ?? '你') : '');

    const includeDone = params.include_done === true || params.include_done === 'true';

    // **不 catch**：读不到就是读不到，见文件头第 1 条。
    const { rows, missing, truncated } = await taskBase.queryTasks(ctx.client, project);

    let list = rows.filter((r) => r.title || r.ownerName);
    if (filterOpenId) list = list.filter((r) => r.ownerOpenId === filterOpenId);
    if (!includeDone) list = list.filter((r) => taskBase.isOpen(r));

    // 排序：先按截止时间（快到的在前），没有截止时间的排最后。
    // 「最急的排最前」是这份清单唯一有用的顺序 —— 表里的自然顺序是录入顺序。
    list.sort((a, b) => (a.dueMs ?? Infinity) - (b.dueMs ?? Infinity));

    const url = taskBase.taskBaseUrl(project);
    const who = filterLabel ? `${filterLabel}的` : '';
    const scope = includeDone ? '任务' : '在办任务';

    if (!list.length) {
      // 空和「读不到」必须是两句不同的话。这里能说"没有"是因为上面真的读到了
      // 整张表 —— 读失败会在 queryTasks 里抛出去，走不到这儿。
      const parts = [
        filterOpenId
          ? `**${project.name}** 里没有${who}${scope}。`
          : `**${project.name}** 现在没有${scope}。`,
      ];
      if (!includeDone && rows.length) {
        parts.push(`（表里一共 ${rows.length} 条，都已完成或已取消。）`);
      }
      if (url) parts.push(`[任务管理表](${url})`);
      const miss = taskBase.describeMissingOnRead(missing);
      if (miss) parts.push(miss);
      return { summary: parts.join('\n'), data: { count: 0, total: rows.length } };
    }

    const shown = list.slice(0, MAX_LINES);
    const lines = shown.map((r) => {
      const bits: string[] = [];
      if (r.ownerName) bits.push(r.ownerName);
      // 进展照表里的原文显示（`statusLabelRaw`），不走 statusLabel ——
      // 有人手加了「待验收」，显示成「待开始」就是在替他改答案。
      if (r.statusLabelRaw) bits.push(r.statusLabelRaw);
      if (r.dueMs != null) {
        const late = taskBase.isOpen(r) && r.dueMs < Date.now();
        bits.push(`${late ? '⚠️ 已超期 ' : ''}${fmtForHuman(r.dueMs)}截止`);
      }
      if (r.priority) bits.push(priorityLabel(r.priority));
      const tail = bits.length ? `（${bits.join(' · ')}）` : '';
      const latest = r.latest ? `\n  最新：${r.latest}` : '';
      return `· **${r.title || '（没写标题）'}**${tail}${latest}`;
    });

    const parts = [`**${project.name}** 的${who}${scope}（${list.length} 条）：`, lines.join('\n')];
    // 截断了必须说。省略号不算说明 —— 用户不会知道被省掉的是 3 条还是 300 条。
    if (shown.length < list.length) {
      parts.push(`（只列了前 ${shown.length} 条，还有 ${list.length - shown.length} 条在表里。）`);
    }
    if (truncated) {
      parts.push(
        `⚠️ 这张表的行数太多，我只读了前面一部分 —— 上面的清单**可能不全**，完整的请打开表看。`
      );
    }
    if (url) parts.push(`[任务管理表](${url})`);
    const miss = taskBase.describeMissingOnRead(missing);
    if (miss) parts.push(miss);

    return {
      summary: parts.join('\n'),
      data: { count: list.length, total: rows.length, project: project.name },
    };
  },
};
