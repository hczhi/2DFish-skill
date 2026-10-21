import { Router } from 'express';
import multer from 'multer';
import { QuotaExceededError } from '../core/llm/gateway.js';
import {
  extractFile,
  ExtractError,
  MAX_FILE_BYTES,
  SUPPORTED_EXTS,
  extFromName,
} from '../services/consult/fileExtract.js';
import { extractFactCard, BpError } from '../services/bp/factCardService.js';

// BP 投资分析（/bp）。目前只有第一步：BP → 项目事实卡。不落库、不存原文件
// （BP 是敏感商业信息，`api/upload.ts` 那条路转存的 COS 是公开可访问的）。
export const bpRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  // 中文文件名必须声明 utf8，否则文件名一路乱码（见 api/extractRoutes.ts 同一处）。
  defParamCharset: 'utf8',
  fileFilter: (_req, file, cb) => {
    const ext = extFromName(file.originalname);
    // .ppt 放过去，让 fileExtract 回那句「请另存为 .pptx」。
    if (ext === '.ppt' || (SUPPORTED_EXTS as readonly string[]).includes(ext)) cb(null, true);
    else cb(new Error(`不支持 ${ext || '没有扩展名的'} 文件。目前支持：${SUPPORTED_EXTS.join(' / ')}`));
  },
});

// POST /api/bp/fact-card  multipart: file（BP 文件）或 text（粘贴的项目摘要），二选一
bpRouter.post('/fact-card', (req, res, next) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限` });
      }
      return res.status(400).json({ error: err.message });
    }
    try {
      let text = String(req.body?.text || '');
      let filename = '粘贴的文本';
      let emptyPages = 0;
      const notes: string[] = [];
      if (req.file) {
        const r = await extractFile(req.file.originalname, req.file.buffer);
        text = r.text;
        filename = r.filename;
        emptyPages = r.emptyPages;
        notes.push(...r.notes);
      }
      if (!text.trim()) return res.status(400).json({ error: '请上传 BP 文件，或粘贴项目介绍' });

      const card = await extractFactCard({ text, filename, emptyPages, userId: req.user!.id });
      res.json({ filename, chars: text.length, ...card, notes: [...notes, ...card.notes] });
    } catch (e: any) {
      if (e instanceof ExtractError) return res.status(400).json({ error: e.message });
      if (e instanceof BpError) return res.status(e.status).json({ error: e.message });
      if (e instanceof QuotaExceededError) {
        return res.status(429).json({
          error: 'quota_exceeded', remaining: 0, daily_limit: e.dailyLimit, app: e.app, detail: e.message,
        });
      }
      if (e?.name === 'DedicatedChannelError' || e?.name === 'NoThinkingUnsupportedError') return next(e);
      // 其余多半是上游原文（模型名不对 / 余额不足 / 超时）：透出去，兜成通用错误会指错方向。
      res.status(502).json({ error: `AI 服务调用失败：${e?.message || e}` });
    }
  });
});
