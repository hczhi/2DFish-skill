import { Router } from 'express';
import { aiGateway, QuotaExceededError } from '../core/llm/gateway.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const aiRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../../..');

// --- Fish AI ---

interface FishState {
  id: string;
  name: string;
  species: string;
  personality: Record<string, number>;
  hunger: number;
  currentHp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  currentAction: string;
  x: number;
  y: number;
}

function buildFishPrompt(fishes: FishState[], foodPositions: { x: number; y: number }[], tankWidth: number, tankHeight: number): string {
  const fishLines = fishes.map(f => {
    const traits = Object.entries(f.personality)
      .filter(([, v]) => v > 0.5)
      .map(([k]) => k[0])
      .join('');
    return `${f.id}:${f.species},hp${f.currentHp}/${f.maxHp},h${f.hunger},atk${f.attack},spd${f.speed},${traits},@${Math.round(f.x)},${Math.round(f.y)},${f.currentAction}`;
  }).join(';');

  const food = foodPositions.length > 0
    ? `F:${foodPositions.slice(0, 3).map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(';')}`
    : 'F:none';

  return `Tank ${tankWidth}x${tankHeight}.${food}
Fish:${fishLines}
Actions:idle,wander,hunt,flee,eat,follow,rest,play,hide,attack
Rules:hungry>70+food=eat;hungry>80+aggr=hunt non-same;same species=follow;coward+threat=flee;hp<30%=hide/rest;attack only non-same
Output JSON:{"decisions":[{"id":"ID","action":"act","target":"ID/null","urgency":0-1}]}`;
}

function handleQuotaError(err: unknown, res: any): boolean {
  if (err instanceof QuotaExceededError) {
    res.status(429).json({ error: 'quota_exceeded', remaining: 0, daily_limit: err.dailyLimit });
    return true;
  }
  return false;
}

aiRouter.post('/fish/decide', async (req, res) => {
  const { fishes, foodPositions, tankWidth, tankHeight } = req.body;

  try {
    const prompt = buildFishPrompt(fishes, foodPositions, tankWidth, tankHeight);
    const { response, usage } = await aiGateway(
      {
        messages: [
          { role: 'system', content: 'Fish tank AI director. Output only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 300,
      },
      { userId: req.user!.id, source: 'fish', operation: 'decide', requestSummary: `${fishes.length} fish decision` }
    );

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: content });
      return;
    }

    const decisions = JSON.parse(jsonMatch[0]);
    res.json({ ...decisions, usage });
  } catch (err: any) {
    if (handleQuotaError(err, res)) return;
    res.status(500).json({ error: err.message });
  }
});

aiRouter.post('/fish/knowledge', async (req, res) => {
  const { hobby } = req.body;

  if (!hobby) {
    res.status(400).json({ error: 'Missing hobby' });
    return;
  }

  const hobbyNames: Record<string, string> = {
    sports: '体育运动', food: '美食料理', gaming: '电子游戏',
    music: '音乐', coding: '编程技术', gossip: '社交趣闻',
    philosophy: '哲学思考', finance: '理财金融',
  };
  const hobbyName = hobbyNames[hobby] || hobby;

  try {
    const { response, usage } = await aiGateway(
      {
        messages: [
          { role: 'system', content: '你是一个冷知识生成器。请生成简短、有趣、硬核的冷知识。每条控制在40字以内。' },
          { role: 'user', content: `生成10条关于"${hobbyName}"的有趣冷知识或小贴士，一行一条，不要序号。` },
        ],
        temperature: 1.0,
        max_tokens: 1000,
      },
      { userId: req.user!.id, source: 'fish', operation: 'knowledge', requestSummary: `hobby: ${hobby}` }
    );

    const content = response.choices[0]?.message?.content || '';
    const lines = content.split('\n')
      .map(l => l.trim().replace(/^[-*•\d.、\s]+/, ''))
      .filter(l => l.length > 0);

    res.json({ knowledge: lines, usage });
  } catch (err: any) {
    if (handleQuotaError(err, res)) return;
    res.status(500).json({ error: err.message });
  }
});

aiRouter.post('/fish/story-event', async (req, res) => {
  const { fishes, availableTemplates, playTime } = req.body;

  const fishDesc = fishes.map((f: any) => `${f.name}(${f.species},Lv${f.level},atk${f.attack},hp${f.hp})`).join(',');
  const avgLevel = Math.round(fishes.reduce((s: number, f: any) => s + f.level, 0) / fishes.length);
  const totalAtk = fishes.reduce((s: number, f: any) => s + f.attack, 0);

  const prompt = `Tank: ${fishes.length} fish, avgLv${avgLevel}, totalAtk${totalAtk}, played ${Math.round(playTime / 60)}min.
Fish:[${fishDesc}]
Templates:${availableTemplates.join(',')}
Pick 1 template. Fill parameters. Boss hp should be ~totalAtk*15 for normal difficulty.
Output JSON:{"templateId":"id","title":"中文标题","phases":[{"type":"narration","narration":"叙事文本"},{"type":"spawn_enemy","enemy":{"name":"名字","hp":N,"attack":N,"defense":N,"appearance":{"color":"hsl","size":N,"shape":"type"}}},{"type":"battle","battle":{"duration":N,"difficulty":"normal"}},{"type":"reward","reward":{"exp":N,"narration":"奖励文本"}}]}`;

  try {
    const { response, usage } = await aiGateway(
      {
        messages: [
          { role: 'system', content: 'Fish tank story event director. Output only valid JSON. All text in Chinese.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.9,
        max_tokens: 500,
      },
      { userId: req.user!.id, source: 'fish', operation: 'story-event', requestSummary: 'story event' }
    );

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: content });
      return;
    }

    const payload = JSON.parse(jsonMatch[0]);
    res.json({ ...payload, usage });
  } catch (err: any) {
    if (handleQuotaError(err, res)) return;
    res.status(500).json({ error: err.message });
  }
});

// --- Board AI (东方智慧看板) ---

let wisdomSkillContent = '';
let darkSkillContent = '';
let wisdomKbContent = '';
try {
  wisdomSkillContent = readFileSync(resolve(projectRoot, 'skills/eastern-wisdom/SKILL.md'), 'utf-8');
  darkSkillContent = readFileSync(resolve(projectRoot, 'skills/eastern-wisdom/SKILL_DARK.md'), 'utf-8');
  wisdomKbContent = readFileSync(resolve(projectRoot, 'skills/eastern-wisdom/references/wisdom_kb.md'), 'utf-8');
} catch { /* skill files not yet copied */ }

const WISDOM_PROMPT = `你是一个翻页看板显示助手，同时也是通晓东方智慧（论语、易经、佛法）的深度顾问。

## 你的双重角色

### 角色1：东方智慧顾问
当用户倾诉困惑、迷茫、焦虑、痛苦等心灵问题时，你需要运用论语、易经、佛法三家思想的分析框架，深入推理后给出有力量的回答。

### 角色2：看板排版设计师
你的所有回答都需要同时设计如何在一个 20列 x 12行 的翻页看板上展示。

## 你必须返回严格的 JSON 格式

{
  "keyword": "核心概念词（1个字或词）",
  "key_sentence": "关键句（≤10字，有力量有温度，不含标点）",
  "interpretation": "解析（约100字，精炼有力）",
  "domain": "知识域",
  "layout": {
    "type": "wisdom",
    "keyword_color": [R, G, B],
    "sentence_color": [R, G, B]
  }
}

只输出JSON，不要其他内容。`;

const DARK_PROMPT = `你是一个翻页看板显示助手，同时也是一面不会美颜的镜子——暗黑智慧顾问。

你不安慰，不鸡汤，不正能量。你用犀利的洞察、反讽的语气、嘲笑自欺的方式，让用户看到自己不愿意面对的真相。

## 你必须返回严格的 JSON 格式

{
  "keyword": "核心真相词（1个字或词）",
  "key_sentence": "扎心的一句话（≤10字，不含标点）",
  "interpretation": "暗黑解读（约100字，犀利但不恶毒）",
  "domain": "暗黑智慧",
  "layout": {
    "type": "wisdom",
    "keyword_color": [R, G, B],
    "sentence_color": [R, G, B]
  }
}

重要原则：扎心但不恶心，有洞察力不是有恶意，不做人身攻击。
只输出JSON，不要其他内容。`;

aiRouter.post('/board/chat', async (req, res) => {
  const { message, mode = 'wisdom' } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Missing message' });
    return;
  }

  try {
    let systemPrompt = mode === 'dark' ? DARK_PROMPT : WISDOM_PROMPT;
    if (mode === 'wisdom' && wisdomKbContent) {
      systemPrompt += `\n\n---\n\n## 东方智慧参考资料\n\n${wisdomKbContent}`;
    }
    if (mode === 'dark' && darkSkillContent) {
      systemPrompt += `\n\n---\n\n## 暗黑智慧参考资料\n\n${darkSkillContent}`;
    }

    const { response, usage } = await aiGateway(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      },
      { userId: req.user!.id, source: 'board', operation: mode === 'dark' ? 'dark-wisdom' : 'wisdom', requestSummary: message.slice(0, 50) }
    );

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      res.json({
        keyword: null,
        key_sentence: content.slice(0, 15),
        interpretation: content,
        domain: null,
        layout: { type: 'wisdom', keyword_color: [180, 170, 140], sentence_color: [160, 150, 130] },
        usage,
      });
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({
      keyword: parsed.keyword || null,
      key_sentence: parsed.key_sentence || null,
      interpretation: parsed.interpretation || '',
      domain: parsed.domain || null,
      layout: parsed.layout || { type: 'wisdom', keyword_color: [180, 170, 140], sentence_color: [160, 150, 130] },
      usage,
    });
  } catch (err: any) {
    if (handleQuotaError(err, res)) return;
    res.status(500).json({ error: err.message });
  }
});
