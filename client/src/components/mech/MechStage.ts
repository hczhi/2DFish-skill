// 固定视角的卡通 3D 舞台。纯 TS 类，**不进 Vue 响应式**：three 的对象被 reactive 深度代理之后
// 每帧都在走 Proxy，内存和 CPU 一起被拖垮，而画面照常，只是越用越卡。
//
// 性能约定（见首页那次讨论）：不动就不画（按需渲染）、转动时限 30 帧、像素密度封顶 1.5、
// 滚出屏幕 / 切走标签页就停、卸载时释放全部几何和材质。
import * as THREE from 'three'
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js'
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js'
import { COLORS, PARTS } from './mechParts'
import { allPlacements, checkKnuckles, crankParts, crankPose, explodePlan, knucklePose, jointBend, jointCross, rackPinion, rackTravel, resolveMeshes, shaftAngles, tieRod, type KnuckleDef, type MechCase, type Placement, type ShaftDef } from './mechCases'

export type ViewName = 'iso' | 'front' | 'back' | 'side' | 'top'

export const VIEWS: Record<ViewName, { label: string; dir: THREE.Vector3 }> = {
  iso: { label: '立体', dir: new THREE.Vector3(0.62, 0.42, 1).normalize() },
  front: { label: '正面', dir: new THREE.Vector3(0, 0, 1) },
  back: { label: '背面', dir: new THREE.Vector3(0, 0, -1) },
  side: { label: '侧面', dir: new THREE.Vector3(1, 0.001, 0).normalize() },
  // 正上方往下看时 up 向量和视线平行，lookAt 会乱转，所以留一点点 z。
  top: { label: '顶部', dir: new THREE.Vector3(0, 1, 0.001).normalize() },
}

/** 标签在画布上的像素位置，文案由页面按 id 自己配。 */
export interface StageLabel {
  id: string
  x: number
  y: number
  /** 会变的读数（转向节的转角，度），页面拿它填标签文案。 */
  value?: number
}

interface PartSlot {
  obj: THREE.Object3D
  base: THREE.Vector3
  /** 拆开时的位移，LDraw 坐标（root 里），不跟着轴转。 */
  offset: THREE.Vector3
  shaft?: ShaftSlot
}

interface ShaftSlot {
  id: string
  /** 转动的那一层（绕自己的 Z 转）；pivot 是它外面那层，管位置和朝向，不转。 */
  obj: THREE.Group
  pivot: THREE.Group
  angle: number
  label?: number
  /** 标签挂在哪一层：这根轴上最大那个齿轮所在的 z，立体视角下标签才落在那个齿轮上方。 */
  labelZ: number
  /** 标签挂的那一点（root 坐标），load 时按 pivot 的位置/朝向算好。 */
  anchor: THREE.Vector3
}

/** 齿条不挂在轴的组里：每次轴转了按 转角 × 节圆半径 沿 dir（root 坐标）平移。 */
interface RackSlot {
  shaft: ShaftSlot
  dir: THREE.Vector3
  radius: number
  /** 方向盘回正时这根轴的转角，齿条按「转角 - rest」走（见 rackPinion）。 */
  rest: number
  parts: PartSlot[]
  knuckles: KnuckleSlot[]
}

/** 转向节整组绕主销（root 的 Y）转；拉杆不在组里，每次按 knucklePose 重摆。 */
interface KnuckleSlot {
  def: KnuckleDef
  group: THREE.Group
  rod: PartSlot
  delta: number
}

/** 连杆和活塞不挂在轴的组里（它们不跟着轴转），每次轴转了按 crankPose 重摆 base。 */
interface CrankSlot {
  pin: [number, number]
  z: number
  shaft: ShaftSlot
  rod: PartSlot
  piston: PartSlot
}

const PACK_URL = '/mech/parts.mpd'
const FPS = 30
const OUTLINE = 0x1d1d1f
const EXPLODE_MS = 800
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const GHOST_FACE = 0.28
const GHOST_LINE = 0.35
const BOTTOM_PAD = 96 // 视角按钮那一条的高度（px），和 MechViewer 的 .controls 对应

export class MechStage {
  onLabels: (labels: StageLabel[]) => void = () => {}
  onError: (msg: string) => void = () => {}
  /** 拆开 / 合上的动画走完了。 */
  onSettle: (exploded: boolean) => void = () => {}

  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(22, 1, 1, 5000)
  private root = new THREE.Group()
  private shafts: ShaftSlot[] = []
  private meshes: ReturnType<typeof resolveMeshes> = []
  /** 万向节的十字轴：不属于哪根轴，每帧按两个叉口的朝向摆。 */
  private joints: { from: string; to: string; bend: number; cross: PartSlot }[] = []
  private fit: THREE.Vector3[] = []
  private fitOpen: THREE.Vector3[] = []
  private openCenter = new THREE.Vector3()
  private fitCache = { key: '', closed: 1, open: 1 }
  private parts: PartSlot[] = []
  private cranks: CrankSlot[] = []
  private racks: RackSlot[] = []
  /** 所有转向节的组（拆开时组里零件的位移要按组当前的转角反转回去）。 */
  private steered = new Set<THREE.Object3D>()
  /** 来回摆的案例（swing）按这个相位算主动轴转角。 */
  private phase = 0
  // 拆开程度 0 = 装好、1 = 全拆开；target 是按钮要的状态，t0 是这一段动画开始的时刻。
  private explode = { at: 0, from: 0, target: 0, t0: 0 }
  private view: { from: THREE.Vector3; turn: THREE.Quaternion; t0: number } | null = null
  private dir: THREE.Vector3
  private playing = true
  private visible = true
  private raf = 0
  private last = 0
  private disposed = false
  private ro: ResizeObserver
  private io: IntersectionObserver
  private toon = new Map<number, THREE.MeshToonMaterial>()
  private gradient: THREE.DataTexture

  constructor(
    private host: HTMLElement,
    private mech: MechCase,
  ) {
    this.dir = this.viewDir('iso')
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)

    // 三档色阶：亮面 / 过渡 / 暗面。NearestFilter 让色块边缘是硬的，这就是「卡通」的来源。
    const steps = new Uint8Array([150, 205, 255])
    this.gradient = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
    this.gradient.minFilter = this.gradient.magFilter = THREE.NearestFilter
    this.gradient.needsUpdate = true

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(-0.6, 1, 0.9)
    this.scene.add(key)

    // LDraw 的 Y 轴朝下，翻过来。
    this.root.rotation.x = Math.PI
    this.scene.add(this.root)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting
      this.kick()
    })
    this.io.observe(host)
    document.addEventListener('visibilitychange', this.kick)
    this.resize()
  }

  async load() {
    const res = await fetch(PACK_URL)
    const text = res.ok ? await res.text() : ''
    // 文件没部署上去时 SPA fallback 照样回 200 + index.html，解析出来是空场景 —— 一块白、不报错。
    if (!text.startsWith('0 FILE')) {
      throw new Error(`零件包没有加载到（${PACK_URL} 返回 ${res.status}${res.ok ? '，但内容不是 LDraw 文件，多半是没跟着部署上去' : ''}）`)
    }
    const loader = new LDrawLoader()
    loader.setConditionalLineMaterial(LDrawConditionalLineMaterial)
    loader.addDefaultMaterials()
    const pack = await new Promise<THREE.Group>((ok, fail) => loader.parse(text, ok, fail))
    if (this.disposed) return disposeTree(pack)

    // 先核咬合再摆：轴距错了的话齿轮照样转、只是齿穿过齿，看不出来。
    this.meshes = resolveMeshes(this.mech)

    const templates = new Map<string, THREE.Object3D>()
    for (const c of pack.children) templates.set(String(c.userData.fileName).toLowerCase(), c)
    const need = [...new Set(allPlacements(this.mech).map((p) => PARTS[p.part].file))]
    const missing = need.filter((f) => !templates.has(f))
    if (missing.length) throw new Error(`零件包里缺 ${missing.join('、')}，重新跑 scripts/ldraw-pack.mjs`)

    const plan = explodePlan(this.mech)
    // origin：零件挂在转向节组里时组的位置 —— 拆开的位移按零件在 root 里的 z 算，不按它相对主销的 z。
    const make = (p: Placement, def?: ShaftDef, shaft?: ShaftSlot, origin?: readonly number[]) => {
      const obj = this.paint(templates.get(PARTS[p.part].file)!.clone(), COLORS[p.color].hex, p.ghost)
      obj.position.set(...p.at)
      if (p.rot) obj.rotation.set(...p.rot)
      const slot: PartSlot = { obj, base: obj.position.clone(), offset: new THREE.Vector3(...plan(origin ? { ...p, at: [p.at[0] + origin[0], p.at[1] + origin[1], p.at[2] + origin[2]] } : p, def)), shaft }
      this.parts.push(slot)
      return slot
    }
    for (const p of this.mech.fixed) this.root.add(make(p).obj)
    for (const s of this.mech.shafts) {
      // 轴上的零件挂在一个组里一起转；组放在轴心，零件的 x/y 相对轴心。外面再套一层管朝向（竖着的转向柱）。
      const pivot = new THREE.Group()
      pivot.position.set(s.x, s.y, s.z ?? 0)
      if (s.rot) pivot.rotation.set(...s.rot)
      const obj = new THREE.Group()
      pivot.add(obj)
      const big = s.parts
        .filter((p) => 'teeth' in PARTS[p.part])
        .sort((a, b) => (PARTS[b.part] as { teeth: number }).teeth - (PARTS[a.part] as { teeth: number }).teeth)[0]
      const labelZ = s.labelZ ?? big?.at[2] ?? 0
      // 标签在「最大那个齿轮的中心」正上方（root 的 -Y）label 这么高，不管轴是躺着还是立着。
      const anchor = new THREE.Vector3(0, 0, labelZ).applyEuler(pivot.rotation).add(pivot.position)
      if (s.label !== undefined) anchor.y -= s.label
      const slot: ShaftSlot = { id: s.id, obj, pivot, angle: 0, label: s.label, labelZ, anchor }
      for (const p of s.parts) obj.add(make(p, s, slot).obj)
      this.root.add(pivot)
      this.shafts.push(slot)
    }
    for (const j of this.mech.joints ?? []) {
      const cross = make(j.cross)
      this.root.add(cross.obj)
      this.joints.push({ from: j.from, to: j.to, bend: jointBend(this.mech, j), cross })
    }
    for (const k of crankParts(this.mech)) {
      const rod = make(k.rod)
      const piston = make(k.piston)
      this.root.add(rod.obj, piston.obj)
      this.cranks.push({ pin: k.def.pin, z: k.def.z, shaft: this.shafts.find((s) => s.id === k.shaft.id)!, rod, piston })
    }
    checkKnuckles(this.mech)
    for (const r of this.mech.racks ?? []) {
      const { radius, rest } = rackPinion(this.mech, r)
      const shaft = this.shafts.find((s) => s.id === r.shaft)!
      // 齿轮上贴着齿条那一点的线速度方向 = 轴向 × (从中心指向齿条)。
      const axis = new THREE.Vector3(0, 0, 1).applyEuler(shaft.pivot.rotation)
      const dir = axis.cross(new THREE.Vector3(...r.toward)).normalize()
      const parts = r.parts.map((p) => make(p))
      for (const p of parts) this.root.add(p.obj)
      const knuckles = (r.knuckles ?? []).map((def): KnuckleSlot => {
        const group = new THREE.Group()
        group.position.set(...def.pivot)
        for (const p of def.parts) group.add(make(p, undefined, undefined, def.pivot).obj)
        const rod = make(tieRod(def, knucklePose(def, 0)!))
        this.root.add(group, rod.obj)
        return { def, group, rod, delta: 0 }
      })
      this.racks.push({ shaft, dir, radius, rest, parts, knuckles })
      // 齿条走到两头时拉杆还够得着转向臂（两圆还相交）—— 够不着的话那一帧转向节停在上一帧，看不出断了。
      for (const a of [-(this.mech.swing ?? 0), this.mech.swing ?? 0]) {
        for (const k of r.knuckles ?? []) {
          if (!knucklePose(k, dir.x * rackTravel(this.mech, r, a))) throw new Error(`方向盘打到 ${Math.round((a * 180) / Math.PI)}° 时 ${k.id} 的拉杆够不着转向臂`)
        }
      }
    }
    // pack 不释放：克隆出来的零件和它共用同一份几何，释放了下一帧要整份重新上传。

    this.root.updateMatrixWorld(true)
    // 取景用零件的顶点（每块几何抽 ≤150 个；轴上的零件再按转一圈取 8 个方位）。不用包围盒/包围球 ——
    // 齿轮箱这种又长又深的机构，盒子的角、长梁的包围球都远远伸在零件外面，画面里只剩中间一小团。
    // 拆开状态的取景点 = 同一个点 + 这个零件的位移（位移在 root 里，换成世界方向）。两套点都留着，
    // 拆开 / 合上的过程中镜头在两套取景之间插值 —— 只按装好的取景的话，拆开的零件跑出画面。
    const pts: THREE.Vector3[] = []
    const open: THREE.Vector3[] = []
    const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k / 8) * Math.PI * 2)
    const sample = (part: PartSlot, each: (w: THREE.Vector3) => THREE.Vector3[]) => {
      const shift = part.offset.clone().applyQuaternion(this.root.quaternion)
      part.obj.traverse((o) => {
        const pos = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry.getAttribute('position') : null
        if (!pos) return
        const step = Math.max(1, Math.floor(pos.count / 150))
        for (let i = 0; i < pos.count; i += step) {
          for (const q of each(o.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i)))) {
            pts.push(q)
            open.push(q.clone().add(shift))
          }
        }
      })
    }
    const moving = new Set(this.cranks.flatMap((k) => [k.rod, k.piston]))
    const sliding = new Set(this.racks.flatMap((r) => [...r.parts, ...r.knuckles.map((k) => k.rod)]))
    const steered = this.steered
    for (const r of this.racks) for (const k of r.knuckles) steered.add(k.group)
    const inKnuckle = (p: PartSlot) => p.obj.parent !== null && steered.has(p.obj.parent as THREE.Group)
    for (const p of this.parts) if (inKnuckle(p)) sliding.add(p)
    for (const part of this.parts) {
      const top = part.shaft?.obj
      if (moving.has(part) || sliding.has(part)) continue
      sample(part, top ? (w) => ring.map((a) => top.localToWorld(top.worldToLocal(w.clone()).applyAxisAngle(Z_AXIS, a))) : (w) => [w])
    }
    // 连杆和活塞跟着曲轴走：按曲轴转一圈的 8 个位置各摆一次再取点（活塞的上下止点都在里面）。
    for (const a of ring) {
      this.setDrive(a)
      this.root.updateMatrixWorld(true)
      for (const part of moving) sample(part, (w) => [w])
    }
    // 齿条取走到两头和中间三个位置（摆动的案例两头是 ±swing，一直转的案例齿条会走出画面，不支持）。
    const swing = this.mech.swing ?? 0
    for (const a of [-swing, 0, swing]) {
      this.setDrive(a)
      this.root.updateMatrixWorld(true)
      for (const part of sliding) sample(part, (w) => [w])
    }
    this.setDrive(0)
    // 标签也要在画面里：把标签顶上那一点也算进取景（标签约 55px 高，这里按 24 LDU 估）。
    for (const sh of this.shafts) {
      if (sh.label === undefined) continue
      pts.push(this.root.localToWorld(sh.anchor.clone().add(new THREE.Vector3(0, -24, 0))))
    }
    const center = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3())
    this.root.position.sub(center)
    this.root.updateMatrixWorld(true)
    for (const q of pts) q.sub(center)
    for (const q of open) q.sub(center)
    this.fit = pts
    this.fitOpen = open
    this.fitCache.key = '' // resize 可能在 load 之前按空的取景点算过一次
    this.openCenter = new THREE.Box3().setFromPoints(open).getCenter(new THREE.Vector3())
    this.turn(0)
    this.placeCamera()
    this.kick()
  }

  setView(name: ViewName) {
    // 按旋转插值，不按向量线性插值：正面 → 背面两个方向正好相反，线性插值走到一半是零向量，
    // 镜头会瞬间跳到乱七八糟的位置。setFromUnitVectors 对反向的情况会自己挑一根转轴。
    const turn = new THREE.Quaternion().setFromUnitVectors(this.dir.clone().normalize(), this.viewDir(name))
    this.view = { from: this.dir.clone(), turn, t0: performance.now() }
    this.kick()
  }

  private viewDir(name: ViewName) {
    return name === 'iso' && this.mech.iso ? new THREE.Vector3(...this.mech.iso).normalize() : VIEWS[name].dir.clone()
  }

  /** 拆开 / 合上。拆开期间不转（零件都不在轴上了，转起来是一团乱飞）。 */
  setExploded(on: boolean) {
    const target = on ? 1 : 0
    if (this.explode.target === target) return
    this.explode = { at: this.explode.at, from: this.explode.at, target, t0: performance.now() }
    this.last = 0
    this.kick()
  }

  setPlaying(on: boolean) {
    this.playing = on
    this.last = 0
    this.kick()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.io.disconnect()
    document.removeEventListener('visibilitychange', this.kick)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    disposeTree(this.root)
    for (const m of this.toon.values()) m.dispose()
    this.edge.dispose()
    this.cond.dispose()
    this.edgeGhost.dispose()
    this.condGhost.dispose()
    this.gradient.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  // 换成卡通材质 + 统一深色描边。LDraw 自带棱边（type 2）和条件边（type 5，曲面的轮廓线），
  // 两种都要：只有棱边的话齿轮和轴的圆柱面没有外轮廓。
  private edge = new THREE.LineBasicMaterial({ color: OUTLINE })
  private cond = lineMaterial()
  // 半透明零件的描边也跟着淡下去，不然一个透明气缸的棱线比里面的活塞还抢眼。
  private edgeGhost = new THREE.LineBasicMaterial({ color: OUTLINE, transparent: true, opacity: GHOST_LINE })
  private condGhost = lineMaterial(GHOST_LINE)
  private paint(obj: THREE.Object3D, color: number, ghost = false) {
    const mat = this.toonFor(color, ghost)
    obj.traverse((o) => {
      const any = o as THREE.Mesh & { isConditionalLine?: boolean }
      if (any.isConditionalLine) any.material = ghost ? this.condGhost : this.cond
      else if ((o as THREE.LineSegments).isLineSegments) any.material = ghost ? this.edgeGhost : this.edge
      else if (any.isMesh) any.material = mat
    })
    return obj
  }

  private toonFor(hex: number, ghost: boolean) {
    const key = ghost ? -hex - 1 : hex
    let m = this.toon.get(key)
    if (!m) {
      // 提亮一点：卡通色阶会把真实的积木灰压得发闷。色相不动。
      const c = new THREE.Color(hex).offsetHSL(0, 0.04, 0.06)
      m = new THREE.MeshToonMaterial({ color: c, gradientMap: this.gradient })
      // 描边和面贴得太近会闪，面往后推一点。
      m.polygonOffset = true
      m.polygonOffsetFactor = 1
      m.polygonOffsetUnits = 1
      if (ghost) {
        m.transparent = true
        m.opacity = GHOST_FACE
        m.depthWrite = false // 写深度的话里面的活塞被透明面挡住，等于没透明
      }
      this.toon.set(key, m)
    }
    return m
  }

  private turn(delta: number) {
    const [drive] = this.shafts
    if (!drive) return
    if (this.mech.swing) {
      this.phase += delta
      this.setDrive(this.mech.swing * Math.sin(this.phase))
    } else {
      this.setDrive(drive.angle + delta)
    }
  }

  /** 主动轴摆到 a，其余的轴、曲柄、齿条、转向节跟着摆好。同一根轴上的齿轮都是 0° 装上去的，所以轴的转角就是它上面每个齿轮的转角。 */
  private setDrive(a: number) {
    const angles = shaftAngles(this.mech, a, this.meshes)
    for (const s of this.shafts) {
      s.angle = angles.get(s.id) ?? 0
      s.obj.rotation.z = s.angle
    }
    for (const j of this.joints) {
      const { x, y } = jointCross(j.bend, angles.get(j.from)!, angles.get(j.to)!)
      const vx = new THREE.Vector3(...x)
      const vy = new THREE.Vector3(...y)
      j.cross.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vx, vy, vx.clone().cross(vy)))
    }
    this.poseCranks()
    this.poseRacks()
  }

  private poseRacks() {
    const e = this.explode.at
    for (const r of this.racks) {
      const travel = (r.shaft.angle - r.rest) * r.radius
      for (const p of r.parts) {
        p.obj.position.copy(p.base).addScaledVector(r.dir, travel).addScaledVector(p.offset, e)
      }
      for (const k of r.knuckles) {
        const pose = knucklePose(k.def, r.dir.x * travel)
        if (!pose) continue // 加载时已经核过两头，走不到这里
        k.delta = pose.delta
        k.group.rotation.y = pose.delta
        k.rod.base.set(...pose.rodAt)
        k.rod.obj.rotation.y = pose.rodYaw
        k.rod.obj.position.copy(k.rod.base).addScaledVector(k.rod.offset, e)
      }
    }
  }

  private poseCranks() {
    const e = this.explode.at
    for (const k of this.cranks) {
      const pose = crankPose(k.pin, k.shaft.angle)
      const { x, y } = k.shaft.pivot.position
      k.rod.base.set(x + pose.pin[0], y + pose.pin[1], k.z)
      k.rod.obj.rotation.z = pose.rodAngle
      k.piston.base.set(x, y + pose.pistonY, k.z)
      for (const p of [k.rod, k.piston]) p.obj.position.copy(p.base).addScaledVector(p.offset, e)
    }
  }

  private kick = () => {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    const animating = this.playing && this.visible && !document.hidden && this.explode.at === 0 && this.explode.target === 0
    let dirty = false

    const ex = this.explode
    if (ex.at !== ex.target) {
      const t = Math.min(1, (now - ex.t0) / EXPLODE_MS)
      ex.at = t >= 1 ? ex.target : ex.from + (ex.target - ex.from) * easeInOut(t)
      this.placeParts()
      if (!this.view) this.placeCamera()
      dirty = true
      if (ex.at === ex.target) this.onSettle(ex.target === 1)
    }

    if (this.view) {
      const t = Math.min(1, (now - this.view.t0) / 600)
      const e = 1 - Math.pow(1 - t, 3)
      this.dir.copy(this.view.from).applyQuaternion(new THREE.Quaternion().slerp(this.view.turn, e))
      if (t >= 1) this.view = null
      this.placeCamera()
      dirty = true
    }

    if (animating) {
      if (!this.last) this.last = now
      const dt = now - this.last
      if (dt >= 1000 / FPS - 1 || dirty) {
        this.turn((Math.min(dt, 100) / 1000) * this.mech.speed)
        this.last = now
        dirty = true
        if (this.racks.some((r) => r.knuckles.length)) this.emitLabels()
      }
    } else {
      this.last = 0
    }

    if (dirty || !this.rendered) this.render()
    if (animating || this.view || ex.at !== ex.target) this.kick()
  }

  // 轴上的零件挂在转动的组里：位移要换到组的坐标系（朝向 + 当前转角都反转回去），否则往上抽的轴会斜着飞。
  private placeParts() {
    const e = this.explode.at
    const q = new THREE.Quaternion()
    for (const p of this.parts) {
      // 转向节组里的零件同理：拆的时候前轮可能正打着方向，不反转回去的话轮子斜着飞。
      const d = p.shaft
        ? p.offset.clone().applyQuaternion(q.multiplyQuaternions(p.shaft.pivot.quaternion, p.shaft.obj.quaternion).invert())
        : this.steered.has(p.obj.parent as THREE.Group) ? p.offset.clone().applyQuaternion(q.copy(p.obj.parent!.quaternion).invert()) : p.offset
      p.obj.position.copy(p.base).addScaledVector(d, e)
    }
    this.poseRacks()
  }

  private rendered = false
  private render() {
    this.renderer.render(this.scene, this.camera)
    this.rendered = true
  }

  private resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.placeCamera()
    this.rendered = false
    this.kick()
  }

  // 每个取景点在画面上的横/竖偏移都要落在视野里，取要求最远的那个。
  private placeCamera() {
    // 底部那一条留给视角按钮：画面整体往上挪半条，竖直方向可用的高度也扣掉这一条。
    const h = this.host.clientHeight || 1
    const pad = Math.min(BOTTOM_PAD, h / 4)
    if (this.host.clientWidth) this.camera.setViewOffset(this.host.clientWidth, h, 0, pad / 2, this.host.clientWidth, h)
    const v = (this.camera.fov * Math.PI) / 180
    const tanV = (Math.tan(v / 2) * ((h - pad) / h)) / 1.06
    const tanH = (Math.tan(v / 2) * this.camera.aspect) / 1.06
    const dir = this.dir.clone().normalize()
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    right.normalize()
    const up = new THREE.Vector3().crossVectors(dir, right)
    const need = (pts: THREE.Vector3[], c: THREE.Vector3) => {
      const cd = c.dot(dir), cr = c.dot(right), cu = c.dot(up)
      let dist = 1
      for (const q of pts) {
        const d = q.dot(dir) - cd
        dist = Math.max(dist, d + Math.abs(q.dot(right) - cr) / tanH, d + Math.abs(q.dot(up) - cu) / tanV)
      }
      return dist
    }
    // 两套取景的距离只跟视角和画布尺寸有关，拆开动画的每一帧只插值、不重算（点有几万个）。
    const key = `${dir.x.toFixed(5)},${dir.y.toFixed(5)},${dir.z.toFixed(5)},${tanH.toFixed(5)},${tanV.toFixed(5)}`
    if (this.fitCache.key !== key) {
      this.fitCache = { key, closed: need(this.fit, new THREE.Vector3()), open: need(this.fitOpen, this.openCenter) }
    }
    const e = this.explode.at
    const target = new THREE.Vector3().lerp(this.openCenter, e)
    const dist = THREE.MathUtils.lerp(this.fitCache.closed, this.fitCache.open, e)
    this.camera.position.copy(dir).multiplyScalar(dist).add(target)
    this.camera.near = Math.max(1, dist / 20)
    this.camera.far = dist * 4
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    this.emitLabels()
  }

  // 标签挂在轴的正上方（高度由案例给）。按轴心在 root 里的位置算、不按轴自身坐标系
  // （那个跟着转，标签会绕着齿轮跑），所以只在视角/尺寸变化时重算。
  private emitLabels() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    const p = new THREE.Vector3()
    const at = (id: string, anchor: THREE.Vector3, value?: number): StageLabel => {
      this.root.localToWorld(p.copy(anchor))
      p.project(this.camera)
      return { id, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, value }
    }
    this.onLabels([
      ...this.shafts.filter((s) => s.label !== undefined).map((s) => at(s.id, s.anchor)),
      ...this.racks.flatMap((r) => r.knuckles)
        .filter((k) => k.def.label)
        .map((k) => at(k.def.id, new THREE.Vector3(...k.def.label!).add(k.group.position), Math.abs((k.delta * 180) / Math.PI))),
    ])
  }

  private onContextLost = (e: Event) => {
    e.preventDefault()
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.disposed = true
    this.onError('3D 画面中断了（浏览器收回了显卡资源，常见于内存紧张或显卡驱动重置）')
  }
}

// 它的 color 只有 getter，构造参数里的 color 也不认（类型上就不让传），只能改 uniform。
function lineMaterial(opacity = 1) {
  const m = new LDrawConditionalLineMaterial()
  ;(m.uniforms.diffuse.value as THREE.Color).set(OUTLINE)
  if (opacity < 1) {
    m.uniforms.opacity.value = opacity
    m.transparent = true
  }
  return m
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
  })
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
