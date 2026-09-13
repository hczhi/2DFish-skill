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

/** 库里读一批 system_config；`secret` 里列出的键按密文解（migrations/050）。 */
function readConfig(keys: string[], secret: Set<string>): { plain: Record<string, string>; raw: Record<string, string> } {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT key, value FROM system_config WHERE key IN (${keys.map(() => '?').join(',')})`)
    .all(...keys) as Array<{ key: string; value: string }>;
  const plain: Record<string, string> = {};
  const raw: Record<string, string> = {};
  for (const row of rows) {
    raw[row.key] = (row.value || '').trim();
    // tryDecryptSecret 对没有 enc: 前缀的值原样返回，所以这里对两类值都安全。
    plain[row.key] = (secret.has(row.key) ? tryDecryptSecret(row.value) ?? '' : row.value || '').trim();
  }
  return { plain, raw };
}

const COS_SECRET_FIELDS = new Set(['cos_secret_id', 'cos_secret_key', 'cos_ppt_secret_id', 'cos_ppt_secret_key']);

export function getCosConfig(): { SecretId: string; SecretKey: string; Bucket: string; Region: string } | null {
  const { plain: config } = readConfig(['cos_secret_id', 'cos_secret_key', 'cos_bucket', 'cos_region'], COS_SECRET_FIELDS);

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

/** 一次转存要写到哪：桶 + 凭据 + 那个桶的公网域名（域名和桶必须成对传，见 resolveCosTarget）。 */
export type CosTarget = { SecretId: string; SecretKey: string; Bucket: string; Region: string; publicBase: string };

/**
 * PPT 专用桶那两个域名（源站 / CDN）共用一套校验。
 *
 * https 是硬的：`http://` 的图在 https 后台上被当混合内容**静默**拦掉，控制台之外什么都看不到。
 * 形如默认 cos 域名的再核 bucket/region 两段 —— 那种写错法（比如把 CDN 框里填成另一个桶的
 * myqcloud 域名）会让 `putObject` 成功、接口 200、库里存下 URL，只有浏览器那边是裂图。
 * 自定义 CDN 域名核不了指向哪个桶，只能核到 https。
 */
function checkPptDomain(base: string, Bucket: string, Region: string, label: string): void {
  const trimmed = base.replace(/\/+$/, '');
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error(`PPT 专用桶的${label}必须以 https:// 开头（当前「${trimmed}」）—— http 的图会被浏览器当混合内容静默拦掉。`);
  }
  const m = /^https:\/\/([a-z0-9-]+)\.cos\.([a-z0-9-]+)\.myqcloud\.com$/i.exec(trimmed);
  if (m && (m[1] !== Bucket || m[2] !== Region)) {
    throw new Error(
      `PPT 专用桶的${label}和桶对不上：域名指向 ${m[1]} / ${m[2]}，而桶填的是 ${Bucket} / ${Region}。` +
        '这样图会成功写进桶里，而页面上是裂图。'
    );
  }
}

/** PPT 专用桶没填 CDN 域名时用的那个。改这里等于改所有 /ppt 新图的域名（旧图库里存的是全 URL，不会跟着变）。 */
export const PPT_CDN_BASE_DEFAULT = 'https://ai-cdn01.xiaozancloud.com';

/**
 * PPT 专用桶（后台 > 系统配置 > PPT 专用桶）。**三项要么齐、要么当没配**，中间状态一律抛错。
 *
 * 缺一项就静默走默认桶的话，界面上是一张正常显示的图 —— 他会以为新桶已经在用了，
 * 而实际上一张都没进去；等哪天把默认桶清了，整份稿子的图一起裂。
 * 域名和桶对不上更隐蔽：`putObject` 成功、接口 200、库里存了 URL，只有浏览器那边是裂图，
 * 所以默认 cos 域名形式这里直接核对 bucket/region 两段（自定义 CDN 域名核不了，只能核 https）。
 * 密钥留空 = 复用默认桶那对；但**填了却解不开必须抛错**（拿默认桶的凭据去写这个桶只会换来
 * 一个 AccessDenied，那句话会把人指向权限而不是 CONFIG_ENCRYPTION_KEY）。
 *
 * **这个桶的文件一律从 CDN 取**（`cos_ppt_cdn_base`，留空 = `PPT_CDN_BASE_DEFAULT`），
 * `cos_ppt_base` 只留作源站域名、只用来核对桶名/地域，不再参与拼 URL —— 两个域名都拿来拼的话
 * 「这张图走没走 CDN」得逐张看 URL 才知道，而回源那张也能正常显示。
 */
export function getPptCosTarget(): CosTarget | null {
  const KEYS = ['cos_ppt_bucket', 'cos_ppt_region', 'cos_ppt_base', 'cos_ppt_cdn_base', 'cos_ppt_secret_id', 'cos_ppt_secret_key'];
  const { plain, raw } = readConfig(KEYS, COS_SECRET_FIELDS);
  const trio = ['cos_ppt_bucket', 'cos_ppt_region', 'cos_ppt_base'];
  const filled = trio.filter((k) => plain[k]);
  if (!filled.length) return null;
  if (filled.length < trio.length) {
    throw new Error(
      `PPT 专用桶配置不全，缺：${trio.filter((k) => !plain[k]).join(' / ')}。` +
        '要么把三项填齐，要么三项都清空（清空 = PPT 也用默认桶）。'
    );
  }

  const Bucket = plain.cos_ppt_bucket;
  const Region = plain.cos_ppt_region;
  // 源站域名照旧要核（它是「这两项填对了没」的唯一交叉验证），但拼 URL 用的是 CDN 那个。
  checkPptDomain(plain.cos_ppt_base, Bucket, Region, '源站域名');
  const publicBase = (plain.cos_ppt_cdn_base || PPT_CDN_BASE_DEFAULT).replace(/\/+$/, '');
  checkPptDomain(publicBase, Bucket, Region, 'CDN 域名');

  let SecretId = plain.cos_ppt_secret_id;
  let SecretKey = plain.cos_ppt_secret_key;
  const storedButUnreadable = (['cos_ppt_secret_id', 'cos_ppt_secret_key'] as const).filter((k) => raw[k] && !plain[k]);
  if (storedButUnreadable.length) {
    throw new Error(
      `PPT 专用桶的 ${storedButUnreadable.join(' / ')} 解密失败 —— 通常是 CONFIG_ENCRYPTION_KEY 变了或没设。` +
        '别急着重填（重填会覆盖掉库里那份密文）。'
    );
  }
  if (!SecretId !== !SecretKey) {
    throw new Error('PPT 专用桶的 SecretId / SecretKey 只填了一个：两个都填（用这个桶自己的账号）或两个都留空（复用默认桶那对）。');
  }
  if (!SecretId) {
    const fallback = getCosConfig();
    if (!fallback) {
      throw new Error(`PPT 专用桶没填密钥，而默认桶的凭据也用不了：${cosUnavailableReason()}`);
    }
    SecretId = fallback.SecretId;
    SecretKey = fallback.SecretKey;
  }

  return { SecretId, SecretKey, Bucket, Region, publicBase };
}

/**
 * 这次转存写哪个桶。`profile==='ppt'` 且 PPT 专用桶配齐了就写它，否则写默认桶。
 *
 * **配置错误在这里抛，调用方要在调上游之前先调一次**（见 imageGateway.generateImage）：
 * 放到转存那一步才抛的话，上游已经生成、已经扣了费，而他看到的是一句「生图失败」，
 * 于是一路重试 —— 每次都真花钱、每次都断在同一个地方。
 */
export function resolveCosTarget(profile?: 'ppt'): CosTarget | null {
  if (profile === 'ppt') {
    const ppt = getPptCosTarget();
    if (ppt) return ppt;
  }
  const d = getCosConfig();
  return d ? { ...d, publicBase: defaultPublicBase() } : null;
}

/**
 * COS 对象的公网地址。**只有这一份**（生图转存和后台图片上传共用）。
 *
 * 必须是 `https://`：这个 CDN 域名只服务 HTTPS，`http://` 连不上（连接直接超时，
 * 不是 4xx），而浏览器那边表现只是一张裂图 —— 上传/生图接口全都返回成功。
 * 后台页面本身走 https 时更隐蔽：`http://` 的图会被当混合内容**静默**拦掉，
 * 控制台之外什么都看不到。
 * 域名可用 COS_PUBLIC_BASE 覆盖（换 CDN / 直连 bucket 域名时不用改代码）。
 * **写别的桶时必须把那个桶的域名传进来**（`base`）：不传就套默认桶的 CDN 域名，
 * 于是图进了新桶而 URL 指着老桶 —— 上传/生图接口全都 200，页面上是裂图。
 */
export function cosPublicUrl(key: string, base?: string): string {
  return `${(base || defaultPublicBase()).replace(/\/+$/, '')}/${key}`;
}

function defaultPublicBase(): string {
  return (process.env.COS_PUBLIC_BASE || 'https://file.qiaonan.vip').replace(/\/+$/, '');
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
