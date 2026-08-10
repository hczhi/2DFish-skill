import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, getDatabase } from '../db/index.js';
import {
  normalizeSkillPath,
  upsertBot, upsertBotVariable, listBotVariables,
  createSkill, updateSkill, getSkillByName, copySkill,
  putSkillFile, listSkillFiles,
  validateSkill, freezeVersion, exportVersion, getVersion,
  recordExport, confirmDeployment, listDeployments,
  importFromDirectory, importSkillTree, detectSkillDirs,
} from './agentSkillService.js';

initDatabase();

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskill-'));
  tmpDirs.push(d);
  return d;
}

/** 一个能通过校验的最小技能。 */
function goodSkillMd(name: string): string {
  return `---
name: ${name}
label: 测试
description: 用于测试的技能
---

# 测试

\`\`\`bash
cd ~/.aily/workspace/skills/${name}
python3 scripts/run.py
\`\`\`
`;
}

function mkSkill(name: string) {
  const skill = createSkill({ name });
  putSkillFile({ skill_id: skill.id, path: 'SKILL.md', body: goodSkillMd(name) });
  putSkillFile({ skill_id: skill.id, path: 'scripts/run.py', body: 'print(1)\n' });
  return skill;
}

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM agent_skills').run();
  db.prepare('DELETE FROM agent_bots').run();
});

describe('文件路径校验', () => {
  it('挡住 .. 和绝对路径', () => {
    // 导出时这些 path 会被拼到一个目录下写盘，`../` 能写到目录外面去。
    // 「只有管理员能操作」不等于可以不校验：导入的目录是外部内容。
    expect(() => normalizeSkillPath('../../etc/passwd')).toThrow(/\.\./);
    expect(() => normalizeSkillPath('/etc/passwd')).toThrow(/绝对路径/);
    expect(() => normalizeSkillPath('a/../../b')).toThrow(/\.\./);
  });

  it('归一多余的斜杠和 ./', () => {
    expect(normalizeSkillPath('./scripts//run.py')).toBe('scripts/run.py');
    expect(normalizeSkillPath('scripts\\run.py')).toBe('scripts/run.py');
  });
});

describe('三处名字一致性校验', () => {
  it('frontmatter 的 name 和技能名不一致时报 error', () => {
    // 这是最容易踩也最难查的坑：技能能上传、能被触发，
    // 但 cd 进的是不存在的目录，用户看到的是「机器人说找不到脚本」。
    const skill = createSkill({ name: 'alpha' });
    putSkillFile({ skill_id: skill.id, path: 'SKILL.md', body: goodSkillMd('beta') });
    const issues = validateSkill(skill.id);
    expect(issues.some((i) => i.level === 'error' && /name「beta」/.test(i.message))).toBe(true);
  });

  it('正文里的 cd 路径不一致时报 error', () => {
    const skill = createSkill({ name: 'alpha' });
    putSkillFile({
      skill_id: skill.id,
      path: 'SKILL.md',
      body: `---
name: alpha
description: d
---
\`\`\`bash
cd ~/.aily/workspace/skills/wrong-name
\`\`\`
`,
    });
    const issues = validateSkill(skill.id);
    expect(issues.some((i) => i.level === 'error' && /cd 路径指向「wrong-name」/.test(i.message))).toBe(true);
  });

  it('三处一致时没有 error', () => {
    const skill = mkSkill('good-skill');
    expect(validateSkill(skill.id).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('校验：正文引用的文件必须存在', () => {
  it('正文调了一个不存在的脚本 → error', () => {
    const skill = createSkill({ name: 'alpha' });
    putSkillFile({ skill_id: skill.id, path: 'SKILL.md', body: goodSkillMd('alpha') });
    // 没有建 scripts/run.py
    const issues = validateSkill(skill.id);
    expect(issues.some((i) => i.level === 'error' && /scripts\/run\.py/.test(i.message))).toBe(true);
  });

  it('缺 SKILL.md 直接 error 并停止', () => {
    const skill = createSkill({ name: 'alpha', });
    getDatabase().prepare('DELETE FROM agent_skill_files WHERE skill_id = ?').run(skill.id);
    const issues = validateSkill(skill.id);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/SKILL\.md/);
  });
});

describe('校验：明文密钥不许进导出包', () => {
  it('mmPla_ 明文 → error，冻结被拒', () => {
    // 复制技能给 B 企业时会把 A 的密钥一起复制过去，所以这条是 error 不是 warning。
    const skill = mkSkill('leaky');
    putSkillFile({
      skill_id: skill.id,
      path: 'scripts/call.py',
      body: 'TOKEN = "mmPla_0123456789abcdef"\n',
    });
    const issues = validateSkill(skill.id);
    expect(issues.some((i) => i.level === 'error' && /平台密钥明文/.test(i.message))).toBe(true);
    expect(() => freezeVersion(skill.id)).toThrow(/校验未通过/);
  });

  it('占位符只是 warning，不阻止冻结', () => {
    const skill = mkSkill('placeheld');
    putSkillFile({
      skill_id: skill.id,
      path: 'scripts/call.py',
      body: 'TOKEN = "{{SERVER_API_TOKEN}}"\n',
    });
    const issues = validateSkill(skill.id);
    expect(issues.some((i) => i.level === 'warning' && /SERVER_API_TOKEN/.test(i.message))).toBe(true);
    expect(() => freezeVersion(skill.id)).not.toThrow();
  });
});

describe('版本：全量快照', () => {
  it('冻结后改内容，老版本不受影响', () => {
    // 快照是全量而不是增量：增量回滚要顺着链子重放，
    // 中间少一环就静默算出一棵错的树，而导出的包看不出哪里不对。
    const skill = mkSkill('snap');
    const { version } = freezeVersion(skill.id, { note: 'v1' });
    putSkillFile({ skill_id: skill.id, path: 'scripts/run.py', body: 'print(999)\n' });

    const snap = JSON.parse(getVersion(skill.id, version)!.manifest_json);
    const runPy = snap.files.find((f: any) => f.path === 'scripts/run.py');
    expect(runPy.body).toBe('print(1)\n');
    // 当前编辑态确实变了
    expect(listSkillFiles(skill.id).find((f) => f.path === 'scripts/run.py')!.body).toBe('print(999)\n');
  });

  it('版本号递增', () => {
    const skill = mkSkill('bump');
    expect(freezeVersion(skill.id).version).toBe(1);
    expect(freezeVersion(skill.id).version).toBe(2);
  });
});

describe('导出：变量注入', () => {
  it('按账号注入变量，没配的占位符原样留下并报告', () => {
    // 原样留着而不是替成空串：空串会让脚本拿空 token 去调用，
    // 报出来的是 401，查半天才发现是变量没配。
    const bot = upsertBot({ name: 'A 企业' });
    upsertBotVariable({ bot_id: bot.id, key: 'SERVER_API_BASE', value: 'https://a.example.com' });

    const skill = mkSkill('inject');
    putSkillFile({
      skill_id: skill.id,
      path: 'scripts/call.py',
      body: 'BASE = "{{SERVER_API_BASE}}"\nTOKEN = "{{SERVER_API_TOKEN}}"\n',
    });
    const { version } = freezeVersion(skill.id);
    const out = exportVersion(skill.id, version, bot.id);

    const call = out.files.find((f) => f.path === 'scripts/call.py')!;
    expect(call.body).toContain('https://a.example.com');
    expect(call.body).toContain('{{SERVER_API_TOKEN}}');
    expect(out.injected).toContain('SERVER_API_BASE');
    expect(out.unresolved).toEqual(['SERVER_API_TOKEN']);
  });

  it('不同账号注入各自的值，不会串台', () => {
    // 这是多租户的核心：A 的密钥绝不能出现在给 B 的包里。
    const a = upsertBot({ name: 'A' });
    const b = upsertBot({ name: 'B' });
    upsertBotVariable({ bot_id: a.id, key: 'TOKEN', value: 'token-a', is_secret: true });
    upsertBotVariable({ bot_id: b.id, key: 'TOKEN', value: 'token-b', is_secret: true });

    const skill = mkSkill('multi');
    putSkillFile({ skill_id: skill.id, path: 'scripts/t.py', body: 'T="{{TOKEN}}"' });
    const { version } = freezeVersion(skill.id);

    const outA = exportVersion(skill.id, version, a.id);
    const outB = exportVersion(skill.id, version, b.id);
    expect(outA.files.find((f) => f.path === 'scripts/t.py')!.body).toBe('T="token-a"');
    expect(outB.files.find((f) => f.path === 'scripts/t.py')!.body).toBe('T="token-b"');
    expect(outB.files.find((f) => f.path === 'scripts/t.py')!.body).not.toContain('token-a');
  });

  it('secret 变量在列表里是脱敏的', () => {
    const bot = upsertBot({ name: 'S' });
    upsertBotVariable({ bot_id: bot.id, key: 'TOKEN', value: 'mmPla_supersecretvalue123', is_secret: true });
    const listed = listBotVariables(bot.id);
    expect(listed[0].value).not.toBe('mmPla_supersecretvalue123');
    // 但导出时能拿到真值
    expect(listBotVariables(bot.id, true)[0].value).toBe('mmPla_supersecretvalue123');
  });

  it('提交空 value 表示不修改，不会把真值清空', () => {
    // 后台表单回显的是脱敏串，原样提交回来不该覆盖真值。
    const bot = upsertBot({ name: 'K' });
    upsertBotVariable({ bot_id: bot.id, key: 'TOKEN', value: 'real-value', is_secret: true });
    upsertBotVariable({ bot_id: bot.id, key: 'TOKEN', value: '' });
    expect(listBotVariables(bot.id, true)[0].value).toBe('real-value');
  });
});

describe('部署状态', () => {
  it('导出只到 exported，上线要人工确认', () => {
    // 飞书没有技能写入 API，所以我们无法知道用户真的上传了没有。
    // 把 exported 当成 live 就等于替用户宣布上线，而 zip 可能还在下载文件夹里。
    const bot = upsertBot({ name: 'A' });
    const skill = mkSkill('dep');
    const { version } = freezeVersion(skill.id);
    const dep = recordExport(skill.id, bot.id, version);
    expect(dep.status).toBe('exported');
    expect(dep.confirmed_at).toBeNull();

    const live = confirmDeployment(dep.id);
    expect(live.status).toBe('live');
    expect(live.confirmed_at).toBeTruthy();
  });

  it('确认新版本时把同账号的旧 live 降级', () => {
    // 不降级的话界面上会同时显示三个版本都在线上。
    const bot = upsertBot({ name: 'A' });
    const skill = mkSkill('dep2');
    const v1 = freezeVersion(skill.id).version;
    confirmDeployment(recordExport(skill.id, bot.id, v1).id);
    putSkillFile({ skill_id: skill.id, path: 'scripts/run.py', body: 'print(2)\n' });
    const v2 = freezeVersion(skill.id).version;
    confirmDeployment(recordExport(skill.id, bot.id, v2).id);

    const deps = listDeployments(skill.id);
    expect(deps.filter((d) => d.status === 'live')).toHaveLength(1);
    expect(deps.find((d) => d.status === 'live')!.version).toBe(v2);
  });

  it('改动技能内容把已上线的部署标成 stale', () => {
    // 线上跑的还是老版本，而界面显示「已上线」—— 那句话就是假的。
    const bot = upsertBot({ name: 'A' });
    const skill = mkSkill('stale');
    const { version } = freezeVersion(skill.id);
    confirmDeployment(recordExport(skill.id, bot.id, version).id);

    putSkillFile({ skill_id: skill.id, path: 'scripts/run.py', body: 'print(3)\n' });
    expect(listDeployments(skill.id)[0].status).toBe('stale');
  });

  it('改技能名也标 stale', () => {
    const bot = upsertBot({ name: 'A' });
    const skill = mkSkill('renameme');
    const { version } = freezeVersion(skill.id);
    confirmDeployment(recordExport(skill.id, bot.id, version).id);
    updateSkill(skill.id, { name: 'renamed' });
    expect(listDeployments(skill.id)[0].status).toBe('stale');
  });

  it('重新导出一个已确认上线的版本不会把状态退回 exported', () => {
    // 线上确实还在跑这个版本，退回去会显示成「没上线」。
    const bot = upsertBot({ name: 'A' });
    const skill = mkSkill('reexport');
    const { version } = freezeVersion(skill.id);
    const dep = confirmDeployment(recordExport(skill.id, bot.id, version).id);
    expect(dep.status).toBe('live');
    expect(recordExport(skill.id, bot.id, version).status).toBe('live');
  });
});

describe('从本地目录导入', () => {
  it('递归导入文本文件，跳过的东西如实报告', () => {
    // 静默少一个脚本的技能上传后能被触发但会报「找不到文件」，
    // 那时候很难想到是导入时漏了。
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'SKILL.md'), goodSkillMd('imported'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'run.py'), 'print(1)\n');
    fs.mkdirSync(path.join(dir, 'references'));
    fs.writeFileSync(path.join(dir, 'references', 'a.md'), '# a\n');
    fs.mkdirSync(path.join(dir, '__pycache__'));
    fs.writeFileSync(path.join(dir, '__pycache__', 'x.pyc'), 'junk');
    fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = importFromDirectory(dir, { name: 'imported' });
    expect(result.files.sort()).toEqual(['SKILL.md', 'references/a.md', 'scripts/run.py']);
    expect(result.skipped.map((s) => s.path)).toContain('__pycache__');
    expect(result.skipped.map((s) => s.path)).toContain('logo.png');
    // .py 自动带可执行位
    expect(listSkillFiles(result.skill.id).find((f) => f.path === 'scripts/run.py')!.executable).toBe(1);
  });

  it('扩展名是文本但内容是二进制的文件被跳过', () => {
    // .json/.txt 这种扩展名挡不住二进制内容（比如误存的 pickle）。
    // 存进 TEXT 列会在导出时变成一串替换字符，而技能看起来是完整的。
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'SKILL.md'), goodSkillMd('nulbyte'));
    fs.writeFileSync(path.join(dir, 'scripts.py'), Buffer.from([0x70, 0x00, 0x71]));
    const result = importFromDirectory(dir, { name: 'nulbyte' });
    expect(result.files).not.toContain('scripts.py');
    expect(result.skipped.find((s) => s.path === 'scripts.py')?.reason).toMatch(/二进制/);
  });

  it('没有 SKILL.md 的目录直接拒绝', () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'hi');
    expect(() => importFromDirectory(dir)).toThrow(/SKILL\.md/);
  });

  it('目录不存在时报清楚的错', () => {
    expect(() => importFromDirectory('/nonexistent/path/xyz')).toThrow(/目录不存在/);
  });

  it('技能名重复时拒绝，不悄悄合并', () => {
    // 合并会把两个技能的文件混在一起，跑出来的行为是第三种东西。
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'SKILL.md'), goodSkillMd('dup-skill'));
    importFromDirectory(dir, { name: 'dup-skill' });
    expect(() => importFromDirectory(dir, { name: 'dup-skill' })).toThrow(/已存在/);
  });

  it('优先用 frontmatter 里的 name 而不是目录名', () => {
    // frontmatter 才是 aily 实际认的名字。
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'SKILL.md'), goodSkillMd('real-name'));
    const result = importFromDirectory(dir);
    expect(result.skill.name).toBe('real-name');
  });

  it('导入后同时抓到 label / description', () => {
    const dir = mkTmp();
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: meta-skill\nlabel: 元\ndescription: 说明文字\n---\n# x\n`
    );
    const result = importFromDirectory(dir);
    expect(result.skill.label).toBe('元');
    expect(result.skill.description).toBe('说明文字');
  });
});

describe('导入一个套件（目录里有多个 SKILL.md）', () => {
  /** 造一棵 director-diary-skills 那样的树：根一个总入口 + 两个子技能。 */
  function mkSuite() {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'SKILL.md'), goodSkillMd('suite-root'));
    fs.writeFileSync(path.join(dir, 'shared.py'), 'X = 1\n');
    for (const sub of ['sub-one', 'sub-two']) {
      fs.mkdirSync(path.join(dir, sub, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(dir, sub, 'SKILL.md'), goodSkillMd(sub));
      fs.writeFileSync(path.join(dir, sub, 'scripts', 'run.py'), 'print(1)\n');
    }
    return dir;
  }

  it('认出树里所有的技能目录', () => {
    const dirs = detectSkillDirs(mkSuite());
    expect(dirs.map((d) => d.rel).sort()).toEqual(['', 'sub-one', 'sub-two']);
  });

  it('每个 SKILL.md 一条技能记录，子技能不被塞进父技能', () => {
    // 当成一个技能导的话，子技能的 SKILL.md 变成普通文件躺在包里：
    // aily 不会加载它们，也不报错，界面上还显示「导入成功」。
    const result = importSkillTree(mkSuite());
    expect(result.imported.map((r) => r.skill.name).sort()).toEqual([
      'sub-one', 'sub-two', 'suite-root',
    ]);
    expect(result.failed).toEqual([]);

    const root = result.imported.find((r) => r.skill.name === 'suite-root')!;
    expect(root.files).toContain('shared.py');
    expect(root.files).not.toContain('sub-one/SKILL.md');
    // 而且要说出来「这里有个子技能，我没导进这个包」
    expect(root.skipped.find((s) => s.path === 'sub-one')?.reason).toMatch(/独立的子技能/);

    // 子技能自己的路径是相对它自己的根，不带父目录前缀 ——
    // 带了的话 cd 进去找 scripts/run.py 会找不到。
    const sub = result.imported.find((r) => r.skill.name === 'sub-one')!;
    expect(sub.files.sort()).toEqual(['SKILL.md', 'scripts/run.py']);
    expect(validateSkill(sub.skill.id).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('一个子技能重名，其余照样导进来，并且说清哪个没进来', () => {
    // 整棵树一起回滚的话，用户得先去删掉旧的才能重来。
    // 代价是部分成功 —— 那就必须逐个报，只说「导入了 2 个」等于没说。
    const dir = mkSuite();
    createSkill({ name: 'sub-two' });
    const result = importSkillTree(dir);
    expect(result.imported.map((r) => r.skill.name).sort()).toEqual(['sub-one', 'suite-root']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe('sub-two');
    expect(result.failed[0].reason).toMatch(/已存在/);
  });

  it('整棵树都没有 SKILL.md 时报清楚的错', () => {
    const dir = mkTmp();
    fs.mkdirSync(path.join(dir, 'a'));
    fs.writeFileSync(path.join(dir, 'a', 'note.txt'), 'hi');
    expect(() => importSkillTree(dir)).toThrow(/SKILL\.md/);
  });
});

describe('复制技能（多企业分发的起点）', () => {
  it('复制时把三处名字一起改掉，复制出来就能通过校验', () => {
    // 不改的话一冻结就报「三处名字不一致」，而用户不知道该改哪。
    const src = mkSkill('origin-skill');
    const copy = copySkill(src.id, 'copied-skill');
    const md = listSkillFiles(copy.id).find((f) => f.path === 'SKILL.md')!.body;
    expect(md).toMatch(/^name: copied-skill$/m);
    expect(md).toContain('cd ~/.aily/workspace/skills/copied-skill');
    expect(md).not.toContain('origin-skill');
    expect(validateSkill(copy.id).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('记下血缘，为以后做差异合并留线索', () => {
    const src = mkSkill('lineage-src');
    freezeVersion(src.id);
    const copy = copySkill(src.id, 'lineage-copy');
    expect(copy.origin_skill_id).toBe(src.id);
    expect(copy.origin_version).toBe(1);
  });
});

describe('SKILL.md 的 frontmatter 同步到技能行', () => {
  it('保存 SKILL.md 时同步 label / description', () => {
    const skill = createSkill({ name: 'sync-meta' });
    putSkillFile({
      skill_id: skill.id,
      path: 'SKILL.md',
      body: `---\nname: sync-meta\nlabel: 新标签\ndescription: 新说明\n---\n# x\n`,
    });
    expect(getSkillByName('sync-meta')!.label).toBe('新标签');
    expect(getSkillByName('sync-meta')!.description).toBe('新说明');
  });

  it('frontmatter 坏掉时保存不失败，交给校验去报', () => {
    // 导进来才能在后台里修。保存直接失败的话，一个坏 frontmatter 的技能没法编辑。
    const skill = createSkill({ name: 'bad-fm' });
    expect(() =>
      putSkillFile({ skill_id: skill.id, path: 'SKILL.md', body: '---\nname: [unclosed\n---\nx' })
    ).not.toThrow();
    expect(validateSkill(skill.id).some((i) => i.level === 'error')).toBe(true);
  });
});
