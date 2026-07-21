import { Router, Request, Response } from 'express';
import { requireAdmin } from '../auth/guards.js';
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  listBindings,
  setBinding,
  listSkillFiles,
  addSkillFile,
  updateSkillFile,
  deleteSkillFile,
  assembleSkillBody,
  KNOWN_SLOTS,
} from '../services/skillRegistryService.js';

// 后台 Skill 管理 API（全 admin 权限）：skill 增删改查 + slot 绑定配置。
export const skillRegistryRouter = Router();
skillRegistryRouter.use(requireAdmin);

// --- Skills ---

skillRegistryRouter.get('/skills', (_req: Request, res: Response) => {
  res.json({ skills: listSkills() });
});

skillRegistryRouter.get('/skills/:id', (req: Request, res: Response) => {
  const skill = getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: 'skill not found' });
  res.json({ skill });
});

skillRegistryRouter.post('/skills', (req: Request, res: Response) => {
  const { key, name, description, body, enabled } = req.body || {};
  if (!key || !name || typeof body !== 'string') {
    return res.status(400).json({ error: 'key, name, body are required' });
  }
  if (!/^[a-z0-9-]+$/.test(key)) {
    return res.status(400).json({ error: 'key 只能包含小写字母、数字和连字符' });
  }
  try {
    const skill = createSkill({ key, name, description, body, enabled });
    res.status(201).json({ skill });
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: `key 已存在: ${key}` });
    }
    res.status(500).json({ error: e?.message || 'create failed' });
  }
});

skillRegistryRouter.put('/skills/:id', (req: Request, res: Response) => {
  const { name, description, body, enabled } = req.body || {};
  const skill = updateSkill(req.params.id, { name, description, body, enabled });
  if (!skill) return res.status(404).json({ error: 'skill not found' });
  res.json({ skill });
});

skillRegistryRouter.delete('/skills/:id', (req: Request, res: Response) => {
  const ok = deleteSkill(req.params.id);
  if (!ok) return res.status(404).json({ error: 'skill not found' });
  res.json({ ok: true });
});

// --- Skill Files（一个 skill 的组成文件：主文件 + 引用文件）---

// 列出某 skill 的所有文件
skillRegistryRouter.get('/skills/:id/files', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: 'skill not found' });
  res.json({ files: listSkillFiles(req.params.id) });
});

// 新增引用文件
skillRegistryRouter.post('/skills/:id/files', (req: Request, res: Response) => {
  const { filename, body } = req.body || {};
  if (!filename || !/^[\w.\-]+$/.test(filename)) {
    return res.status(400).json({ error: 'filename 必填，且只能含字母数字下划线点连字符' });
  }
  const file = addSkillFile({ skillId: req.params.id, filename, body });
  if (!file) return res.status(404).json({ error: 'skill not found' });
  res.status(201).json({ file });
});

// 更新文件内容/文件名（主文件不可改名）
skillRegistryRouter.put('/files/:fileId', (req: Request, res: Response) => {
  const { filename, body } = req.body || {};
  const file = updateSkillFile(req.params.fileId, { filename, body });
  if (!file) return res.status(404).json({ error: 'file not found' });
  res.json({ file });
});

// 删除引用文件（主文件不可删）
skillRegistryRouter.delete('/files/:fileId', (req: Request, res: Response) => {
  const result = deleteSkillFile(req.params.fileId);
  if (!result.ok) return res.status(result.reason === 'not found' ? 404 : 400).json({ error: result.reason });
  res.json({ ok: true });
});

// 预览：把主文件 + 引用文件展开后的最终 prompt 文本（后台调试用）
skillRegistryRouter.get('/skills/:id/preview', (req: Request, res: Response) => {
  if (!getSkill(req.params.id)) return res.status(404).json({ error: 'skill not found' });
  res.json({ assembled: assembleSkillBody(req.params.id) });
});

// --- Bindings (slot -> skill) ---

skillRegistryRouter.get('/bindings', (_req: Request, res: Response) => {
  res.json({ bindings: listBindings(), slots: KNOWN_SLOTS });
});

skillRegistryRouter.put('/bindings/:slot', (req: Request, res: Response) => {
  const { slot } = req.params;
  if (!KNOWN_SLOTS.some((s) => s.slot === slot)) {
    return res.status(400).json({ error: `未知 slot: ${slot}` });
  }
  const skillId = req.body?.skill_id ?? null;
  if (skillId && !getSkill(skillId)) {
    return res.status(400).json({ error: 'skill_id 不存在' });
  }
  setBinding(slot, skillId);
  res.json({ ok: true });
});
