// 「打字改口」的节奏（RewriteCard 和 templates.ts 共用：最短停留、调试台关键帧都按它算）。
// 三档速度差是这个动效的全部：打错的词按打字速度出来、停一拍光标闪两下、更快地退格删掉、零犹豫打出新词。
export const RT_START = 0.45
export function retypeTimes(from: string, to: string) {
  const a = [...from].length, b = [...to].length
  const typed = RT_START + a * 0.09
  const pauseEnd = typed + 0.5
  const deleted = pauseEnd + a * 0.04
  const done = deleted + b * 0.07
  return { typed, pauseEnd, deleted, done }
}
