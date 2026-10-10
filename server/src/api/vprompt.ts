import { Router } from 'express';
import { resolveRequesterId } from '../auth/requester.js';
import {
  optimizePrompt,
  VpromptError,
  MIN_SECONDS,
  MAX_SECONDS,
  MAX_PROMPT_CHARS,
  MAX_CAMERAS,
} from '../services/vprompt/optimizeService.js';
import { STYLES, GENRES, styleById, genreById } from '../services/vprompt/options.js';
import { CAMERA_TEMPLATES, cameraTemplate } from '../services/vprompt/cameraTemplates.js';

// 视频提示词优化：不登录也能用、不扣日额度（作者定的「完全免费」），用完就走、不落库。
export const vpromptRouter = Router();

// GET /api/vprompt/options —— 页面上的风格 / 题材 / 51 式镜头选项（不调 AI）
vpromptRouter.get('/options', (_req, res) => {
  res.json({
    seconds: { min: MIN_SECONDS, max: MAX_SECONDS },
    maxCameras: MAX_CAMERAS,
    styles: STYLES.map(({ id, label }) => ({ id, label })),
    genres: GENRES.map(({ id, label }) => ({ id, label })),
    cameras: CAMERA_TEMPLATES,
  });
});

// POST /api/vprompt/optimize  { prompt, seconds, style?, genre?, cameras? }
vpromptRouter.post('/optimize', async (req, res, next) => {
  const prompt = String(req.body?.prompt || '').trim();
  const seconds = Number(req.body?.seconds);
  const style = String(req.body?.style || 'auto');
  const genre = String(req.body?.genre || 'auto');
  const cameras: string[] = Array.isArray(req.body?.cameras) ? req.body.cameras.map(String) : [];
  if (!prompt) return res.status(400).json({ error: '请先粘贴你的提示词' });
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: `提示词最多 ${MAX_PROMPT_CHARS} 字，现在是 ${prompt.length} 字` });
  }
  if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    return res.status(400).json({ error: `时长只能是 ${MIN_SECONDS}–${MAX_SECONDS} 秒的整数` });
  }
  if (!styleById(style)) return res.status(400).json({ error: `没有「${style}」这个风格` });
  if (!genreById(genre)) return res.status(400).json({ error: `没有「${genre}」这个题材` });
  if (cameras.length > MAX_CAMERAS) return res.status(400).json({ error: `镜头最多选 ${MAX_CAMERAS} 个` });
  const badCam = cameras.find((id) => !cameraTemplate(id));
  if (badCam) return res.status(400).json({ error: `没有编号为「${badCam}」的镜头` });

  try {
    res.json(await optimizePrompt({ prompt, seconds, style, genre, cameras, userId: resolveRequesterId(req) }));
  } catch (e: any) {
    if (e instanceof VpromptError) return res.status(e.status).json({ error: e.message });
    // 有专门话术的几类（专属渠道不全 / 关不掉思维链）交给全局处理器透原文。
    if (e?.name === 'DedicatedChannelError' || e?.name === 'NoThinkingUnsupportedError') return next(e);
    // 其余多半是上游原文（模型名不对 / 余额不足 / 超时）：透出去，兜成一句通用错误会指错方向。
    res.status(502).json({ error: `AI 服务调用失败：${e?.message || e}` });
  }
});
