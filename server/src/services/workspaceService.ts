import fs from 'fs';
import path from 'path';

const WORKSPACES_ROOT = path.resolve(process.cwd(), '../workspaces');

const INDEX_TEMPLATE = `# 知识索引

## 核心偏好 (Core Profile)
- 见 [CORE_PROFILE.md](CORE_PROFILE.md)

## 知识库地图 (Knowledge Map)
_尚无知识文件，开始对话后系统会帮你积累。_

## 月度归档 (Archives)
_尚无归档。_
`;

const CORE_PROFILE_TEMPLATE = `# 用户画像

## 基本信息
- 职业：（待填写）
- 领域：（待填写）

## 输出偏好
- 语言：中文
- 风格：专业、简练
- 禁忌：（待填写）

## 备注
_此文件由引导流程生成，可随时编辑。_
`;

const MEMORY_RULES_TEMPLATE = `# 记忆沉淀规则

## 需要记住的信息类型
1. 用户明确表示的偏好
2. 重要的决策和结论
3. 项目进展的关键节点
4. 反复出现的话题或需求
5. 用户纠正 AI 的内容

## 不需要记住的
1. 闲聊、寒暄
2. 一次性的简单查询
3. 用户已明确表示"不用记"的内容

## 输出格式
将有价值的信息以列表形式追加到 INDEX.md 对应分类下。
详细内容写入 monthly/YYYY-MM-summary.md。
`;

export function initWorkspace(): void {
  const workspacePath = path.join(WORKSPACES_ROOT, 'default');

  if (fs.existsSync(path.join(workspacePath, 'INDEX.md'))) {
    return;
  }

  const dirs = ['journal', 'monthly', 'knowledge', 'skills'];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
  }

  fs.writeFileSync(path.join(workspacePath, 'INDEX.md'), INDEX_TEMPLATE, 'utf-8');
  fs.writeFileSync(path.join(workspacePath, 'CORE_PROFILE.md'), CORE_PROFILE_TEMPLATE, 'utf-8');
  fs.writeFileSync(path.join(workspacePath, 'memory_rules.md'), MEMORY_RULES_TEMPLATE, 'utf-8');

  console.log('[mmPla] Workspace "default" initialized.');
}

export function updateCoreProfile(profile: {
  occupation?: string;
  domain?: string;
  language?: string;
  style?: string;
  taboos?: string;
}): void {
  const workspacePath = path.join(WORKSPACES_ROOT, 'default');
  const profilePath = path.join(workspacePath, 'CORE_PROFILE.md');

  const content = `# 用户画像

## 基本信息
- 职业：${profile.occupation || '（待填写）'}
- 领域：${profile.domain || '（待填写）'}

## 输出偏好
- 语言：${profile.language || '中文'}
- 风格：${profile.style || '专业、简练'}
- 禁忌：${profile.taboos || '（无）'}

## 备注
_此文件由引导流程生成，可随时编辑。_
`;

  fs.writeFileSync(profilePath, content, 'utf-8');
}
