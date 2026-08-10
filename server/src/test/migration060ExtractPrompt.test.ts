import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { migration_060 } from '../db/migrations/060_tender_extract_prompt_deadline.js';

const MIG_PATH = path.join(process.cwd(), 'src/db/migrations/060_tender_extract_prompt_deadline.ts');
const SVC_PATH = path.join(process.cwd(), 'src/services/tender/aiExtractService.ts');

/** 从迁移文件里取出它自己声明的 OLD_DEFAULT，保证测试用的基线和实现完全一致。 */
function oldDefaultFromSource(): string {
  const m = fs.readFileSync(MIG_PATH, 'utf8').match(/const OLD_DEFAULT = `([\s\S]*?)`;/);
  if (!m) throw new Error('取不到 OLD_DEFAULT');
  return m[1];
}

const OLD_PROMPT = oldDefaultFromSource();

function freshDb(seed?: string) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)`);
  if (seed !== undefined) {
    db.prepare("INSERT INTO system_config VALUES ('tender_extract_prompt', ?)").run(seed);
  }
  return db;
}

const read = (db: Database.Database) =>
  (db.prepare("SELECT value FROM system_config WHERE key = 'tender_extract_prompt'").get() as any)?.value;

describe('migration 060：修 deadline 格式要求', () => {
  it('未被编辑过的旧默认值 → 换成带时分秒的说法，并加上「不要自己推算」', () => {
    const db = freshDb(OLD_PROMPT);
    migration_060.up(db as any);

    const v = read(db);
    expect(v).toContain('YYYY-MM-DD HH:mm:ss');
    expect(v).toContain('deadline 不要自己推算');
    expect(v).not.toContain('"<截标日期 YYYY-MM-DD。未提及则空>"');
    // 其余内容一个字都不能动
    expect(v).toContain('{{items}}');
    expect(v).toContain('budgetAmount 必须是数字（单位：元）');
    expect(v).toContain('"keyDeliverables": ["<交付物1>"]');
  });

  // 这是这个迁移最重要的性质。后台那一页允许用户改整段 prompt，而库里那份
  // 本来就是用户点保存写进去的（没有 migration 播种过）。
  // 最初的实现是「包含旧的 deadline 行就替换」，下面两个用例当时就是红的。
  it('用户改过 prompt 的其它部分时，一个字都不动', () => {
    const edited = OLD_PROMPT.replace('招标信息结构化提取专家', '我们公司专用的提取助手');
    const db = freshDb(edited);
    migration_060.up(db as any);
    expect(read(db)).toBe(edited);
  });

  it('哪怕只多一个空格也不动 —— 差一个字节就说明有人编辑过', () => {
    const edited = OLD_PROMPT.replace('注意：', '注意： ');
    const db = freshDb(edited);
    migration_060.up(db as any);
    expect(read(db)).toBe(edited);
  });

  it('用户自己改过 deadline 那一行时，不覆盖他的写法', () => {
    const edited = OLD_PROMPT.replace(
      '    "deadline": "<截标日期 YYYY-MM-DD。未提及则空>",',
      '    "deadline": "<报名截止，我们只要月日>",'
    );
    const db = freshDb(edited);
    migration_060.up(db as any);
    expect(read(db)).toBe(edited);
  });

  it('重复执行不叠加（迁移幂等）', () => {
    const db = freshDb(OLD_PROMPT);
    migration_060.up(db as any);
    const once = read(db);
    migration_060.up(db as any);
    expect(read(db)).toBe(once);
    expect(once.match(/deadline 不要自己推算/g)).toHaveLength(1);
  });

  it('没存过（库里没这一行）时不报错、不插入 —— 代码默认值已经是新版', () => {
    const db = freshDb();
    expect(() => migration_060.up(db as any)).not.toThrow();
    expect(read(db)).toBeUndefined();
  });

  it('空字符串也当没存过处理', () => {
    const db = freshDb('');
    expect(() => migration_060.up(db as any)).not.toThrow();
    expect(read(db)).toBe('');
  });
});

// 迁移里的 NEW_DEFAULT 和服务里的 DEFAULT_EXTRACT_PROMPT 是同一份文案的两处副本
// （一处管已有的库，一处管新装的库）。改了一处忘了另一处的话，
// 新旧部署会拿到不同的 prompt，而且不会有任何报错。
describe('迁移产出的新文案与代码默认值一致', () => {
  it('两处的 deadline 行和注意事项完全相同', () => {
    const db = freshDb(OLD_PROMPT);
    migration_060.up(db as any);
    const migrated = read(db) as string;

    const svc = fs.readFileSync(SVC_PATH, 'utf8');
    const m = svc.match(/const DEFAULT_EXTRACT_PROMPT = `([\s\S]*?)`;/);
    expect(m, '取不到 DEFAULT_EXTRACT_PROMPT').toBeTruthy();

    expect(migrated).toBe(m![1]);
  });
});
