import { Router } from 'express';
import OpenAI from 'openai';

export const aiRouter = Router();

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

interface DecisionRequest {
  apiUrl: string;
  apiKey: string;
  model: string;
  fishes: FishState[];
  foodPositions: { x: number; y: number }[];
  tankWidth: number;
  tankHeight: number;
}

function buildPrompt(fishes: FishState[], foodPositions: { x: number; y: number }[], tankWidth: number, tankHeight: number): string {
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

aiRouter.post('/knowledge', async (req, res) => {
  const { apiUrl, apiKey, model, hobby } = req.body;

  if (!apiKey || !model || !hobby) {
    res.status(400).json({ error: 'Missing apiKey, model, or hobby' });
    return;
  }

  const hobbyNames: Record<string, string> = {
    sports: '体育运动', food: '美食料理', gaming: '电子游戏',
    music: '音乐', coding: '编程技术', gossip: '社交趣闻',
    philosophy: '哲学思考', finance: '理财金融',
  };

  const hobbyName = hobbyNames[hobby] || hobby;

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: apiUrl || 'https://api.openai.com/v1',
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: '你是一个冷知识生成器。请生成简短、有趣、硬核的冷知识。每条控制在40字以内。' },
        { role: 'user', content: `生成10条关于"${hobbyName}"的有趣冷知识或小贴士，一行一条，不要序号。` },
      ],
      temperature: 1.0,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // We modify the filter to allow longer sentences since we updated the prompt to allow 40-60 characters
    // But since we are using the backend's original prompt (which asks for <=15 chars), 
    // let's just relax the length filter here to avoid dropping valid responses.
    const lines = content.split('\n')
      .map(l => l.trim().replace(/^[-*•\d.、\s]+/, '')) // Remove leading bullet points or numbers
      .filter(l => l.length > 0);

    const usage = response.usage;

    res.json({
      knowledge: lines,
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      } : null,
    });
  } catch (err: any) {
    console.error('[AI] Knowledge error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

aiRouter.post('/decide', async (req, res) => {
  const { apiUrl, apiKey, model, fishes, foodPositions, tankWidth, tankHeight } = req.body as DecisionRequest;

  if (!apiKey || !model) {
    res.status(400).json({ error: 'Missing apiKey or model' });
    return;
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: apiUrl || 'https://api.openai.com/v1',
    });

    const prompt = buildPrompt(fishes, foodPositions, tankWidth, tankHeight);

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Fish tank AI director. Output only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: content });
      return;
    }

    const decisions = JSON.parse(jsonMatch[0]);
    const usage = response.usage;
    res.json({
      ...decisions,
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      } : null,
    });
  } catch (err: any) {
    console.error('[AI] Decision error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
