import { type Pt, clamp, lengths, smooth } from './geometry'
import { type Plan, HAND_FONT, TB_W, TB_H, cameraAt } from './scene'

// 蓝图 / 工程制图的渲染器：WebGL2 着色器在「图纸坐标」里实时算蓝晒纸（任何缩放都清晰），白线画在墨水层上再合成。
// 只有蓝和白两种颜色；线宽 = 线型 × zoom^0.65（特写不变成香肠、全景不消失）；镜头在镜与镜之间硬切。

const W = 1920, H = 1080
const WEIGHT = { out: 3.6, det: 2.3, thin: 1.5, hair: 1.05 }
const CENTRE = [70, 14, 12, 14]

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uInk, uOver; uniform vec2 uRes, uSheet; uniform vec3 uCam; out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + 1.), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y), uv = fc / uRes, px = 1. / uRes;
  vec2 p = (fc - uRes * .5) / uCam.z + uCam.xy; float pix = 1. / uCam.z;
  float n = fbm(p * .0014), n2 = fbm(p * .0062 + 3.);
  vec3 col = mix(vec3(.082, .19, .40), vec3(.17, .35, .66), .38 + .34 * smoothstep(.2, .8, n * .75 + n2 * .35));
  col *= .93 + .11 * noise(vec2(p.x * .0007, p.y * .028));
  col *= .97 + .05 * noise(vec2(p.x * .02, p.y * .0012) + 9.);
  col += .028 * smoothstep(.72, .96, noise(p * vec2(.045, .3) + n * 9.)) - .02 * smoothstep(.75, .98, noise(p * vec2(.3, .05) + 4.));
  float sp = hash(floor(p / 3.5)); col += (sp > .9975 ? .10 : 0.) - (sp < .0015 ? .07 : 0.);
  float dx = p.x - uSheet.x * .5 + 7. * (noise(vec2(p.y * .006, 1.)) - .5), dy = p.y - uSheet.y * .52 + 7. * (noise(vec2(p.x * .006, 5.)) - .5);
  col += .085 * exp(-pow((dx - 3.) / 3.5, 2.)) - .06 * exp(-pow((dx + 5.) / 6., 2.)) + .035 * exp(-pow(dx / 45., 2.));
  col += .075 * exp(-pow((dy - 3.) / 3.5, 2.)) - .05 * exp(-pow((dy + 5.) / 6., 2.)) + .03 * exp(-pow(dy / 45., 2.));
  vec2 e = min(p, uSheet - p); float ed = min(e.x, e.y);
  col = mix(col, vec3(.40, .55, .74), (1. - smoothstep(0., 90. + 160. * fbm(p * .008), ed)) * .55);
  float ink = texture(uInk, uv).r * .52 + (texture(uInk, uv + vec2(px.x, 0)).r + texture(uInk, uv - vec2(px.x, 0)).r + texture(uInk, uv + vec2(0, px.y)).r + texture(uInk, uv - vec2(0, px.y)).r) * .12;
  ink *= .8 + .2 * smoothstep(.15, .6, noise(p * .35) * .7 + noise(p * 1.3) * .3);
  col = mix(col, vec3(.906, .941, .976), clamp(ink * .96, 0., 1.));
  vec2 aa = smoothstep(-pix, pix, p) * smoothstep(-pix, pix, uSheet - p); float inside = aa.x * aa.y;
  vec2 q = p - vec2(-28., 40.), d = max(max(-q, q - uSheet), 0.); float sh = exp(-length(d) / 70.) * step(.0001, length(d)) + step(length(d), .0001);
  vec3 table = vec3(.050, .066, .086) * (.82 + .3 * fbm(p * .015)) * (.94 + .06 * sin(p.x * .7) * sin(p.y * .7));
  table *= 1. - .7 * sh;
  col = mix(table, col, inside);
  vec4 ov = texture(uOver, uv); col = col * (1. - ov.a) + ov.rgb;
  vec2 c = uv - .5; col *= 1. - .42 * dot(c, c);
  o = vec4(col, 1.);
}`

export function createBlueprint(canvas: HTMLCanvasElement, plan: Plan) {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })
  if (!gl) throw new Error('这个浏览器不支持 WebGL2，蓝图风格画不出来（换 Chrome / Edge / Safari 新版）')
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s }
  const pr = gl.createProgram()!
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0, 1); }')); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr)
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || 'link')
  gl.useProgram(pr)
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const tex = ['uInk', 'uOver'].map((name, i) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.uniform1i(gl.getUniformLocation(pr, name), i)
    return t
  })
  const u = (n: string) => gl.getUniformLocation(pr, n)

  const ink = new OffscreenCanvas(W, H), ic = ink.getContext('2d')!
  const over = new OffscreenCanvas(W, H), oc = over.getContext('2d')!
  const items = plan.strokes.map((s) => ({ s, cum: lengths(s.pts), box: box(s.pts) }))
  const SW = plan.width, SH = plan.height

  // 预印的图框、标题栏
  function preprinted(lw: (w: number) => number) {
    ic.lineWidth = lw(WEIGHT.hair); ic.strokeRect(60, 60, SW - 120, SH - 120)
    ic.lineWidth = lw(WEIGHT.det); ic.strokeRect(90, 90, SW - 180, SH - 180)
    const bx = SW - 90 - TB_W, by = SH - 90 - TB_H
    ic.strokeRect(bx, by, TB_W, TB_H)
    ic.lineWidth = lw(WEIGHT.thin); ic.beginPath(); ic.moveTo(bx, by + TB_H / 2); ic.lineTo(bx + TB_W, by + TB_H / 2); ic.moveTo(bx + 240, by); ic.lineTo(bx + 240, by + TB_H); ic.moveTo(bx + 900, by + TB_H / 2); ic.lineTo(bx + 900, by + TB_H); ic.stroke()
    // 标题栏里的字由编译时的笔画写（0 秒前就写好），这里只有不带中文的那一格
    ic.fillStyle = '#fff'; ic.font = `40px ${HAND_FONT}`; ic.fillText(`SHEET 1 / 1   ${plan.regions.length} FIG.`, bx + 930, by + 245)
  }
  function nib(x: number, y: number) {
    const g = oc.createRadialGradient(x, y, 0, x, y, 18); g.addColorStop(0, 'rgba(235,245,255,0.95)'); g.addColorStop(0.25, 'rgba(200,225,255,0.45)'); g.addColorStop(1, 'rgba(160,200,255,0)')
    oc.fillStyle = g; oc.beginPath(); oc.arc(x, y, 18, 0, 7); oc.fill()
  }

  function render(t: number) {
    const c = cameraAt(plan.camera, t), z = c.z, m: [number, number, number, number, number, number] = [z, 0, 0, z, W / 2 - c.x * z, H / 2 - c.y * z]
    const lw = (w: number) => (w * Math.pow(z, 0.65)) / z
    const view = [-m[4] / z, -m[5] / z, (W - m[4]) / z, (H - m[5]) / z]
    const heads: Pt[] = []
    ic.setTransform(1, 0, 0, 1, 0, 0); ic.fillStyle = '#000'; ic.fillRect(0, 0, W, H); ic.setTransform(...m)
    ic.strokeStyle = '#fff'; ic.lineCap = 'round'; ic.lineJoin = 'round'
    preprinted(lw)
    for (const { s, cum, box: b } of items) {
      if (t <= s.t0 || b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) continue
      const L = cum[cum.length - 1], len = t >= s.t1 ? L : L * smooth((t - s.t0) / (s.t1 - s.t0))
      ic.lineWidth = s.letterH ? Math.max(lw(WEIGHT.thin), s.letterH * 0.055) : lw(WEIGHT[s.weight] * (s.tone === 'accent' ? 1.35 : 1))
      ic.setLineDash(s.dash === 'centre' ? CENTRE : [])
      if (L < 3) { ic.beginPath(); ic.arc(s.pts[0][0], s.pts[0][1], ic.lineWidth * 0.7, 0, 7); ic.fillStyle = '#fff'; ic.fill(); continue }
      ic.beginPath(); ic.moveTo(s.pts[0][0], s.pts[0][1]); let head = s.pts[0]
      for (let i = 1; i < s.pts.length; i++) {
        if (cum[i] <= len) { ic.lineTo(s.pts[i][0], s.pts[i][1]); head = s.pts[i]; continue }
        const k = (len - cum[i - 1]) / (cum[i] - cum[i - 1]); head = [s.pts[i - 1][0] + (s.pts[i][0] - s.pts[i - 1][0]) * k, s.pts[i - 1][1] + (s.pts[i][1] - s.pts[i - 1][1]) * k]; ic.lineTo(head[0], head[1]); break
      }
      ic.stroke()
      if (len < L) heads.push(head)
    }
    ic.setLineDash([])
    for (const x of plan.texts) {
      if (t <= x.t0) continue
      const k = clamp((t - x.t0) / (x.t1 - x.t0), 0, 1)
      ic.font = `${x.size}px ${HAND_FONT}`
      const w = ic.measureText(x.text).width
      ic.save(); if (k < 1) { ic.beginPath(); ic.rect(x.x - 4, x.y - x.size * 1.2, (w + 8) * k, x.size * 1.6); ic.clip(); heads.push([x.x + w * k, x.y - x.size * 0.35]) }
      ic.fillStyle = '#fff'; ic.fillText(x.text, x.x, x.y); ic.restore()
    }
    oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, W, H)
    for (const [x, y] of heads) nib(x * z + m[4], y * z + m[5])

    gl!.viewport(0, 0, W, H)
    ;[ink, over].forEach((cv, i) => { gl!.activeTexture(gl!.TEXTURE0 + i); gl!.bindTexture(gl!.TEXTURE_2D, tex[i]); gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, i === 1); gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, cv) })
    gl!.uniform2f(u('uRes'), W, H); gl!.uniform2f(u('uSheet'), SW, SH); gl!.uniform3f(u('uCam'), c.x, c.y, z)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }
  return {
    render,
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext() },
  }
}

function box(pts: Pt[]) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y) }
  return [a - 20, b - 20, c + 20, d + 20]
}
