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

/**
 * 本机静态图片的根目录。**写图的地方和 `/uploads` 静态挂载必须读同一个函数**
 * （app.ts 那句 express.static 也用它）：各写一份 `path.resolve(...)` 的话，
 * 生图成功、URL 也返回了，而浏览器一访问就 404 —— 后台显示的是「已生成」。
 * 每次调用重新读 env，测试里能改 cwd/覆盖路径而不用重启进程。
 */
export function uploadsRoot(): string {
  return process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'data/uploads');
}

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

/**
 * COS 对象的公网地址。**只有这一份**（生图转存和后台图片上传共用）。
 *
 * 必须是 `https://`：这个 CDN 域名只服务 HTTPS，`http://` 连不上（连接直接超时，
 * 不是 4xx），而浏览器那边表现只是一张裂图 —— 上传/生图接口全都返回成功。
 * 后台页面本身走 https 时更隐蔽：`http://` 的图会被当混合内容**静默**拦掉，
 * 控制台之外什么都看不到。
 * 域名可用 COS_PUBLIC_BASE 覆盖（换 CDN / 直连 bucket 域名时不用改代码）。
 */
export function cosPublicUrl(key: string): string {
  const base = (process.env.COS_PUBLIC_BASE || 'https://file.qiaonan.vip').replace(/\/+$/, '');
  return `${base}/${key}`;
}

/**
 * `getCosConfig()` 返回 null 时，说清是哪一种 null。
 *
 * 「没配」和「配了但解不开」（`CONFIG_ENCRYPTION_KEY` 换了或丢了）解法完全相反：
 * 前者去填四个框，后者去找回那把 key —— 而两种都只表现成「退回本机磁盘」。
 * 合成一句「未配置 COS」会让人把已经存在的密文覆盖掉，那才是真的丢了。
 */
export function cosUnavailableReason(): string {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT key, value FROM system_config WHERE key IN ('cos_secret_id','cos_secret_key','cos_bucket','cos_region')")
    .all() as Array<{ key: string; value: string }>;
  const filled = rows.filter((r) => (r.value || '').trim()).map((r) => r.key);
  if (!filled.length) return '未配置腾讯云 COS（后台 > 系统配置 > 腾讯云 COS 里填四项）';

  const missing = ['cos_secret_id', 'cos_secret_key', 'cos_bucket', 'cos_region'].filter((k) => !filled.includes(k));
  if (missing.length) return `腾讯云 COS 配置不全，缺：${missing.join(' / ')}`;

  return 'COS 四项都配了，但 SecretId/SecretKey 解密失败 —— 通常是 CONFIG_ENCRYPTION_KEY 变了或没设。别急着重填（重填会覆盖掉库里那份密文），先把原来那把 key 找回来。';
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

      const url = cosPublicUrl(key);
      res.json({ url, key });
    } catch (e: any) {
      console.error('[upload] COS upload failed:', e.message);
      res.status(500).json({ error: '上传失败: ' + (e.message || 'Unknown error') });
    }
  });
});
