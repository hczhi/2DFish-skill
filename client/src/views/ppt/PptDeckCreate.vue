<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiGet, apiPost } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const router = useRouter()
const creating = ref(false)
const err = ref('')

/** 和服务端 planService.MAX_OUTLINE_CHARS / deckStore.MAX_DECK_OUTLINE_CHARS 一致（超了只拒不截）。 */
const MAX_OUTLINE = 12000

const form = ref({ title: '', outline: '', brandCn: '', brandEn: '', styleId: '' })

/**
 * 设计规范（096：配色 / 字体 / 疏密）。**在这里就定**：先生成十几页再去设置里改的话，
 * 那几页当时是按默认那套排的 —— 虽然改规范会当场跟着变（靠 `:root` 覆盖），但模型挑颜色
 * 搭配时参考的是那一套，出来的每一页各自都好看。
 * 清单从 `GET /api/ppt/design-options` 来，**不在前端写死**：库里加了一套配色它不出现，
 * 删了一套的话他挑到一个存不进去的 id（保存时才 400，那一刻看起来像网络问题）。
 */
interface DesignOpt { id: string; name: string; hint: string }
const designOpts = ref<{ palettes: DesignOpt[]; fonts: DesignOpt[]; densities: DesignOpt[]; headers: DesignOpt[] }>(
  { palettes: [], fonts: [], densities: [], headers: [] }
)
const design = ref({ palette: '', font: '', density: '', header: '' })
const hintOf = (list: DesignOpt[], id: string) => list.find(x => x.id === id)?.hint || ''

/** 名字留空就用提纲第一行（服务端同一口径）—— 界面上要把这件事说出来，
 *  不说的话列表里会出现一份他没起过名的稿子，读起来像别人建的。 */
const titlePreview = computed(
  () => form.value.title.trim() || form.value.outline.trim().split('\n')[0]?.trim().slice(0, 80) || ''
)

/**
 * 配图画风清单从 `GET /api/ppt/styles` 来，**不在前端写死** —— md 里加了一套之后
 * 界面上完全看不见，而后端照旧认它（读起来像「就这几种」）。
 * 拿不到清单不挡新建：画风留空，进工作台之后还能改。
 */
interface StyleItem { id: string; name: string; applicable: string }
const styleList = ref<StyleItem[]>([])

onMounted(async () => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '新建演示稿需要登录')
    return
  }
  try {
    const data = await apiGet<{ styles: StyleItem[]; defaultStyleId: string }>('/api/ppt/styles')
    styleList.value = data.styles || []
    form.value.styleId = data.defaultStyleId || data.styles?.[0]?.id || ''
  } catch {
    // 画风拿不到就留空，进工作台再选（服务端生图时有自己的默认那套）
  }
  try {
    const d = await apiGet<{
      palettes: DesignOpt[]; fonts: DesignOpt[]; densities: DesignOpt[]; headers: DesignOpt[]
      default: { palette: string; font: string; density: string; header: string }
    }>('/api/ppt/design-options')
    designOpts.value = { palettes: d.palettes, fonts: d.fonts, densities: d.densities, headers: d.headers }
    design.value = { ...d.default }
  } catch {
    // 拿不到就整段不传（服务端用默认那套），不挡新建 —— 进工作台还能改。
  }
})

async function create() {
  if (!titlePreview.value) { err.value = '请填名字，或者先贴一份提纲（第一行会当名字）'; return }
  if (form.value.outline.length > MAX_OUTLINE) {
    err.value = `提纲最多 ${MAX_OUTLINE} 字，当前 ${form.value.outline.length} 字 —— 请自己删减（不会自动截断）`
    return
  }
  creating.value = true
  err.value = ''
  try {
    const res = await apiPost<{ deck: { id: string } }>('/api/ppt/decks', {
      title: form.value.title.trim() || undefined,
      outline: form.value.outline,
      brandCn: form.value.brandCn.trim() || undefined,
      brandEn: form.value.brandEn.trim() || undefined,
      styleId: form.value.styleId || undefined,
      // 四项缺一项服务端就 400（缺的那项会悄悄回到默认），所以要么整段传、要么不传。
      design: design.value.palette && design.value.font && design.value.density && design.value.header
        ? design.value : undefined,
    })
    router.push(`/ppt/decks/${res.deck.id}`)
  } catch (e: any) {
    err.value = e?.message || '创建失败'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="page-wrapper">
    <SiteHeader />

    <div class="create-layout">
      <div class="bg-elements">
        <div class="bg-overlay"></div>
        <div class="grid-bg"></div>
      </div>

      <header class="hero">
        <div class="hero-main">
          <div class="hero-content">
            <div class="hero-kicker">
              <span class="kicker-line"></span>
              <span class="kicker-text">NEW DECK</span>
            </div>
            <h1>新建 HTML 展示稿</h1>
          </div>
          <button class="btn-back-icon" @click="router.push('/ppt/decks')" title="返回列表">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
        </div>
      </header>

      <main class="create-page">
        <div class="create-container">
          <div v-if="err" class="alert">{{ err }}</div>

          <div class="create-card">
            <label class="field">
              <span class="label">
                演示稿名字
                <em v-if="!form.title.trim() && titlePreview">留空就用「{{ titlePreview }}」</em>
              </span>
              <input v-model="form.title" type="text" placeholder="例：云启数科 · AI 转型方案汇报" maxlength="80" />
            </label>

            <label class="field">
              <span class="label">
                提纲
                <em :class="{ over: form.outline.length > MAX_OUTLINE }">
                  {{ form.outline.length }} / {{ MAX_OUTLINE }}
                </em>
              </span>
              <textarea
                v-model="form.outline"
                rows="16"
                placeholder="一行一条，带层级最好，例如：

云启数科 · AI 转型方案汇报
一、为什么现在做
  1. 行业三个变化：算力降本 / 政策 / 客户预期
  2. 我们的现状：三条业务线、两个痛点
二、我们怎么做
  1. 三阶段路径（试点 → 复制 → 平台化）
  2. 组织与人才
三、投入与回报
  1. 预算拆分
  2. 12 个月里程碑
四、下一步"
              ></textarea>
              <span class="hint">
                提纲现在就能存着，规划下一步再点（规划是一次真实 AI 调用）。
                超过 {{ MAX_OUTLINE }} 字会被拒绝而不是自动截断 —— 悄悄砍掉后半段的话，
                规划出来的那份「完整」规划里压根没有后面那几页，界面上看不出少了什么。
              </span>
            </label>

            <div class="row-fields">
              <label class="field small">
                <span class="label">品牌中文名（可空）</span>
                <input v-model="form.brandCn" type="text" placeholder="示例企业" maxlength="24" />
              </label>
              <label class="field small">
                <span class="label">英文名</span>
                <input v-model="form.brandEn" type="text" placeholder="SAMPLE" maxlength="24" />
              </label>
              <label class="field small">
                <span class="label">配图画风</span>
                <select v-model="form.styleId">
                  <option value="">（用默认那套）</option>
                  <option v-for="s in styleList" :key="s.id" :value="s.id">{{ s.id }} {{ s.name }}</option>
                </select>
              </label>
            </div>
            <div v-if="designOpts.palettes.length" class="row-fields">
              <label class="field small">
                <span class="label">配色</span>
                <select v-model="design.palette">
                  <option v-for="o in designOpts.palettes" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
                <span class="hint">{{ hintOf(designOpts.palettes, design.palette) }}</span>
              </label>
              <label class="field small">
                <span class="label">字体</span>
                <select v-model="design.font">
                  <option v-for="o in designOpts.fonts" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
                <span class="hint">{{ hintOf(designOpts.fonts, design.font) }}</span>
              </label>
              <label class="field small">
                <span class="label">疏密</span>
                <select v-model="design.density">
                  <option v-for="o in designOpts.densities" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
                <span class="hint">{{ hintOf(designOpts.densities, design.density) }}</span>
              </label>
              <label class="field small">
                <span class="label">页眉</span>
                <select v-model="design.header">
                  <option v-for="o in designOpts.headers" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
                <span class="hint">{{ hintOf(designOpts.headers, design.header) }}</span>
              </label>
            </div>
            <span class="hint">
              这四项是整份的<b>设计规范</b>：所有页面统一。之后在工作台的「提纲与设置」里还能改，
              <b>改完已经生成的页会跟着变</b>（不用重新生成、不花钱）—— 案例库里的颜色和间距从此只算参考。
            </span>
            <span class="hint">
              品牌名只影响 deck 外壳（封面和页脚那几个占位符），逐页 HTML 里没有它。
              画风到生图那一步才用得上，整份 deck 只能一套 —— 配了几页图再回头换的话，
              前面那几页不会自动重做。
            </span>

            <div class="create-actions">
              <button class="btn-primary" :disabled="creating" @click="create">
                {{ creating ? '创建中…' : '创建并开始规划' }}
              </button>
              <!-- 这句话是硬的：进去会**自动**跑一次规划（一次真实调用）。写成「不花额度」
                   的话他会连着建三份试试看，而那是三次调用，界面上一句提示都没有。 -->
              <span class="muted">
                创建后进工作台会<b>自动规划一次</b>（一次真实 AI 调用，通常 10–40 秒）。
                规划结果存着，之后每次进来都直接用，不会重复花钱。
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>

    <SiteFooter />
  </div>
</template>

<style scoped>
/* 和 /consult 的新建页同一套（深色玻璃卡 + 品牌黄），改一边要一起改。 */
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;
  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --color-soft: rgba(255, 255, 255, 0.6);
  --bg-color: #12182B;

  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-color);
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.create-layout { flex: 1; position: relative; display: flex; flex-direction: column; padding-top: 30px; }

.bg-elements {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image: url('https://file.qiaonan.vip/uploads/2026/09/03/01bf04c8-8d07-4af2-b94a-4261ee342576.png');
  background-size: cover; background-position: center;
}
.bg-overlay {
  position: absolute; inset: 0;
  background: rgba(18, 24, 43, 0.65);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px; z-index: 1;
}

.hero { position: relative; z-index: 1; padding: 40px 4vw 48px; }
.hero-main { max-width: 1000px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
.hero-content { flex: 1; }
.hero-kicker { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.kicker-line { width: 48px; height: 2px; background: var(--brand-yellow); }
.kicker-text { font-family: var(--font-mono); font-size: 14px; font-weight: 700; letter-spacing: 0.2em; color: var(--brand-yellow); }
.hero h1 { font-size: 36px; font-weight: 800; letter-spacing: -0.04em; margin: 0; line-height: 1.1; }

.create-page { position: relative; z-index: 1; flex: 1; padding: 0 4vw 80px; }
.create-container { width: 100%; max-width: 1000px; margin: 0 auto; }

.btn-back-icon {
  width: 48px; height: 48px; border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-back-icon:hover { background: var(--brand-yellow); color: #000; transform: translateY(-2px); }

.btn-primary {
  display: inline-flex; align-items: center; gap: 12px;
  background: var(--brand-yellow); color: #111;
  padding: 14px 28px; font-size: 15px; font-weight: 700;
  border: none; border-radius: 999px; cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--font-sans);
}
.btn-primary:hover { background: var(--brand-yellow-hover); transform: translateY(-2px); }
.btn-primary:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }

.alert {
  margin-bottom: 24px; padding: 12px 16px; border-radius: 12px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.3);
  color: #FCA5A5; font-size: 14px; backdrop-filter: blur(10px);
}

.create-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px; padding: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.field { display: block; margin-bottom: 32px; }
.field.small { margin-bottom: 0; flex: 1; min-width: 180px; }
.row-fields { display: flex; gap: 16px; flex-wrap: wrap; }
.label { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.label em { font-style: normal; color: var(--color-soft); font-family: var(--font-mono); font-weight: 400; }
.label em.over { color: #FCA5A5; }
.field input, .field textarea, .field select {
  width: 100%; box-sizing: border-box; padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px;
  font-size: 15px; font-family: var(--font-sans); color: var(--text-primary);
  background: rgba(0, 0, 0, 0.2); resize: vertical; line-height: 1.8;
  transition: all 0.2s;
}
.field select option { color: #111; }
.field input::placeholder, .field textarea::placeholder { color: rgba(255, 255, 255, 0.3); }
.field input:focus, .field textarea:focus, .field select:focus {
  outline: none; border-color: var(--brand-yellow);
  box-shadow: 0 0 0 4px rgba(255, 184, 0, 0.1);
  background: rgba(0, 0, 0, 0.4);
}
.hint { display: block; margin-top: 12px; font-size: 13px; line-height: 1.7; color: var(--color-soft); }

.create-actions {
  display: flex; gap: 24px; align-items: center; flex-wrap: wrap;
  margin-top: 40px; padding-top: 28px; border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.muted { font-size: 13px; color: var(--color-soft); line-height: 1.6; flex: 1; min-width: 280px; }

@media (max-width: 820px) {
  .hero { padding: 40px 20px 32px; }
  .hero-main { flex-direction: column; align-items: flex-start; gap: 24px; }
  .create-page { padding: 0 20px 48px; }
  .create-card { padding: 22px; }
  .create-actions { flex-direction: column; align-items: stretch; }
}
</style>
