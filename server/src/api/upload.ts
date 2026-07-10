import { Router, Request, Response } from 'express';
import multer from 'multer';
import COS from 'cos-nodejs-sdk-v5';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { getDatabase } from '../db/index.js';

export const uploadRouter = Router();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型，仅允许 JPG/PNG/GIF/WebP/SVG'));
    }
  },
});

export function getCosConfig(): { SecretId: string; SecretKey: string; Bucket: string; Region: string } | null {
  const db = getDatabase();
  const rows = db.prepare("SELECT key, value FROM system_config WHERE key IN ('cos_secret_id', 'cos_secret_key', 'cos_bucket', 'cos_region')").all() as Array<{ key: string; value: string }>;

  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }

  if (!config.cos_secret_id || !config.cos_secret_key || !config.cos_bucket || !config.cos_region) {
    return null;
  }

  return {
    SecretId: config.cos_secret_id,
    SecretKey: config.cos_secret_key,
    Bucket: config.cos_bucket,
    Region: config.cos_region,
  };
}

uploadRouter.post('/image', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Login required' });
    return;
  }

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: '文件大小超过 5MB 限制' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: '请选择要上传的文件' });
      return;
    }

    const cosConfig = getCosConfig();
    if (!cosConfig) {
      res.status(500).json({ error: 'COS 未配置，请在管理后台 > 系统配置中设置 COS 相关参数' });
      return;
    }

    const cos = new COS({
      SecretId: cosConfig.SecretId,
      SecretKey: cosConfig.SecretKey,
    });

    const now = new Date();
    const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${uuidv4()}${ext}`;
    const key = `uploads/${datePath}/${filename}`;

    try {
      await new Promise<void>((resolve, reject) => {
        cos.putObject({
          Bucket: cosConfig.Bucket,
          Region: cosConfig.Region,
          Key: key,
          Body: req.file!.buffer,
          ContentType: req.file!.mimetype,
        }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const url = `http://file.qiaonan.vip/${key}`;
      res.json({ url, key });
    } catch (e: any) {
      console.error('[upload] COS upload failed:', e.message);
      res.status(500).json({ error: '上传失败: ' + (e.message || 'Unknown error') });
    }
  });
});
