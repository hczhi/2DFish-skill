import { describe, it, expect } from 'vitest';
import { imageSize } from '../../core/image/imageSize.js';
import { sizeMismatchNote } from './imageSpec.js';

/** 手搓一张 JPEG 的头：SOI + 一个 APP0 段（把 SOF 推到非固定偏移上）+ SOF0。 */
function jpegHead(w: number, h: number): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(0x0011, 2); // 段长
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(32)]);
}

describe('生图尺寸对账', () => {
  it('JPEG 的宽高要顺着段找（按固定偏移读会读到 APP0 里的字节）', () => {
    // 读不出来的话尺寸对账整条静默跳过：那张方图照样贴进 16:9 的槽位、照样写「已生成」。
    expect(imageSize(jpegHead(1536, 1024))).toEqual({ width: 1536, height: 1024 });
  });

  it('签名对得上、后面被截断的 buffer 只能回 null，不许抛', () => {
    // 抛出去的话那一次调用变成一句「生图失败」，而图已经生成、钱已经花了 —— 他会再点一次。
    expect(imageSize(Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG'), Buffer.alloc(12)]))).toBeNull();
  });

  it('上游按自己的默认出了方图时要出声，并且带上两个尺寸', () => {
    // 不说的话画面上只是「主体被切了一半」，看起来像模型构图没构好 —— 他会一张张重生，
    // 而重生出来的还是方的（每次都是一次真实花费）。
    const note = sizeMismatchNote('1536x1024', { width: 1024, height: 1024 }, '第 1 张');
    expect(note).toContain('1536x1024');
    expect(note).toContain('1024×1024');
  });
});
