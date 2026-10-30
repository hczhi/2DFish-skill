// 逐条出现时间（cues）：多条内容的卡（清单 / 步骤 / 气泡……），每一条可以单独定在卡片开始后第几秒出现。
// data.cues[i] 是第 i 条（按非空条目的顺序）相对卡片开始的秒数；没设 / 不是数 = 用卡片自己的默认节奏。
// 时间一律由代码定（字幕对齐 / 播放头 / 拖动），不交给模型 —— 模型编一个时间的话那一条会出现在错的那句话上，看起来完全正常。
export const cueAt = (cues: unknown, i: number, fallback: number) => {
  const v = Array.isArray(cues) ? Number(cues[i]) : NaN
  return Array.isArray(cues) && cues[i] != null && Number.isFinite(v) && v >= 0 ? v : fallback
}
