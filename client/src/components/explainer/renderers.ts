import { type Plan, type StyleId } from './scene'
import { createWhiteboard } from './whiteboard'
import { createBlueprint } from './blueprint'
import { createSketch } from './sketch'

// 风格 → 渲染器只在这一处：播放器和导出渲染页都调它。
// 以前两处各写「是蓝图就蓝图、否则白板」，加了新风格只改一处的话另一处悄悄画成白板 —— 预览对、导出错（或反过来），导出照样「成功」。
const RENDERERS: Record<StyleId, (canvas: HTMLCanvasElement, plan: Plan) => { render: (t: number) => void; dispose: () => void }> = {
  whiteboard: createWhiteboard,
  blueprint: createBlueprint,
  sketch: createSketch,
}
export const createRenderer = (style: StyleId, canvas: HTMLCanvasElement, plan: Plan) => RENDERERS[style](canvas, plan)
