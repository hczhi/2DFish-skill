// 案例 = 一份真零件的摆放清单 + 哪几对齿轮咬在一起。舞台（MechStage）只照着摆、照着转。
//
// 坐标是 LDraw 的（-Y 朝上，舞台最后整体翻过来），单位 LDU。轴默认沿 Z，齿轮在 XY 平面里转；
// 轴写了 rot 的话整根轴（连同上面的零件）先按 rot 摆好，再绕它自己的 Z 转。
// 位置一律由这里的常量算出来，不手填小数：1 格 = LDU，轴心距 = centerDistance。
import { COLORS, CRANK_THROW, LDU, PARTS, RACK_PITCH_LINE, ROD_LENGTH, TIE_ROD_LENGTH, centerDistance, meshAngle, type ColorKey, type PartKey } from './mechParts'

type Vec3 = [number, number, number]

export interface Placement {
  part: PartKey
  color: ColorKey
  /** 固定件是绝对坐标；轴上的零件 x/y 相对轴心，z 是绝对的。 */
  at: Vec3
  rot?: Vec3
  /** 画成半透明（为了看见里面的东西；实物不透明，页面上要说明）。 */
  ghost?: boolean
  /** 拆开时额外往上抬多少（LDU）。写了就不走「轴抽到齿轮上方」那条规则。 */
  lift?: number
  /** 拆开时整个位移（LDU，root 坐标）。写了就不走下面 explodePlan 那几条规则（汽车那种又长又平的机构按层拆才看得懂）。 */
  apart?: Vec3
}

export interface ShaftDef {
  id: string
  x: number
  y: number
  parts: Placement[]
  /** 有值就在这根轴上方这么高（LDU）挂一个标签。 */
  label?: number
  /** 轴心的 z（默认 0）和朝向。写了 rot 的轴，它上面零件的坐标全是轴自己坐标系里的（z = 沿轴）。 */
  z?: number
  rot?: Vec3
  /** 标签挂在轴上哪一层（默认 = 最大那个齿轮那层）。 */
  labelZ?: number
}

/**
 * 齿轮齿条：轴上 z 那一层的齿轮带着 parts 平移。toward = 从齿轮中心指向齿条的方向（root 坐标）。
 * 平移方向由舞台按「轴向 × toward」算，距离 = 转角 × 节圆半径 —— 不手填，填反了齿条会倒着走。
 */
export interface RackDef {
  shaft: string
  z: number
  toward: Vec3
  parts: Placement[]
  /** 齿条两头用拉杆推着的转向节（前轮）。 */
  knuckles?: KnuckleDef[]
}

/**
 * 转向节：整组绕竖直的主销转，转角由「拉杆长度不变」反算（齿条走多少 → 转向臂末端的球头落在哪）。
 * 两边转向臂都往里斜，所以两个轮子转的角度不一样（内侧轮转得多），这个差是算出来的，不是填的。
 */
export interface KnuckleDef {
  id: string
  /** 主销的位置（root 坐标）。parts 相对它摆，转角 0 时和 root 同向。 */
  pivot: Vec3
  /** 转向臂末端球心（相对主销，转角 0 时）。 */
  arm: Vec3
  /** 齿条上那个球心（root 坐标，齿条在中间时）。 */
  ball: Vec3
  parts: Placement[]
  /** 车轮中心（相对主销，转角 0 时）。转弯中心那张图按它的轮轴线算。 */
  wheel: Vec3
  /** 标签挂在哪（相对主销，不跟着转）。 */
  label?: Vec3
}

export interface MeshDef {
  from: string
  to: string
  /** 咬合发生在哪一层（z）。两边在这一层上必须各有一个齿轮。 */
  z: number
}

/**
 * 万向节：from 带着 to 转。约定 from 的叉口销沿它自己的 x、to 的叉口销沿它自己的 y，
 * 两根轴只差绕 x 的那一下弯折（from.rot = [β, 0, 0]、to 不转），轴线交在十字轴 cross.at。
 * 它不是等速的：tan θto = tan θfrom · cos β（十字轴两对销始终垂直，由此解出来）。
 * 按「两边转一样多」算的话，转到 90° 时十字轴和叉口错开整整 β，画面上是叉口脱开了。
 */
export interface JointDef {
  from: string
  to: string
  /** 十字轴（62519），舞台每帧按两个叉口的朝向摆它。 */
  cross: Placement
}

export interface MechCase {
  fixed: Placement[]
  /** 第一根是主动轴。 */
  shafts: ShaftDef[]
  /** 按传动顺序排：from 必须已经算出转角。 */
  meshes: MeshDef[]
  /** 万向节（两根轴不平行，走不了 meshes）。先于 meshes 算。 */
  joints?: JointDef[]
  /** 主动轴转速，弧度/秒。 */
  speed: number
  /** 「立体」视角的方向（舞台坐标，y 朝上）。不给就用默认的偏正面那个。 */
  iso?: Vec3
  /** 曲柄滑块：连杆挂在轴上的曲柄销，活塞在轴心正上方沿 Y 上下走。 */
  cranks?: CrankDef[]
  racks?: RackDef[]
  /** 有值 = 主动轴来回摆（±swing 弧度，按正弦），speed 是摆动的相位速度；不给就一直往一个方向转。 */
  swing?: number
  /** 后轴那条线的 z（root 坐标）。有值才画得出转弯中心。 */
  rearAxle?: number
}

export interface CrankDef {
  shaft: string
  /** 轴转角 0 时曲柄销相对轴心的位置（x, y）。 */
  pin: [number, number]
  z: number
}

// 零件朝向换算（实测朝向见 PARTS.axis）。Euler 默认 XYZ 顺序 = 先转 Z、再 Y、再 X。
const ALONG_Z: Vec3 = [0, -Math.PI / 2, 0] // 轴、销：X → Z
const BEAM: Vec3 = [Math.PI / 2, Math.PI / 2, 0] // 梁：长度 Z → X，孔轴 Y → Z。只转一次的话梁是侧着立的
const ARM_UP: Vec3 = [Math.PI / 2, 0, 0] // 薄连杆：孔轴 Y → Z，长度 +Z → -Y（朝上）

const gear = (teeth: 8 | 24 | 40, z: number): Placement => ({
  part: teeth === 8 ? 'gear8' : teeth === 24 ? 'gear24' : 'gear40',
  color: teeth === 8 ? 'darkGray' : teeth === 24 ? 'lightGray' : 'tan',
  at: [0, 0, z],
})
const bush = (z: number): Placement => ({ part: 'bush', color: 'red', at: [0, 0, z] })
const axle = (part: 'axle2' | 'axle3' | 'axle4' | 'axle6' | 'axle8' | 'axle10', z: number, lift?: number): Placement => ({
  part, color: 'lightGray', at: [0, 0, z], rot: ALONG_Z, lift,
})

/** 首页那组：8 → 24 → 40 排在一根 7 孔梁前面。 */
export const COVER_CASE: MechCase = (() => {
  const x0 = -3 * LDU // 7 孔梁中间孔在原点，第一个孔在 -3 格
  const x1 = x0 + centerDistance(8, 24)
  const x2 = x1 + centerDistance(24, 40)
  const shaft = (id: string, x: number, teeth: 8 | 24 | 40): ShaftDef => ({
    id, x, y: 0, label: (teeth / 16) * LDU + 14,
    parts: [gear(teeth, -LDU), axle('axle3', -LDU / 2)],
  })
  return {
    fixed: [{ part: 'beam7', color: 'yellow', at: [0, 0, 0], rot: BEAM }],
    shafts: [shaft('g8', x0, 8), shaft('g24', x1, 24), shaft('g40', x2, 40)],
    meshes: [{ from: 'g8', to: 'g24', z: -LDU }, { from: 'g24', to: 'g40', z: -LDU }],
    speed: (Math.PI * 2) / 4,
  }
})()

/**
 * 三级减速齿轮箱：8→24 连做三次，27 : 1。
 *
 * 四根轴排成一排穿过前后两根 11 孔梁，轴距都是 2 格。每一级的齿轮在各自的一层（z = 1/2/3 格），
 * 中间两根轴上一大一小（组合齿轮）。挨着的层里大齿轮的投影互相重叠，所以齿轮前后不会滑走；
 * 投影不重叠的空层塞轴套。**相邻轴上 2 格外的空层不能放轴套**：24 齿齿尖半径 32.4 + 轴套半径 9
 * 大于轴距 40，会穿模（B/C 第一、二层就是这种情况，所以那里空着）。
 */
export const GEARBOX_CASE: MechCase = (() => {
  const L = (n: number) => n * LDU // 第 n 层
  const d = centerDistance(8, 24)
  const [xa, xb, xc, xd] = [0, d, 2 * d, 3 * d]
  const beamZ = [L(0), L(4)]
  return {
    fixed: beamZ.map((z) => ({ part: 'beam11', color: 'yellow', at: [xa + L(3), 0, z], rot: BEAM }) as Placement),
    shafts: [
      {
        id: 'in', x: xa, y: 0, label: 64,
        parts: [
          axle('axle8', L(1.75)), bush(L(-1)), gear(8, L(1)), bush(L(2)), bush(L(3)), bush(L(5)),
          // 手摇曲柄：薄连杆套在轴头上，另一头的孔插一根销当把手（朝前伸出来）。
          { part: 'arm3', color: 'darkGray', at: [0, 0, L(-1.75)], rot: ARM_UP },
          { part: 'pin', color: 'lightGray', at: [0, -L(2), L(-2.25)], rot: ALONG_Z },
        ],
      },
      {
        id: 'mid1', x: xb, y: 0, label: 46,
        parts: [axle('axle8', L(1.5)), bush(L(-1)), gear(24, L(1)), gear(8, L(2)), bush(L(3)), bush(L(5))],
      },
      {
        id: 'mid2', x: xc, y: 0, label: 80, // 和中间轴 1 挨得太近，标签错开一层高度
        parts: [axle('axle8', L(1.5)), bush(L(-1)), gear(24, L(2)), gear(8, L(3)), bush(L(5))],
      },
      {
        // 前端和前梁齐平；后面伸出来挂一个 40 齿当「输出盘」，好看出它转得有多慢。
        id: 'out', x: xd, y: 0, label: 66,
        parts: [axle('axle8', L(3.5)), gear(24, L(3)), bush(L(5)), gear(40, L(6)), bush(L(7))],
      },
    ],
    meshes: [
      { from: 'in', to: 'mid1', z: L(1) },
      { from: 'mid1', to: 'mid2', z: L(2) },
      { from: 'mid2', to: 'out', z: L(3) },
    ],
    speed: (Math.PI * 2) / 1.5,
  }
})()

/**
 * 直列四缸发动机：曲轴由 曲轴端 + 曲轴中段 两两拼成，四个曲柄销按 0° / 180° / 180° / 0° 排
 * （1、4 缸一起走，2、3 缸反着走）。每个零件在 z 上占的那一段见 PARTS 的实测，拼法：
 * 曲轴端的曲柄销（30 长的一截轴）穿过连杆大头（20）再插进中段的一个轴孔（10）；
 * 中段另一个轴孔接反过来装的曲轴端。两组之间用 2 号轴把两个主轴孔连起来，第二组整体转 180°。
 *
 * 气缸四个并排（每个正好 2 格宽），两根 10 号轴穿过它们两侧的安装孔，前后各一根横梁托住；
 * 横梁用销接到竖着的 5 孔梁上当支脚（最上面的孔接横梁、中间的孔穿曲轴）。飞轮（40 齿）放在后面 ——
 * 放前面的话「正面」那个视角（最能看清连杆怎么推曲轴的那个）被它整个挡住。
 */
export const ENGINE_CASE: MechCase = (() => {
  const T = CRANK_THROW
  const bores = [0, 2, 4, 6].map((n) => n * LDU)
  const mount = -2 * LDU // 气缸安装孔 / 横梁那一排的高度
  const cylY = -(T + ROD_LENGTH + 16) // 上止点时活塞顶面（球心上方 16）正好贴住缸盖
  const PI = Math.PI
  const end = (z: number, rot?: Vec3): Placement => ({ part: 'crankEnd', color: 'lightGray', at: [0, 0, z], rot, lift: 0 })
  const mid = (z: number, rot?: Vec3): Placement => ({ part: 'crankMid', color: 'lightGray', at: [0, 0, z], rot, lift: 0 })
  return {
    fixed: [
      ...bores.map((z): Placement => ({ part: 'cylinder', color: 'lightGray', at: [0, cylY, z], ghost: true, lift: 100 })),
      ...[-LDU, LDU].map((x): Placement => ({ part: 'axle10', color: 'lightGray', at: [x, mount, 3 * LDU], rot: ALONG_Z, lift: 100 })),
      ...[-1.5, 7.5].map((n): Placement => ({ part: 'beam7', color: 'yellow', at: [0, mount, n * LDU], rot: BEAM, lift: 100 })),
      ...[-2.5, 8.5].map((n): Placement => ({ part: 'beam5', color: 'yellow', at: [0, 0, n * LDU], rot: ARM_UP })),
      ...[-2, 8].map((n): Placement => ({ part: 'pin', color: 'lightGray', at: [0, mount, n * LDU], rot: ALONG_Z })),
    ],
    shafts: [
      {
        id: 'crank', x: 0, y: 0, label: 64,
        parts: [
          end(0), mid(20), end(40, [0, PI, 0]),
          axle('axle2', 60, 0),
          end(80, [0, 0, PI]), mid(100, [0, 0, PI]), end(120, [PI, 0, 0]),
          axle('axle3', -40, 0), bush(-70),
          axle('axle4', 170, 0), gear(40, 190),
        ],
      },
    ],
    meshes: [],
    cranks: bores.map((z, i) => ({ shaft: 'crank', pin: [i === 0 || i === 3 ? -T : T, 0], z })),
    speed: (Math.PI * 2) / 1.6,
    // 曲轴沿 z，四个缸排在 z 上：从正面斜看的话四个缸叠成一个，改成从侧面斜看。
    iso: [1, 0.5, 0.55],
  }
})()

/**
 * 曲柄滑块：轴转到 angle 时，曲柄销、连杆转角、活塞球心的位置（相对轴心，LDraw 坐标 -Y 朝上）。
 * 活塞只能沿缸孔（轴心正上方那条竖线）走，所以它的高度由连杆长度反算，不是跟着销一起画圆。
 */
export function crankPose(pin: [number, number], angle: number) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const px = pin[0] * c - pin[1] * s
  const py = pin[0] * s + pin[1] * c
  return {
    pin: [px, py] as const,
    // 连杆自身从大头指向 -Y；绕 Z 转 a 之后指向 (sin a, -cos a)，要指向活塞 (-px, -h)。
    rodAngle: -Math.asin(px / ROD_LENGTH),
    pistonY: py - Math.sqrt(ROD_LENGTH ** 2 - px * px),
  }
}

/** 每个曲柄上挂的连杆和活塞（轴转角 0 时的位置，舞台之后每帧按 crankPose 重摆）。 */
export function crankParts(c: MechCase) {
  const byId = new Map(c.shafts.map((s) => [s.id, s]))
  return (c.cranks ?? []).map((k) => {
    const s = byId.get(k.shaft)
    if (!s) throw new Error(`曲柄挂在不存在的轴 ${k.shaft} 上`)
    const pose = crankPose(k.pin, 0)
    const rod: Placement = { part: 'rod', color: 'darkGray', at: [s.x + pose.pin[0], s.y + pose.pin[1], k.z], rot: [0, 0, pose.rodAngle], lift: 25 }
    const piston: Placement = { part: 'piston', color: 'red', at: [s.x, s.y + pose.pistonY, k.z], lift: 55 }
    return { def: k, shaft: s, rod, piston }
  })
}

/**
 * 核对咬合：两边在那一层上各有一个齿轮、轴心距正好等于齿数算出来的值。
 * 错了不会有任何报错 —— 齿轮照样转，只是齿穿过齿、或者两个齿轮根本没碰上。
 * 返回每对咬合的齿数，舞台按它算转角。
 */
export function resolveMeshes(c: MechCase) {
  const byId = new Map(c.shafts.map((s) => [s.id, s]))
  const known = new Set([c.shafts[0]?.id])
  for (const j of c.joints ?? []) {
    jointBend(c, j)
    if (!known.has(j.from)) throw new Error(`万向节 ${j.from}→${j.to} 排在 ${j.from} 被带动之前`)
    known.add(j.to)
  }
  return c.meshes.map((m) => {
    const a = byId.get(m.from)
    const b = byId.get(m.to)
    if (!a || !b) throw new Error(`咬合 ${m.from}→${m.to} 里有不存在的轴`)
    if (!known.has(a.id)) throw new Error(`咬合 ${m.from}→${m.to} 排在 ${m.from} 被带动之前`)
    known.add(b.id)
    const teeth = (s: ShaftDef) => {
      const g = s.parts.find((p) => p.at[2] === m.z && 'teeth' in PARTS[p.part])
      if (!g) throw new Error(`${s.id} 在 z=${m.z} 这一层没有齿轮，咬合 ${m.from}→${m.to} 不成立`)
      return (PARTS[g.part] as { teeth: number }).teeth
    }
    const ta = teeth(a)
    const tb = teeth(b)
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const want = centerDistance(ta, tb)
    if (Math.abs(dist - want) > 0.01) {
      throw new Error(`${m.from}→${m.to} 轴心距 ${dist.toFixed(1)} LDU，${ta}/${tb} 齿应该是 ${want} LDU`)
    }
    return { from: a, to: b, ta, tb, dir: Math.atan2(b.y - a.y, b.x - a.x) }
  })
}

/** 每根轴相对主动轴的转速（主动轴 = 1），按齿数比连乘出来。 */
export function shaftRatios(c: MechCase) {
  const r = new Map<string, number>([[c.shafts[0].id, 1]])
  for (const j of c.joints ?? []) r.set(j.to, r.get(j.from)!)
  for (const m of resolveMeshes(c)) r.set(m.to.id, r.get(m.from.id)! * (m.ta / m.tb))
  return r
}

/** 万向节的弯折角 β。不符合 JointDef 的约定就报错 —— 否则十字轴照样摆，只是和叉口对不上。 */
export function jointBend(c: MechCase, j: JointDef) {
  const a = c.shafts.find((s) => s.id === j.from)
  const b = c.shafts.find((s) => s.id === j.to)
  if (!a || !b) throw new Error(`万向节 ${j.from}→${j.to} 里有不存在的轴`)
  const [ax, ay, az] = a.rot ?? [0, 0, 0]
  if (ay || az || (b.rot ?? [0, 0, 0]).some((v) => v)) throw new Error(`万向节 ${j.from}→${j.to} 只支持 from 绕 x 弯折、to 不转`)
  const [cx, cy, cz] = j.cross.at
  if (Math.hypot(a.x - cx, a.y - cy, (a.z ?? 0) - cz) > 0.01 || Math.hypot(b.x - cx, b.y - cy) > 0.01) {
    throw new Error(`万向节 ${j.from}→${j.to} 两根轴的轴线没交在十字轴上`)
  }
  return ax
}

/** 万向节从动那头的转角（连续的，不在 ±π 处跳）。 */
export function jointAngle(from: number, bend: number) {
  let d = Math.atan2(Math.sin(from) * Math.cos(bend), Math.cos(from)) - from
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2
  return from + d
}

/**
 * 十字轴两对销的方向（root 坐标）：x 那对跟着 from 的叉口，y 那对跟着 to 的叉口。
 * 两者垂直正是 jointAngle 那个式子成立的条件。
 */
export function jointCross(bend: number, from: number, to: number) {
  const x: Vec3 = [Math.cos(from), Math.sin(from) * Math.cos(bend), Math.sin(from) * Math.sin(bend)]
  const y: Vec3 = [-Math.sin(to), Math.cos(to), 0]
  return { x, y }
}

/**
 * 主动轴转到 drive 时每根轴的转角（带方向、带咬合的相位）。舞台每帧用它，页面上的读数也用它 ——
 * 两处各算一遍的话，多加一级齿轮时页面上的「方向盘转几圈」和画面上的对不上。
 */
export function shaftAngles(c: MechCase, drive: number, meshes = resolveMeshes(c)) {
  const a = new Map<string, number>([[c.shafts[0].id, drive]])
  for (const j of c.joints ?? []) a.set(j.to, jointAngle(a.get(j.from)!, jointBend(c, j)))
  for (const m of meshes) a.set(m.to.id, meshAngle(a.get(m.from.id)!, m.ta, m.tb, m.dir))
  return a
}

export function allPlacements(c: MechCase) {
  return [
    ...c.fixed,
    ...c.shafts.flatMap((s) => s.parts),
    ...(c.joints ?? []).map((j) => j.cross),
    ...crankParts(c).flatMap((k) => [k.rod, k.piston]),
    ...(c.racks ?? []).flatMap((r) => [...r.parts, ...(r.knuckles ?? []).flatMap((k) => [...k.parts, tieRod(k, knucklePose(k, 0)!)])]),
  ]
}

/**
 * 齿条沿 X 走了 shift 之后，转向节转多少（弧度，绕 root 的 Y）、拉杆摆在哪。
 * 转向臂末端在「以主销为心、臂长为半径」的圆上，又在「以齿条球心为心、拉杆长为半径」的圆上 ——
 * 两圆交点里取离原位近的那个。齿条走太远、两圆不相交时回 null（舞台加载时会拿两头核一遍）。
 */
export function knucklePose(k: KnuckleDef, shift: number) {
  const [px, , pz] = k.pivot
  const bx = k.ball[0] + shift
  const bz = k.ball[2]
  const A = Math.hypot(k.arm[0], k.arm[2])
  const L = TIE_ROD_LENGTH
  const dx = bx - px
  const dz = bz - pz
  const d = Math.hypot(dx, dz)
  const a = (A * A - L * L + d * d) / (2 * d)
  const h2 = A * A - a * a
  if (!(h2 >= 0)) return null
  const h = Math.sqrt(h2)
  const mx = px + (a * dx) / d
  const mz = pz + (a * dz) / d
  const rest = [px + k.arm[0], pz + k.arm[2]]
  const [tx, tz] = [
    [mx + (h * dz) / d, mz - (h * dx) / d],
    [mx - (h * dz) / d, mz + (h * dx) / d],
  ].sort((p, q) => Math.hypot(p[0] - rest[0], p[1] - rest[1]) - Math.hypot(q[0] - rest[0], q[1] - rest[1]))[0]
  return {
    // 绕 Y 转 δ 会把 (sin φ, cos φ) 转到 (sin(φ+δ), cos(φ+δ))，所以 δ = 现在的方位 - 原来的方位。
    delta: Math.atan2(tx - px, tz - pz) - Math.atan2(k.arm[0], k.arm[2]),
    rodAt: [bx, k.ball[1], bz] as Vec3,
    rodYaw: Math.atan2(tx - bx, tz - bz),
  }
}

export function tieRod(k: KnuckleDef, pose: NonNullable<ReturnType<typeof knucklePose>>): Placement {
  // 拉杆拆开时不动：两头的球头都留在原处，看得出它连的是哪两点。
  return { part: 'tieRod', color: 'black', at: pose.rodAt, rot: [0, pose.rodYaw, 0], apart: [0, 0, 0] }
}

/**
 * 核转向节摆得对不对：拉杆两头的球心要正好隔一根拉杆长、在同一高度。
 * 错了的话拉杆照样画出来，只是一头悬在球外面 —— 看着像接上了。
 */
export function checkKnuckles(c: MechCase) {
  for (const r of c.racks ?? []) {
    for (const k of r.knuckles ?? []) {
      const tip = k.pivot.map((v, i) => v + k.arm[i])
      const len = Math.hypot(tip[0] - k.ball[0], tip[2] - k.ball[2])
      if (Math.abs(len - TIE_ROD_LENGTH) > 0.01) throw new Error(`${k.id} 的拉杆两头相距 ${len.toFixed(1)} LDU，拉杆是 ${TIE_ROD_LENGTH}`)
      if (Math.abs(tip[1] - k.ball[1]) > 0.01) throw new Error(`${k.id} 的拉杆两头不在同一高度（${tip[1]} / ${k.ball[1]}）`)
    }
  }
}

/**
 * 转弯中心：齿条走了 shift 时，两个前轮的轮轴线各自延长到后轴线上落在哪（x），
 * 以及「理想的」内侧轮转角 —— 让内侧轮的轮轴线也穿过外侧轮落下的那一点（四个轮子绕同一个圆心转，不打滑）。
 * 理想和实际差多少就是这套拉杆几何的误差，页面上显示的数全从这里来。
 */
export function turningCenter(c: MechCase, shift: number) {
  const ks = c.racks?.[0]?.knuckles
  if (!ks?.length || c.rearAxle === undefined) throw new Error('这个案例没有转向节或后轴，算不了转弯中心')
  const rz = c.rearAxle
  const wheels = ks.map((k) => {
    const pose = knucklePose(k, shift)
    if (!pose) throw new Error(`齿条走 ${shift} 时 ${k.id} 的拉杆够不着转向臂`)
    const d = pose.delta
    const [wx, , wz] = k.wheel
    // 绕 Y 转 d：(x, z) → (x cos d + z sin d, -x sin d + z cos d)；轮轴方向是转过去的 +X。
    const cx = k.pivot[0] + wx * Math.cos(d) + wz * Math.sin(d)
    const cz = k.pivot[2] - wx * Math.sin(d) + wz * Math.cos(d)
    const x = Math.abs(d) < 1e-9 ? null : cx + (Math.cos(d) * (rz - cz)) / -Math.sin(d)
    return { k, delta: d, center: [cx, cz] as const, x }
  })
  const [inner, outer] = [...wheels].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  let ideal = inner.delta
  if (outer.x !== null) {
    // 内侧轮轴线过点 C ⇔ (C - 主销)·n(δ) = 轮心相对主销的 z，n(δ) = (sin δ, cos δ)。
    const dx = outer.x - inner.k.pivot[0]
    const dz = rz - inner.k.pivot[2]
    const s = Math.asin(inner.k.wheel[2] / Math.hypot(dx, dz))
    const phi = Math.atan2(dz, dx)
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    ideal = [wrap(s - phi), wrap(Math.PI - s - phi)].sort((a, b) => Math.abs(a - inner.delta) - Math.abs(b - inner.delta))[0]
  }
  return { inner, outer, ideal, rearAxle: rz }
}

/**
 * 齿条挂在哪个齿轮上、节圆半径多大（LDU）。那一层没有齿轮就直接报错 —— 否则齿条照样走，只是没东西推它。
 * rest = 方向盘回正时小齿轮的转角（中间隔了几级齿轮就不是 0），齿条按「转角 - rest」走（见 rackTravel）。
 * rest 必须正好让一颗齿朝着齿条，否则两者的齿对不上 —— 画面上是齿穿过齿，不报错。
 */
export function rackPinion(c: MechCase, r: RackDef) {
  const s = c.shafts.find((q) => q.id === r.shaft)
  if (!s) throw new Error(`齿条挂在不存在的轴 ${r.shaft} 上`)
  const g = s.parts.find((p) => p.at[2] === r.z && 'teeth' in PARTS[p.part])
  if (!g) throw new Error(`${s.id} 在 z=${r.z} 这一层没有齿轮，齿条没东西推`)
  const teeth = (PARTS[g.part] as { teeth: number }).teeth
  const rest = shaftAngles(c, 0).get(s.id)!
  const pitch = (Math.PI * 2) / teeth
  const off = ((rest % pitch) + pitch) % pitch
  if (Math.min(off, pitch - off) > 1e-6) throw new Error(`方向盘回正时 ${s.id} 的齿没对准齿条（差 ${((off * 180) / Math.PI).toFixed(1)}°），调前面齿轮的位置`)
  return { shaft: s, radius: (teeth / 16) * LDU, rest }
}

/** 主动轴在 drive 时齿条走了多远（LDU，沿舞台算出来的那个方向）。万向节不等速，所以不是 drive × 某个比。 */
export function rackTravel(c: MechCase, r: RackDef, drive: number) {
  const { shaft, radius, rest } = rackPinion(c, r)
  return (shaftAngles(c, drive).get(shaft.id)! - rest) * radius
}

/** 零件清单：按「零件 + 颜色」合并计数，和买零件时的单位一致。 */
export function billOfMaterials(c: MechCase) {
  const rows = new Map<string, { part: PartKey; color: ColorKey; count: number }>()
  for (const p of allPlacements(c)) {
    const k = `${p.part}/${p.color}`
    const row = rows.get(k) ?? { part: p.part, color: p.color, count: 0 }
    row.count++
    rows.set(k, row)
  }
  return [...rows.values()].map((r) => ({
    ...r,
    id: PARTS[r.part].file.replace('.dat', ''),
    name: PARTS[r.part].name,
    colorName: COLORS[r.color].name,
    hex: '#' + COLORS[r.color].hex.toString(16).padStart(6, '0'),
  }))
}

/**
 * 一键拆开时每个零件往哪退（LDU，LDraw 坐标，不跟着轴转）。按规则算，不逐个手填：
 * - 轴从齿轮中间抽出来，平移到这根轴最大那个齿轮的上方（抽到前面的话整台机构拉得太长，画面缩成一小条）；
 * - 其余零件沿轴向（z）按离中心的距离等比拉开，同一层的还在同一层 —— 看得出「哪几个是咬在一起的」；
 * - 零件写了 lift 的再往上抬这么多（发动机：气缸抬得最高、活塞次之，一层层露出来）。
 */
export const EXPLODE_SPREAD = 2.6
export function explodePlan(c: MechCase) {
  const zs = allPlacements(c).map((p) => p.at[2])
  const mid = (Math.min(...zs) + Math.max(...zs)) / 2
  return (p: Placement, shaft?: ShaftDef): Vec3 => {
    if (p.apart) return p.apart
    if (p.lift !== undefined) return [0, -p.lift, (p.at[2] - mid) * (EXPLODE_SPREAD - 1)]
    if (shaft && p.part.startsWith('axle')) {
      const teeth = Math.max(0, ...shaft.parts.map((q) => (PARTS[q.part] as { teeth?: number }).teeth ?? 0))
      return [0, -((teeth / 16) * LDU + 30), 0]
    }
    return [0, 0, (p.at[2] - mid) * (EXPLODE_SPREAD - 1)]
  }
}

/**
 * 齿轮齿条转向器 + 一台车的底盘：方向盘 → 转向柱 → 8 齿小齿轮 → 齿条 → 两根拉杆 → 两个转向节 → 前轮。
 * 方向盘转多少，齿条就走「转角 × 小齿轮节圆半径」这么远，拉杆再推着转向节绕主销转。
 *
 * 齿条平躺、齿朝上，小齿轮压在它正上方（转向柱沿 z 往后伸到方向盘）；齿条两头的孔是竖的，
 * 插球头销，拉杆的球窝套上去 —— 拉杆两头都是球头，才能一头左右走、一头画圆弧。
 * 转向节 = 十字块：竖的轴孔套在主销（4 号轴）上跟着转，横的销孔穿车轮的短轴（车轮在里面能自己转）。
 *
 * 齿条放在主销后面 3 格、后轴在主销后面 22 格：这两个数是扫出来的（拉杆 5 格、臂 2 格、主销 ±10 格都
 * 是零件定死的），让两个前轮的轮轴线延长之后几乎落在后轴线上同一点（阿克曼）。「转向臂的延长线交在后轴
 * 中点」那条经验规则是给拉杆在主销前面、直接连两个臂的那种转向用的，齿轮齿条套上去误差有十几度。
 * 转向臂斜多少由「转角 0 时拉杆正好一根长」反解，不填。
 *
 * 底盘：两根纵梁（各由两根 15 孔梁上下错开叠 7 孔、销在一起）接前后两根横梁，横梁的端孔穿主销 /
 * 后轮的竖轴。纵梁在 ±4 格：再往里就碰到方向盘（半径 32）。
 */
export const STEERING_CASE: MechCase = (() => {
  const PI = Math.PI
  const r = (8 / 16) * LDU // 小齿轮节圆半径
  const K = 10 * LDU // 主销离中线
  const bx = 4.5 * LDU // 齿条两头的孔
  const A = 2 * LDU // 转向臂：主销孔到末端孔
  const zr = 3 * LDU // 齿条在主销后面多远
  const zk = -zr // 齿条在 z=0（小齿轮那一层），主销在它前面
  const W = 22 * LDU // 主销那条线到后轴
  const rearZ = zk + W
  // 转角 0 时臂末端到齿条球心正好一根拉杆长：(K-bx - A sinλ)² + (A cosλ - zr)² = L²，
  // 展开是 u sinλ + zr cosλ = C，λ = asin(C / |(u, zr)|) - atan2(zr, u)。
  const u = K - bx
  const lean = Math.asin((u * u + A * A + zr * zr - TIE_ROD_LENGTH ** 2) / (2 * A) / Math.hypot(u, zr)) - Math.atan2(zr, u)
  const ballY = -10 // 球头销插在齿条孔里，球心比齿条顶面高 10
  const armY = ballY + 12 + 5 // 球头轴的球心在它原点上方 12，原点贴着连杆顶面；连杆厚 10
  const hubY = armY - 5 - 10 // 十字块叠在连杆上面
  const lowY = hubY - 10 - LDU / 2 // 底盘下层梁（贴着十字块顶面）
  const topY = lowY - LDU // 上层梁
  const UP: Vec3 = [0, 0, PI / 2] // 轴、销：X → Y（-X 端朝上）
  const ACROSS: Vec3 = [0, PI / 2, 0] // 梁平躺、长度沿 X
  const railX = 4 * LDU
  const spin = (side: number): Vec3 => [0, side * (PI / 2), 0]
  // 拆开：底盘两层梁往上抬（销停在两层中间），轮子往两边退、短轴退一半，竖轴抬一点。
  const OFF = { top: [0, -160, 0], low: [0, -110, 0], pin: [0, -135, 0], stand: [0, -60, 0] } satisfies Record<string, Vec3>
  const wheelAt = (side: number, z: number): Placement[] => [
    { part: 'rim', color: 'lightGray', at: [side * 2 * LDU, hubY, z], rot: spin(side), apart: [side * 90, 0, 0] },
    { part: 'tyre', color: 'black', at: [side * 2 * LDU, hubY, z], rot: spin(side), apart: [side * 90, 0, 0] },
    // 短轴一半在十字块的销孔里（圆孔，轮子能自己转），一半插进轮毂。
    { ...axle('axle3', 0), at: [side * 1.5 * LDU, hubY, z], rot: undefined, apart: [side * 45, 0, 0] },
  ]
  const knuckle = (side: -1 | 1): KnuckleDef => {
    const out = (x: number) => side * x
    const wheel: Vec3 = [out(2 * LDU), hubY, -LDU]
    return {
      // 司机面朝 -z（车头），他的左手边是 +x。
      id: side > 0 ? 'left' : 'right',
      pivot: [out(K), 0, zk],
      arm: [-out(A * Math.sin(lean)), ballY, A * Math.cos(lean)],
      ball: [out(bx), ballY, 0],
      wheel,
      label: [wheel[0], hubY - 46 - 14, wheel[2]],
      parts: [
        { part: 'crossBlock', color: 'lightGray', at: [0, hubY, -LDU], rot: ARM_UP, apart: [0, 0, 0] },
        // 主销从上层横梁一直穿到转向臂底下。
        { part: 'axle4', color: 'lightGray', at: [0, armY + 10 - 2 * LDU, 0], rot: UP, apart: OFF.stand },
        { part: 'arm3', color: 'darkGray', at: [0, armY, 0], rot: [0, -side * lean, 0], apart: [0, 0, 0] },
        { part: 'ballAxle', color: 'lightGray', at: [-out(A * Math.sin(lean)), armY - 5, A * Math.cos(lean)], rot: UP, apart: [0, 0, 0] },
        ...wheelAt(side, -LDU),
      ],
    }
  }
  const frame = [-1, 1].flatMap((side): Placement[] => {
    const x = side * railX
    const cross = side * (railX + K) / 2 // 7 孔横梁：从纵梁那个孔到主销那个孔
    const lowRail = zk + 7 * LDU // 15 孔梁中间孔
    const topRail = rearZ - LDU - 7 * LDU
    return [
      { part: 'beam7', color: 'yellow', at: [cross, topY, zk], rot: ACROSS, apart: OFF.top },
      { part: 'beam15', color: 'yellow', at: [x, lowY, lowRail], apart: OFF.low },
      { part: 'beam15', color: 'yellow', at: [x, topY, topRail], apart: OFF.top },
      { part: 'beam7', color: 'yellow', at: [cross, lowY, rearZ - LDU], rot: ACROSS, apart: OFF.low },
      // 上下两层之间的销：前横梁、两根纵梁重叠那段的两头、后横梁。
      ...[zk, topRail - 6 * LDU, lowRail + 6 * LDU, rearZ - LDU].map((z): Placement => ({ part: 'pin', color: 'lightGray', at: [x, lowY - LDU / 2, z], rot: UP, apart: OFF.pin })),
      // 后轮：十字块反过来装（销孔在轴孔后面），竖轴穿过后横梁的端孔。
      { part: 'crossBlock', color: 'lightGray', at: [side * K, hubY, rearZ], rot: [-PI / 2, 0, 0], apart: [0, 0, 0] },
      { part: 'axle2', color: 'lightGray', at: [side * K, lowY + LDU / 2, rearZ - LDU], rot: UP, apart: OFF.stand },
      ...wheelAt(side, rearZ).map((p): Placement => ({ ...p, at: [p.at[0] + side * K, p.at[1], p.at[2]] })),
    ]
  })
  // 转向柱：方向盘 → 万向节 → 输入轴 8 齿 → 惰轮 8 齿 → 小齿轮轴上的 24 齿（小齿轮 8 齿压着齿条）。
  // 8 → 24 是 3:1 的减速；中间那个惰轮只管把方向转回来 —— 只咬一次的话方向盘往左打、车往右拐。
  // 三根轴一根比一根高，正好落在一根竖着的 5 孔梁的孔上（-12 / -52 / -72）。
  const pinY = -(RACK_PITCH_LINE + r)
  const idlerY = pinY - centerDistance(8, 24)
  const inY = idlerY - centerDistance(8, 8)
  const gz = 2 * LDU // 减速那一层
  const ujZ = 6 * LDU // 万向节十字轴
  const tilt = (25 * PI) / 180 // 转向柱往后上方斜
  const along = (d: number): Vec3 => [0, -Math.sin(tilt) * d, Math.cos(tilt) * d] // 沿转向柱退 d
  const fixed: Placement[] = [
    ...frame,
    { part: 'beam5', color: 'yellow', at: [0, (pinY + inY) / 2 - LDU / 2, 3 * LDU], rot: ARM_UP, apart: [0, 0, 0] },
  ]
  return {
    fixed,
    shafts: [
      {
        // 主动轴 = 方向盘这根（第一根）。轴心在十字轴上，零件的 z 沿着转向柱量。
        id: 'column', x: 0, y: inY, z: ujZ, rot: [tilt, 0, 0], label: 50, labelZ: 8.5 * LDU + 4,
        parts: [
          { part: 'ujFork', color: 'lightGray', at: [0, 0, 0], apart: along(40) },
          { ...axle('axle8', 4.5 * LDU), apart: along(80) },
          // 方向盘的轴孔在它自己 y 4..16，转过来之后是 z -16..-4：盘面比轴头多出 4。
          { part: 'wheelSmall', color: 'black', at: [0, 0, 8.5 * LDU + 4], rot: [-PI / 2, 0, 0], apart: along(140) },
        ],
      },
      {
        id: 'input', x: 0, y: inY,
        parts: [
          { ...gear(8, gz), apart: [0, 0, 0] },
          { ...axle('axle4', 3.5 * LDU), apart: [0, 0, 0] },
          // 反过来装的叉口（轴孔朝前），叉口销转到沿 y，和转向柱那头的叉口错开 90°。
          { part: 'ujFork', color: 'lightGray', at: [0, 0, ujZ], rot: [PI, 0, PI / 2], apart: [0, 0, 0] },
        ],
      },
      { id: 'idler', x: 0, y: idlerY, parts: [{ ...gear(8, gz), apart: [0, 0, 0] }, { ...axle('axle2', 2.5 * LDU), apart: [0, 0, 0] }] },
      {
        id: 'pinion', x: 0, y: pinY,
        parts: [{ ...gear(8, 0), apart: [0, 0, 0] }, { ...gear(24, gz), apart: [0, 0, 0] }, { ...axle('axle4', 1.5 * LDU), apart: [0, 0, 0] }],
      },
    ],
    joints: [{ from: 'column', to: 'input', cross: { part: 'ujCross', color: 'darkGray', at: [0, inY, ujZ], apart: along(20) } }],
    meshes: [
      { from: 'input', to: 'idler', z: gz },
      { from: 'idler', to: 'pinion', z: gz },
    ],
    racks: [
      {
        shaft: 'pinion', z: 0, toward: [0, 1, 0],
        // 齿条 x=0 是齿缝，小齿轮转角 0 时正好有一颗齿朝下（+Y，8 齿每 45° 一颗），两者对上。
        parts: [
          { part: 'rack10', color: 'lightGray', at: [0, 0, 0], apart: [0, 0, 0] },
          ...[-1, 1].map((side): Placement => ({ part: 'ballPin', color: 'lightGray', at: [side * bx, 0, 0], rot: UP, apart: [0, 0, 0] })),
        ],
        knuckles: [knuckle(-1), knuckle(1)],
      },
    ],
    rearAxle: rearZ,
    // 方向盘左右各 3/4 圈 → 小齿轮 1/4 圈 → 齿条走 ±15.7。再多内侧轮的拉杆就要和转向臂拉成一条直线
    // （走到 17 左右够不着，舞台加载时会核）。
    swing: 1.5 * PI,
    speed: (PI * 2) / 5,
  }
})()
