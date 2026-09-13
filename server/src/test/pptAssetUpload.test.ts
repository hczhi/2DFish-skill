import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from '../app.js';
import { createUser, type TestUser } from './helpers.js';

// 本地图片上传进素材库。这里测的是**会伪装成成功**的那两件事：
//
// ① 比例判错：一张竖图被记成 16:9 之后，挑进 16:9 的图槽时那句「贴进去会被裁掉两边」
//    压根不会出现 —— 页面照旧是一页完整的幻灯片，只是主体被裁掉一半，接口全程 200。
// ② 图落在本机磁盘（COS 没配）而不说：那张图只在这台机器上，换机器/多实例就 404，
//    而那时界面上只是一张裂图，上传这一步回的是「成功」。
//
// 测试库里没有 COS 配置，所以走的正是 ② 那条回落路径。

/** 只有文件头是真的（imageSize 只读 IHDR，sniffImageType 只读前 4 字节）。 */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

let user: TestUser;
let tmpUploads: string;
let prevUploads: string | undefined;

beforeAll(() => {
  user = createUser();
  prevUploads = process.env.UPLOADS_DIR;
  tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-upload-'));
  process.env.UPLOADS_DIR = tmpUploads;
});

afterAll(() => {
  if (prevUploads === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = prevUploads;
  fs.rmSync(tmpUploads, { recursive: true, force: true });
});

describe('ppt 素材库上传本地图片', () => {
  it('竖图记成 3:4、横图记成 16:9，比例按字节算不按扩展名猜', async () => {
    const tall = await request(app)
      .post('/api/ppt/assets/upload')
      .set(user.auth)
      .attach('file', pngHeader(1080, 1920), { filename: '竖图.png', contentType: 'image/png' });
    expect(tall.status).toBe(200);
    expect(tall.body.asset.ratio).toBe('3:4');
    expect(tall.body.pixels).toBe('1080×1920');
    // 挑进图槽时 `asset.mode || spec.mode` 要能回落成那一格本来要的画法
    expect(tall.body.asset.mode).toBe('');

    const wide = await request(app)
      .post('/api/ppt/assets/upload')
      .set(user.auth)
      .attach('file', pngHeader(1920, 1080), { filename: '横图.png', contentType: 'image/png' });
    expect(wide.status).toBe(200);
    expect(wide.body.asset.ratio).toBe('16:9');

    // 两张都要在素材库里列得出来（存进去了而库里没有这一行时，界面上和「上传失败」一样）
    const list = await request(app).get('/api/ppt/assets').set(user.auth);
    expect(list.body.assets.map((a: any) => a.ratio).sort()).toEqual(['16:9', '3:4']);
  });

  it('COS 没配、图落在本机磁盘时必须说出来并说出成因', async () => {
    const res = await request(app)
      .post('/api/ppt/assets/upload')
      .set(user.auth)
      .attach('file', pngHeader(800, 800), { filename: '方图.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.asset.storage).toBe('local');
    expect(res.body.note).toMatch(/本机磁盘/);
    expect(res.body.note).toMatch(/COS/);
  });

  it('不是图片的文件一律拒（改成 .png 也不行）', async () => {
    const res = await request(app)
      .post('/api/ppt/assets/upload')
      .set(user.auth)
      .attach('file', Buffer.from('%PDF-1.4 这其实是个 pdf'), { filename: '假图.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/尺寸|不是/);
  });
});
