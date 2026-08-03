import { Router, Request, Response } from 'express';
import multer from 'multer';
import COS from 'cos-nodejs-sdk-v5';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { getDatabase } from '../db/index.js';
import { tryDecryptSecret } from '../core/secrets.js';

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

  // secret_id/secret_key 在库里是密文（migrations/050），bucket/region 不是敏感信息不加密。
  // tryDecryptSecret 对没有 enc: 前缀的值原样返回，所以这里对两类值都安全。
  const SECRET_FIELDS = new Set(['cos_secret_id', 'cos_secret_key']);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = SECRET_FIELDS.has(row.key) ? tryDecryptSecret(row.value) ?? '' : row.value;
  }

  // 解密失败会落到空串，和「没配置」走同一个 null 分支：上传接口返回
  // 「对象存储未配置」而不是拿着空凭据去调腾讯云换一个看不懂的签名错误。
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
