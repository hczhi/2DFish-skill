import { Router, Request, Response } from 'express';
import { requireAdmin } from '../auth/guards.js';
import {
  KEY_APPS,
  isKeyApp,
  createAppKeys,
  listAppKeys,
  getAppKey,
  revealAppKey,
  updateAppKey,
  applyDelta,
  listLedger,
  AppKeyError,
  createRechargeCodes,
  listRechargeCodes,
  revealRechargeCode,
  setRechargeIssued,
  redeemRechargeCode,
} from '../services/appKeyService.js';

// 售卖型应用 key 的后台（migration 112）。
export const appKeysRouter = Router();
appKeysRouter.use(requireAdmin);

function fail(res: Response, e: unknown) {
  if (e instanceof AppKeyError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  throw e;
}

appKeysRouter.get('/apps', (_req, res) => {
  res.json(Object.entries(KEY_APPS).map(([app, v]) => ({ app, ...v })));
});

appKeysRouter.get('/', (req: Request, res: Response) => {
  const app = req.query.app;
  if (!isKeyApp(app)) {
    res.status(400).json({ error: `未知应用：${String(app)}` });
    return;
  }
  res.json(listAppKeys(app));
});

appKeysRouter.post('/', (req: Request, res: Response) => {
  const { app, count, balance, label } = req.body || {};
  if (!isKeyApp(app)) {
    res.status(400).json({ error: `未知应用：${String(app)}` });
    return;
  }
  try {
    res.json(createAppKeys(app, Number(count), Number(balance), typeof label === 'string' ? label : ''));
  } catch (e) {
    fail(res, e);
  }
});

appKeysRouter.patch('/:id', (req: Request, res: Response) => {
  const { enabled, label } = req.body || {};
  try {
    res.json(
      updateAppKey(req.params.id, {
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        label: typeof label === 'string' ? label : undefined,
      })
    );
  } catch (e) {
    fail(res, e);
  }
});

appKeysRouter.post('/:id/adjust', (req: Request, res: Response) => {
  const { delta, note } = req.body || {};
  try {
    const entry = applyDelta(req.params.id, Number(delta), 'adjust', { note: typeof note === 'string' ? note : '' });
    res.json(entry);
  } catch (e) {
    fail(res, e);
  }
});

appKeysRouter.get('/:id/ledger', (req: Request, res: Response) => {
  if (!getAppKey(req.params.id)) {
    res.status(404).json({ error: 'key 不存在' });
    return;
  }
  res.json(listLedger(req.params.id));
});

// ── 充值码（115）──
appKeysRouter.get('/codes', (req: Request, res: Response) => {
  const app = req.query.app;
  if (!isKeyApp(app)) {
    res.status(400).json({ error: `未知应用：${String(app)}` });
    return;
  }
  res.json(listRechargeCodes(app));
});

appKeysRouter.post('/codes', (req: Request, res: Response) => {
  const { app, count, points, label } = req.body || {};
  if (!isKeyApp(app)) {
    res.status(400).json({ error: `未知应用：${String(app)}` });
    return;
  }
  try {
    res.json(createRechargeCodes(app, Number(count), Number(points), typeof label === 'string' ? label : ''));
  } catch (e) {
    fail(res, e);
  }
});

appKeysRouter.post('/codes/issue', (req: Request, res: Response) => {
  const { ids, issued } = req.body || {};
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
    res.status(400).json({ error: 'ids 必须是字符串数组' });
    return;
  }
  res.json({ changed: setRechargeIssued(ids, issued !== false) });
});

appKeysRouter.get('/codes/:id/reveal', (req: Request, res: Response) => {
  try {
    res.json({ code: revealRechargeCode(req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

appKeysRouter.get('/:id/reveal', (req: Request, res: Response) => {
  try {
    res.json({ key: revealAppKey(req.params.id) });
  } catch (e) {
    fail(res, e);
  }
});

// 前台：拿着 key 查自己是哪个应用的卡、还剩多少点。key 本身就是 Bearer（见 auth/middleware.ts）。
export const appKeyClientRouter = Router();

appKeyClientRouter.get('/me', (req: Request, res: Response) => {
  const row = req.appKeyId ? getAppKey(req.appKeyId) : undefined;
  if (!row) {
    res.status(400).json({ error: '这个接口只接受应用 key' });
    return;
  }
  res.json({ app: row.app, appLabel: KEY_APPS[row.app].label, keyPrefix: row.key_prefix, balance: row.balance - row.frozen });
});

// 买家拿着 key 充值：码充进的是**当前这把 key**（Bearer 那把），不接受 body 里指定别的 key。
appKeyClientRouter.post('/redeem', (req: Request, res: Response) => {
  if (!req.appKeyId) {
    res.status(400).json({ error: '这个接口只接受应用 key' });
    return;
  }
  const code = req.body?.code;
  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: '请输入充值码' });
    return;
  }
  try {
    res.json(redeemRechargeCode(req.appKeyId, code));
  } catch (e) {
    fail(res, e);
  }
});
