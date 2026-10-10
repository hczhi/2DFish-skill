// 真零件表 + 齿轮位置/相位计算。位置、转角一律在这里算（CLAUDE.md 硬规则 3），场景只负责摆。
//
// 单位是 LDraw 的 LDU：1 格（孔距）= 20 LDU。几何朝向是 scripts/ldraw-pack.mjs 打包后
// 用 LDrawLoader 实测的（见每个零件的 axis）。换零件编号或加新零件之前要重新核 —— 核错了不报错，
// 只是齿咬不上或者轴横着穿过梁。

export const LDU = 20 // 1 格

export interface Part {
  file: string
  name: string
  /** 零件自身坐标系里的朝向，实测。 */
  axis: string
  teeth?: number
}

export const PARTS = {
  gear8: { file: '10928.dat', name: '8 齿齿轮', teeth: 8, axis: '轴沿 Z，第一颗齿尖朝 +X，厚 1 格' },
  gear24: { file: '3648b.dat', name: '24 齿齿轮', teeth: 24, axis: '同上' },
  gear40: { file: '3649.dat', name: '40 齿齿轮', teeth: 40, axis: '同上' },
  beam5: { file: '32316.dat', name: '5 孔梁', axis: '同 7 孔梁' },
  beam7: { file: '32524.dat', name: '7 孔梁', axis: '长度沿 Z、孔轴沿 Y（平躺着建的），中间孔在原点' },
  beam11: { file: '32525.dat', name: '11 孔梁', axis: '同上' },
  beam15: { file: '32278.dat', name: '15 孔梁', axis: '同上' },
  axle3: { file: '4519.dat', name: '3 号轴', axis: '沿 X，居中' },
  axle8: { file: '3707.dat', name: '8 号轴', axis: '同上' },
  bush: { file: '3713.dat', name: '轴套', axis: '轴沿 Z，厚 1 格' },
  arm3: { file: '6632.dat', name: '3 孔薄连杆', axis: '孔轴沿 Y、厚半格；长度沿 +Z，第一个孔在原点' },
  pin: { file: '3673.dat', name: '销', axis: '沿 X，居中，长 2 格' },
  axle2: { file: '3704.dat', name: '2 号轴', axis: '沿 X，居中' },
  axle4: { file: '3705.dat', name: '4 号轴', axis: '沿 X，居中' },
  axle6: { file: '3706.dat', name: '6 号轴', axis: '沿 X，居中' },
  axle10: { file: '3737.dat', name: '10 号轴', axis: '沿 X，居中' },
  // 万向节 61903 在库里是两个叉口 + 一个十字轴拼的，拆开打包才能弯。
  ujFork: { file: '62520.dat', name: '万向节叉口', axis: '轴孔沿 +Z（z 10..30），叉口销沿 X 在原点' },
  ujCross: { file: '62519.dat', name: '万向节十字轴', axis: '十字在 XY 平面，两对销沿 X、沿 Y' },
  rack10: { file: '6592.dat', name: '10 格齿条', axis: '长度沿 X，齿尖朝 -Y（y=-4），齿根 y=0；x=0 是齿缝，齿距 8' },
  wheelSmall: { file: '2819.dat', name: '方向盘', axis: '轴孔沿 Y；盘面朝 -Y（y=-4），轮毂朝 +Y 伸到 24，轴孔在 y 4..16' },
  // 转向的前轮那一套。
  crossBlock: { file: '6536.dat', name: '十字块（轴孔 + 销孔）', axis: '销孔沿 X 在原点；轴孔沿 Z 在 (0, 20, 0)' },
  tieRod: { file: '32005.dat', name: '转向拉杆', axis: '两头是球窝（孔沿 Y），在 z=0 和 z=100' },
  ballPin: { file: '6628.dat', name: '球头销', axis: '销沿 +X（0..20），球心在 x=-10' },
  ballAxle: { file: '2736.dat', name: '球头轴', axis: '轴沿 +X（0..17.5），球心在 x=-12' },
  rim: { file: '55982.dat', name: '轮毂', axis: '轴沿 Z，z -17..20' },
  tyre: { file: '56891.dat', name: '轮胎', axis: '轴沿 Z，外半径 46，z -28..17' },
  // 发动机那一套。四个尺寸咬得正好（实测）：曲拐偏心半格、连杆 2 格、活塞上止点时顶面贴住缸盖、
  // 气缸的安装孔在曲轴中心正上方 2 格 —— 这几个数改错一个就是活塞穿出缸盖或者连杆被拉长。
  crankEnd: { file: '2853a.dat', name: '曲轴端', axis: '主轴沿 Z 在原点（轴孔 z -20..-10）；曲柄销是一截轴，在 x=-10、z -10..20' },
  crankMid: { file: '2854.dat', name: '曲轴中段', axis: '两个轴孔沿 Z：x=-10 在 z -10..0，x=+10 在 z 0..10（正好错开 180°）' },
  rod: { file: '2852.dat', name: '连杆', axis: '大头孔沿 Z 在原点，小头球在 -Y 40 处' },
  piston: { file: '2851.dat', name: '活塞', axis: '球窝中心在原点，顶面在 y=-16' },
  cylinder: { file: '2850a.dat', name: '气缸', axis: '缸孔沿 Y、顶在 y=0 开口朝 +Y；安装孔沿 Z 在 (±20, 26)' },
} satisfies Record<string, Part>

export type PartKey = keyof typeof PARTS

/** 齿条齿距（LDU，实测），以及它的节线离零件原点多远（齿根和齿尖正中）。 */
export const RACK_PITCH = 8
export const RACK_PITCH_LINE = 2

/** 转向拉杆两个球窝的距离（LDU，实测）。 */
export const TIE_ROD_LENGTH = 100

/** 曲柄销到主轴的距离、连杆两孔的距离（LDU），见 crankEnd / rod 的实测。 */
export const CRANK_THROW = 10
export const ROD_LENGTH = 40

// 真实颜色（LDraw 颜色表的编号 + 官方色值）。卡通着色时整体提亮，但不换色系 ——
// 孩子要照着画面去找实物，灰齿轮画成红色的话他在零件盒里永远找不到。
export const COLORS = {
  yellow: { code: 14, hex: 0xf2cd37, name: '黄' },
  red: { code: 4, hex: 0xc91a09, name: '红' },
  lightGray: { code: 71, hex: 0xa0a5a9, name: '浅灰' },
  darkGray: { code: 72, hex: 0x6c6e68, name: '深灰' },
  tan: { code: 19, hex: 0xe4cd9e, name: '米黄' },
  black: { code: 0, hex: 0x1b2a34, name: '黑' },
} as const

export type ColorKey = keyof typeof COLORS

/** 两个直齿轮的轴心距（LDU）。Technic 齿轮齿距统一：半径 = 齿数 / 16 格。 */
export function centerDistance(a: number, b: number) {
  return ((a + b) / 16) * LDU
}

const DEG = Math.PI / 180

/**
 * 从动轮的转角（弧度）。A 在 thetaA 时，B 的齿要正好落进 A 的齿缝。
 * dir 是 A→B 的方向角（弧度，在齿轮平面里）。所有零件的齿尖都从 0° 起排（见 PARTS）。
 *
 * 推导：A 转到 thetaA* = dir 时有一颗齿正对 B；这时 B 必须是齿缝对着 A，
 * 即 B 的某颗齿在 dir + 180° + 半个齿距。之后两者按齿数比反向滚动。
 */
export function meshAngle(thetaA: number, teethA: number, teethB: number, dir: number) {
  const thetaAStar = dir
  const thetaBStar = dir + Math.PI + (180 / teethB) * DEG
  return thetaBStar - (teethA / teethB) * (thetaA - thetaAStar)
}
