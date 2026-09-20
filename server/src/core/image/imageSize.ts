// 「这张图真的是我们要的那个尺寸吗」—— 从图片头里读宽高，不问上游。
//
// 为什么必须读：生图请求里的 `size` 是**建议**，各家网关对它的处理各不相同 —— 认的按它出，
// 不认的悄悄按模型默认出（多半是 1024×1024 方图），拼错了键名的直接忽略。方图贴进 16:9 的
// 图槽会被 `object-fit:cover` 裁掉上下两条，画面上是「这张图怎么这么挤 / 主体被切了一半」，
// **接口一路 200、面板上写着已生成**，而真正的成因是尺寸压根没生效。他能做的只有一张张重生
// （每张都是一次真实花费），而重生出来还是方的。
//
// 三条边界：
// ① **认不出的格式回 null，调用方当「没核对」处理**，不许当成「尺寸对」—— 反过来（认不出就
//    报警）的话每张 WebP 都会带一句假警告，真正那句就被冲掉了。
// ② 只读头几十个字节，不解码像素：这一步在生图之后的转存路径上，多花几百毫秒解一张图
//    等于每次生成都慢一点，而它只是为了拿两个数。
// ③ **这个函数一个异常都不许往外抛**（每一处 read 前先核长度）。它跑在 `persistImage` 里、
//    图已经生成（钱已经花了）而还没落盘的那一步：抛出去的话那一次调用变成一句「生图失败」，
//    他会重新点一次（再花一次），而真正的原因只是这几十个字节短了一截（截断的响应、
//    只回了个头的中转站）。它最多只是「这张图没核对尺寸」。

export interface PixelSize {
  width: number;
  height: number;
}

/** PNG / JPEG / GIF / WebP 的宽高（认不出的格式回 null —— 调用方按「没核对」处理）。 */
export function imageSize(buf: Buffer): PixelSize | null {
  // 长度一律在读之前核（见文件头 ③：签名对得上、后面被截断的 buffer 会让 readUInt32BE 抛
  // RangeError，而这一步跑在「图已经花过钱、还没落盘」那个位置上）。
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') {
    // IHDR 的宽高就在固定偏移上（8 字节签名 + 4 长度 + 4 类型）
    return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') {
    return buf.length >= 10 ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) } : null;
  }
  if (buf.length < 16) return null;
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return webpSize(buf);
  }
  return null;
}

/**
 * JPEG 要**顺着段走**找 SOF：宽高不在固定偏移上（前面有多少个 APPn / 注释段全看编码器）。
 * 按固定偏移读的话读到的是某个 EXIF 字段里的两个字节 —— 出来是一对看着像分辨率的数
 * （比如 72×1），于是每张图都带一句「尺寸不对」的假警告。
 */
function jpegSize(buf: Buffer): PixelSize | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15（0xC4 DHT / 0xC8 JPG / 0xCC DAC 不是 SOF）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) return null;
    i += 2 + segLen;
  }
  return null;
}

function webpSize(buf: Buffer): PixelSize | null {
  const fourcc = buf.subarray(12, 16).toString('latin1');
  if (fourcc === 'VP8X' && buf.length >= 30) {
    // 24 位小端，存的是「宽 - 1」
    const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
    const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (fourcc === 'VP8 ') {
    const at = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (at > 0 && at + 7 <= buf.length) {
      return { width: buf.readUInt16LE(at + 3) & 0x3fff, height: buf.readUInt16LE(at + 5) & 0x3fff };
    }
  }
  // VP8L（无损）那一支的位域解法完全不同，认不出就回 null（见文件头 ①）。
  return null;
}
