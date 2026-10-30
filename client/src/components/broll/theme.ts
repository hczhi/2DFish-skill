// 动效卡主题：颜色、字体、装饰线统一在这里，每张卡只管内容和动画。整条视频的卡片因此是同一套风格，
// 换主题 = 所有卡一起换。卡片里只许用这里的 CSS 变量，不写死颜色 / 字体。

export interface BrollTheme {
  id: string
  name: string
  vars: Record<string, string>
  /** 主题里用到的字体（不含兜底）。调试台逐个检测本机有没有 —— 没有的话浏览器悄悄换成别的字体，预览和导出对不上。 */
  fonts: string[]
  /** 文字入场手法：default = 模糊到清晰；depth = 景深（字从镜头前大而虚的地方落位，纸感用） */
  motion: 'default' | 'depth'
}

// 卡片里**除强调色以外的明暗**也走这里（投影、高光、点阵、颗粒、图片位底色、压在强调色上的字色）——
// 写死成暗色的话，浅色主题下米色纸面上会出现一圈很重的黑投影、白色高光看不见，读起来像渲染坏了。
const GRAIN_LIGHT = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`
const GRAIN_DARK = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0 0.1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`

export const THEMES: BrollTheme[] = [
  {
    id: 'ember',
    name: '橙夜',
    vars: {
      '--accent': '#FF8A1F',
      '--fg': '#F5F1EA',
      '--mute': 'rgba(245, 241, 234, 0.55)',
      // 底板不透明度要高：导出是透明叠加层，没有毛玻璃可用（见 CardShell），太透的话叠在人脸上字就花了
      '--panel': 'linear-gradient(155deg, rgba(34, 27, 21, 0.95) 0%, rgba(16, 13, 11, 0.92) 55%, rgba(10, 9, 8, 0.88) 100%)',
      '--line': 'rgba(255, 138, 31, 0.35)',
      '--shadow-c': 'rgba(0, 0, 0, 0.55)',
      '--hi': 'rgba(255, 255, 255, 0.35)',
      '--dot': 'rgba(255, 255, 255, 0.55)',
      '--track': 'rgba(255, 255, 255, 0.12)',
      '--tile': 'linear-gradient(160deg, #2a2420, #15110f)',
      '--ink-on-accent': '#1a1410',
      '--text-shadow': '0 2px 16px rgba(0, 0, 0, 0.55)',
      '--stamp-bg': 'rgba(30, 18, 10, 0.78)',
      '--grain': GRAIN_LIGHT,
      '--grain-blend': 'overlay',
      '--glow-a': '45%',
      // 漂浮符号层的显隐（CardShell 里那层 # * [ ] ~）：暗色主题不要，纸感要
      '--glyph-a': '0',
      // 全屏卡铺的背景
      '--full-bg': 'radial-gradient(ellipse at 50% 40%, #221b15 0%, #0d0b09 70%, #070605 100%)',
      '--font-cn': '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      '--font-mono': '"JetBrains Mono", "SF Mono", Menlo, monospace',
    },
    fonts: ['PingFang SC', 'Noto Sans SC', 'JetBrains Mono', 'SF Mono', 'Menlo'],
    motion: 'default',
  },
  {
    // 纸感编辑风：米白纸面、墨色字、焦橙强调、衬线字；光晕收得很淡（纸面上发光像一团污渍）
    id: 'paper',
    name: '纸感',
    vars: {
      '--accent': '#D9622B',
      '--fg': '#2A221C',
      '--mute': 'rgba(42, 34, 28, 0.55)',
      '--panel': 'linear-gradient(155deg, rgba(253, 250, 244, 0.97) 0%, rgba(246, 240, 231, 0.95) 60%, rgba(239, 231, 219, 0.94) 100%)',
      '--line': 'rgba(217, 98, 43, 0.28)',
      '--shadow-c': 'rgba(92, 62, 32, 0.26)',
      '--hi': 'rgba(255, 255, 255, 0.85)',
      '--dot': 'rgba(70, 48, 28, 0.35)',
      '--track': 'rgba(42, 34, 28, 0.10)',
      '--tile': 'linear-gradient(160deg, #ffffff, #f0e9df)',
      '--ink-on-accent': '#ffffff',
      '--text-shadow': '0 2px 12px rgba(255, 250, 240, 0.8)',
      '--stamp-bg': 'rgba(255, 244, 232, 0.9)',
      '--grain': GRAIN_DARK,
      '--grain-blend': 'multiply',
      '--glow-a': '16%',
      '--glyph-a': '1',
      '--full-bg': 'radial-gradient(ellipse at 50% 40%, #fdf9f2 0%, #f1e8db 70%, #e6dccd 100%)',
      '--font-cn': '"Fraunces", "Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
      '--font-mono': '"JetBrains Mono", "SF Mono", Menlo, monospace',
    },
    fonts: ['Fraunces', 'Noto Serif SC', 'Songti SC', 'STSong', 'Georgia', 'JetBrains Mono', 'SF Mono', 'Menlo'],
    motion: 'depth',
  },
]

export const themeById = (id: string) => THEMES.find((t) => t.id === id) || THEMES[0]

// 字体在不在：同一串字分别用「这个字体, 兜底」和「兜底」量宽度，两种兜底下都一样宽 = 根本没用上这个字体。
// document.fonts.check 对本机没有的字体也回 true（它只回答「要不要等加载」），不能用。
export function hasFont(family: string): boolean {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return false
  const probe = 'mmmwwwiii 0123 汉字测试 WHO IS'
  return ['monospace', 'serif'].some((fb) => {
    c.font = `72px ${fb}`
    const base = c.measureText(probe).width
    c.font = `72px "${family}", ${fb}`
    return c.measureText(probe).width !== base
  })
}
