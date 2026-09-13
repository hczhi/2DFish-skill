// 从图片字节里读出像素尺寸。不引依赖（没有 sharp / image-size），只认
// png / jpeg / gif / webp —— 和 imageGateway 里 `sniffImageType` 认的是同一组格式。
//
// **为什么在服务端算，而不是让前端 `new Image()` 量完传上来**：这个尺寸决定一张
// 上传的图记进素材库时算哪一档比例（16:9 / 1:1 / 3:4），而那一档是「贴进这一格
// 会不会被裁掉两边」那句提醒的唯一依据。比例记错时那张图照旧贴得进去、照旧是一页
// 完整的幻灯片，只是主体被裁掉一半，接口全程 200，没有一处会说。
//
// 读不出来时**返回 null 让调用方拒掉**，不要缺省成 16:9：缺省的那一档正好是最常见的
// 那一档，于是竖图会被静默当成横图。

export interface PixelSize {
  width: number;
  height: number;
}

/** 读不出来（不是这四种格式 / 文件截断）返回 null。 */
export function imageSize(buf: Buffer): PixelSize | null {
  return pngSize(buf) || gifSize(buf) || webpSize(buf) || jpegSize(buf);
}

function pngSize(buf: Buffer): PixelSize | null {
  if (buf.length < 24) return null;
  if (!(buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG')) return null;
  // IHDR 是 PNG 规范要求的第一个块，宽高固定在 16/20 偏移上。
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf: Buffer): PixelSize | null {
  if (buf.length < 10) return null;
  if (buf.subarray(0, 3).toString('latin1') !== 'GIF') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** webp 有三种块（有损 VP8 / 无损 VP8L / 带扩展 VP8X），宽高的存法各不相同。 */
function webpSize(buf: Buffer): PixelSize | null {
  if (buf.length < 30) return null;
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF') return null;
  if (buf.subarray(8, 12).toString('latin1') !== 'WEBP') return null;
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') {
    // 帧头：3 字节起始码 + 14 位宽 + 14 位高（各占 2 字节，高 2 位是缩放比例）。
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  return null;
}

/**
 * jpeg 没有固定偏移，得从头扫段。宽高在 SOF 段里（0xC0–0xCF，除掉 C4/C8/CC
 * 那三个不是 SOF 的）—— 只认 SOF0 的话渐进式 jpeg（SOF2，手机相册导出的很常见）
 * 会读不出尺寸。
 */
function jpegSize(buf: Buffer): PixelSize | null {
  if (buf.length < 4) return null;
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++; // 段之间可能有填充字节
      continue;
    }
    const marker = buf[i + 1];
    // 这几个是没有长度字段的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF：precision(1) + height(2) + width(2)
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}
