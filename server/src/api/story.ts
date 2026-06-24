import { Router } from 'express';
import OpenAI from 'openai';

export const storyRouter = Router();

interface FishSummary {
  id: string;
  name: string;
  species: string;
  level: number;
  attack: number;
  hp: number;
}

interface StoryRequest {
  apiUrl: string;
  apiKey: string;
  model: string;
  fishes: FishSummary[];
  availableTemplates: string[];
  playTime: number;
}

storyRouter.post('/story-event', async (req, res) => {
  const { apiUrl, apiKey, model, fishes, availableTemplates, playTime } = req.body as StoryRequest;

  if (!apiKey || !model) {
    res.status(400).json({ error: 'Missing apiKey or model' });
    return;
  }

  const fishDesc = fishes.map(f => `${f.name}(${f.species},Lv${f.level},atk${f.attack},hp${f.hp})`).join(',');
  const avgLevel = Math.round(fishes.reduce((s, f) => s + f.level, 0) / fishes.length);
  const totalAtk = fishes.reduce((s, f) => s + f.attack, 0);

  const prompt = `Tank: ${fishes.length} fish, avgLv${avgLevel}, totalAtk${totalAtk}, played ${Math.round(playTime / 60)}min.
Fish:[${fishDesc}]
Templates:${availableTemplates.join(',')}
Pick 1 template. Fill parameters. Boss hp should be ~totalAtk*15 for normal difficulty.
Output JSON:{"templateId":"id","title":"中文标题","phases":[{"type":"narration","narration":"叙事文本"},{"type":"spawn_enemy","enemy":{"name":"名字","hp":N,"attack":N,"defense":N,"appearance":{"color":"hsl","size":N,"shape":"type"}}},{"type":"battle","battle":{"duration":N,"difficulty":"normal"}},{"type":"reward","reward":{"exp":N,"narration":"奖励文本"}}]}`;

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: apiUrl || 'https://api.openai.com/v1',
    });

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Fish tank story event director. Output only valid JSON. All text in Chinese.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: content });
      return;
    }

    const payload = JSON.parse(jsonMatch[0]);
    const usage = response.usage;
    res.json({
      ...payload,
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      } : null,
    });
  } catch (err: any) {
    console.error('[AI] Story event error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
