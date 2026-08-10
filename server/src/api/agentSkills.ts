import { Router, Request, Response } from 'express';
import { requireAdmin } from '../auth/guards.js';
import {
  listBots, getBot, upsertBot, deleteBot,
  listBotVariables, upsertBotVariable, deleteBotVariable,
  listSkills, getSkill, getSkillByName, createSkill, updateSkill, deleteSkill, copySkill,
  listSkillFiles, putSkillFile, deleteSkillFile,
  validateSkill, freezeVersion, listVersions, getVersion, exportVersion,
  listDeployments, recordExport, confirmDeployment,
  importFromDirectory, importSkillTree, detectSkillDirs, readSkillDirName,
} from '../services/agentSkillService.js';

// 飞书 Skill（aily 智能体技能）后台 API。全 admin 权限。
//
// 这里没有「一键发布到飞书」的接口，因为飞书没有这样的 API（见 migrations/063）。
// 发布的实际链路是：冻结版本 → 导出（注入变量）→ 人工在智能体后台上传
// → 回来 POST /deployments/:id/confirm。前端必须把这个链路写清楚，
// 否则用户点完「导出」就以为已经生效了。
export const agentSkillsRouter = Router();
agentSkillsRouter.use(requireAdmin);

/**
 * 把 service 抛出的错翻成状态码。
 *
 * 状态码来自 SkillError.status，是抛出的地方定的 —— 不在这里按中文措辞反猜。
 * 猜的那版把「目录不存在」判成 404（其实是参数错），
 * 而「变量名只能是大写字母…」一个关键词都没匹配上，成了 500。
 * 没带 status 的错是我们没预料到的，那就该是 500。
 */
function fail(res: Response, e: any, fallback = 500) {
  const msg = String(e?.message || e || 'unknown error');
  const status = typeof e?.status === 'number' ? e.status : fallback;
  return res.status(status).json({ error: msg, issues: e?.issues });
}

// ---------------------------------------------------------------- 账号（企业）

agentSkillsRouter.get('/bots', (_req, res) => {
  res.json({ bots: listBots() });
});

agentSkillsRouter.post('/bots', (req: Request, res: Response) => {
  try {
    res.status(201).json({ bot: upsertBot(req.body || {}) });
  } catch (e) {
    fail(res, e);
  }
});

agentSkillsRouter.put('/bots/:id', (req: Request, res: Response) => {
  if (!getBot(req.params.id)) return res.status(404).json({ error: '账号不存在' });
  try {
    res.json({ bot: upsertBot({ ...(req.body || {}), id: req.params.id }) });
  } catch (e) {
    fail(res, e);
  }
});

agentSkillsRouter.delete('/bots/:id', (req: Request, res: Response) => {
  deleteBot(req.params.id);
  res.json({ ok: true });
});

// 变量：导出时注入。GET 一律脱敏，不提供明文读取接口 ——
// 后台页面没有任何需要看到完整密钥的场景，能读就意味着会被读。
agentSkillsRouter.get('/bots/:id/variables', (req: Request, res: Response) => {
  if (!getBot(req.params.id)) return res.status(404).json({ error: '账号不存在' });
  res.json({ variables: listBotVariables(req.params.id) });
});

agentSkillsRouter.post('/bots/:id/variables', (req: Request, res: Response) => {
  if (!getBot(req.params.id)) return res.status(404).json({ error: '账号不存在' });
  const { key, value, is_secret } = req.body || {};
  try {
    res.status(201).json({
      variable: upsertBotVariable({ bot_id: req.params.id, key, value, is_secret }),
    });
  } catch (e) {
    fail(res, e);
  }
});

agentSkillsRouter.delete('/variables/:varId', (req: Request, res: Response) => {
  deleteBotVariable(req.params.varId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 技能

agentSkillsRouter.get('/skills', (_req, res) => {
  res.json({ skills: listSkills() });
});

agentSkillsRouter.get('/skills/:id', (req: Request, res: Response) => {
  const skill = getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: '技能不存在' });
  res.json({
    skill,
    files: listSkillFiles(req.params.id),
    versions: listVersions(req.params.id),
    deployments: listDeployments(req.params.id),
    issues: validateSkill(req.params.id),
  });
});

agentSkillsRouter.post('/skills', (req: Request, res: Response) => {
  const { name, label, description, enabled, with_template } = req.body || {};
  try {
    const skill = createSkill({ name, label, description, enabled });
    if (with_template !== false) {
      // 新建技能默认带一个能通过校验的 SKILL.md 骨架。
      // 空技能一冻结就报「缺 SKILL.md」，而管理员面对空白编辑器
      // 通常不知道 frontmatter 该写什么 —— 那这个功能就等于不存在。
      putSkillFile({
        skill_id: skill.id,
        path: 'SKILL.md',
        body: templateSkillMd(skill.name, label || skill.name),
      });
      // 骨架正文里 cd 之后调了 scripts/example.py，所以这个文件也得建出来：
      // 只给 SKILL.md 的话，新建完立刻就有一条「正文调了 example.py 但包里没有」
      // 的 error 挡着冻结，而这条 error 是我们自己的模板造的。
      putSkillFile({ skill_id: skill.id, path: 'scripts/example.py', body: templateExamplePy() });
    }
    res.status(201).json({ skill });
  } catch (e) {
    fail(res, e);
  }
});

function templateSkillMd(name: string, label: string): string {
  return `---
name: ${name}
label: ${label}
description: 一句话说明这个技能做什么、什么时候该用它。智能体靠这段话决定要不要调用，写得含糊就不会被触发。
auto_trigger: true
trigger_keywords: []
---

# ${label}

## 什么时候用

## 怎么做

\`\`\`bash
cd ~/.aily/workspace/skills/${name}
python3 scripts/example.py
\`\`\`

## 硬规则

1. 认不出就说认不出，不要猜。
2. 部分成功要逐项说清哪些成了哪些没成。
`;
}

/** 骨架脚本。约定：脚本只输出一段 JSON，智能体读这段 JSON 决定接下来说什么。 */
function templateExamplePy(): string {
  return `#!/usr/bin/env python3
"""这个技能的第一个脚本。改成你要做的事。

约定：
  - 只往 stdout 打一段 JSON，别夹杂别的输出，否则智能体解析不了；
  - 出错时 exit 2，并且在 JSON 里写清楚「哪一步失败了、用户该做什么」；
  - 脚本负责准备数据，创建文档/任务/日程这类动作交给智能体去调工具。
"""
import json
import sys


def main() -> None:
    print(json.dumps({"ok": True, "message": "把这里换成真正的逻辑"}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        # 静默失败最糟：智能体会当成成功，然后跟用户说「已完成」。
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(2)
`;
}

agentSkillsRouter.put('/skills/:id', (req: Request, res: Response) => {
  const { name, label, description, enabled } = req.body || {};
  try {
    res.json({ skill: updateSkill(req.params.id, { name, label, description, enabled }) });
  } catch (e) {
    fail(res, e);
  }
});

agentSkillsRouter.delete('/skills/:id', (req: Request, res: Response) => {
  deleteSkill(req.params.id);
  res.json({ ok: true });
});

agentSkillsRouter.post('/skills/:id/copy', (req: Request, res: Response) => {
  try {
    res.status(201).json({ skill: copySkill(req.params.id, req.body?.name) });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------- 文件

agentSkillsRouter.get('/skills/:id/files', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: '技能不存在' });
  res.json({ files: listSkillFiles(req.params.id) });
});

// 按 path upsert（新建和保存走同一个接口，避免前端要区分两种情况）
agentSkillsRouter.put('/skills/:id/files', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: '技能不存在' });
  const { path: p, body, executable } = req.body || {};
  if (typeof body !== 'string') return res.status(400).json({ error: 'body 必填' });
  try {
    res.json({ file: putSkillFile({ skill_id: req.params.id, path: p, body, executable }) });
  } catch (e) {
    fail(res, e);
  }
});

agentSkillsRouter.delete('/skills/:id/files/:fileId', (req: Request, res: Response) => {
  deleteSkillFile(req.params.id, req.params.fileId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 校验与版本

agentSkillsRouter.get('/skills/:id/validate', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: '技能不存在' });
  const issues = validateSkill(req.params.id);
  res.json({
    issues,
    ok: !issues.some((i) => i.level === 'error'),
  });
});

agentSkillsRouter.post('/skills/:id/versions', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: '技能不存在' });
  try {
    const { version, issues } = freezeVersion(req.params.id, {
      note: req.body?.note,
      createdBy: (req as any).user?.username || '',
    });
    res.status(201).json({ version, issues });
  } catch (e) {
    fail(res, e);
  }
});

agentSkillsRouter.get('/skills/:id/versions', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: '技能不存在' });
  res.json({ versions: listVersions(req.params.id) });
});

agentSkillsRouter.get('/skills/:id/versions/:version', (req: Request, res: Response) => {
  const snap = getVersion(req.params.id, Number(req.params.version));
  if (!snap) return res.status(404).json({ error: '版本不存在' });
  res.json({ version: { ...snap, manifest: JSON.parse(snap.manifest_json) } });
});

// ---------------------------------------------------------------- 导出（= 发布的前半段）

/**
 * 导出某版本的文件树。bot_id 可选：给了就注入该企业的变量。
 *
 * 返回的是文件内容而不是 zip：前端逐文件展示 + 各自下载，
 * 用户也就能在上传前看清到底会传上去什么。unresolved 一定要显示出来 ——
 * 带着未替换的 {{TOKEN}} 上线，脚本会拿一个字面量当密钥去调用。
 */
agentSkillsRouter.post('/skills/:id/export', (req: Request, res: Response) => {
  const skill = getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: '技能不存在' });
  const botId: string | null = req.body?.bot_id || null;
  if (botId && !getBot(botId)) return res.status(400).json({ error: '账号不存在' });
  let version = Number(req.body?.version || 0);
  try {
    if (!version) {
      // 没指定版本时先冻结一个：导出一个「当前编辑中的状态」，
      // 事后没法回答「线上那份到底是哪个内容」。
      version = freezeVersion(req.params.id, {
        note: '导出时自动冻结',
        createdBy: (req as any).user?.username || '',
      }).version;
    }
    const result = exportVersion(req.params.id, version, botId);
    if (botId) recordExport(req.params.id, botId, version);
    res.json({
      ...result,
      // 把「接下来要人工做什么」跟着返回，让前端不必自己拼这段话。
      manual_steps: [
        `把这些文件按原样组成目录 ${result.skill_name}/（路径要一模一样）`,
        '打包成 zip',
        '在飞书智能体（aily）后台 → 技能 → 上传技能包，选这个 zip',
        '上传完回到这里点「确认已上线」，否则这条部署记录会一直停在「已导出」',
      ],
    });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------- 部署记录

agentSkillsRouter.get('/deployments', (req: Request, res: Response) => {
  res.json({ deployments: listDeployments(req.query.skill_id as string | undefined) });
});

agentSkillsRouter.post('/deployments/:id/confirm', (req: Request, res: Response) => {
  try {
    res.json({ deployment: confirmDeployment(req.params.id, req.body?.note) });
  } catch (e) {
    fail(res, e);
  }
});

// ---------------------------------------------------------------- 导入

/**
 * 先看看一个目录里有几个技能，不写库。
 *
 * 前端在真正导入前调这个：一个目录里可能是**一个技能**，也可能是**一个套件**
 * （根目录一个总入口 SKILL.md，下面每个子目录又是独立技能）。
 * 两种情况导法不同，得让用户看到自己要导的是哪种。
 */
agentSkillsRouter.post('/import/inspect', (req: Request, res: Response) => {
  const dir = String(req.body?.dir || '').trim();
  if (!dir) return res.status(400).json({ error: 'dir 必填（服务器上的目录路径）' });
  try {
    const dirs = detectSkillDirs(dir);
    res.json({
      dir,
      skills: dirs.map((d) => ({
        rel: d.rel || '(根目录)',
        name: readSkillDirName(d.abs),
        exists: !!getSkillByName(readSkillDirName(d.abs)),
      })),
    });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * 从服务器本地目录导入。
 *
 * 目录是**服务器上**的路径，不是用户电脑上的 —— 这一点前端要写明，
 * 否则用户会填自己 Mac 上的路径然后得到「目录不存在」。
 *
 * 目录里有多个 SKILL.md 时按**套件**导（每个 SKILL.md 一条技能记录）。
 * 当成一个技能导的话，子技能的 SKILL.md 会变成普通文件躺在包里 ——
 * aily 不会加载它们，也不报错，界面上还显示「导入成功，17 个文件」。
 * 想强行合成一个技能可以传 as_single=true。
 *
 * skipped / failed 必须原样返回给前端并显示：静默少一个脚本的技能上传后
 * 能被触发但会报「找不到文件」，那时候很难想到是导入时漏了。
 */
agentSkillsRouter.post('/import/directory', (req: Request, res: Response) => {
  const dir = String(req.body?.dir || '').trim();
  if (!dir) return res.status(400).json({ error: 'dir 必填（服务器上的目录路径）' });
  try {
    const asSingle = req.body?.as_single === true;
    const count = asSingle ? 1 : detectSkillDirs(dir).length;
    if (count > 1) {
      const tree = importSkillTree(dir);
      return res.status(201).json({
        mode: 'suite',
        skills: tree.imported.map((r) => ({
          skill: r.skill,
          files: r.files,
          skipped: r.skipped,
          issues: validateSkill(r.skill.id),
        })),
        failed: tree.failed,
      });
    }
    const result = importFromDirectory(dir, { name: req.body?.name });
    res.status(201).json({
      mode: 'single',
      ...result,
      issues: validateSkill(result.skill.id),
    });
  } catch (e) {
    fail(res, e);
  }
});
