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

/**
 * 品牌名 + 那四项设计规范折进「高级设置」：它们**事后都能免费改**（配色/字体/疏密/页眉靠
 * `assembleDeck` 注 `:root` 覆盖生效，改完已经生成的十几页刷新就跟着变），放在建稿前是纯负担。
 * 留在外面的只有配图画风 —— 那一项事后换**不会**重做已经配好的图（每张都是真花过钱的）。
 *
 * 折起来那一行必须写出**现在生效的是哪几套**：不写的话「我还没设置过」和「默认那套已经在
 * 用了」在屏幕上是同一个样子，他会以为这份稿子还没有配色，而它已经按想象橙排好十几页了。
 */
const advOpen = ref(false)
const shortName = (list: DesignOpt[], id: string) =>
  (list.find(x => x.id === id)?.name || '').replace(/（默认）$/, '')
const advSummary = computed(() => {
  const o = designOpts.value
  const d = design.value
  const parts = [
    shortName(o.palettes, d.palette) && `配色 ${shortName(o.palettes, d.palette)}`,
    shortName(o.fonts, d.font) && `字体 ${shortName(o.fonts, d.font)}`,
    shortName(o.densities, d.density) && `疏密 ${shortName(o.densities, d.density)}`,
    shortName(o.headers, d.header) && `页眉 ${shortName(o.headers, d.header)}`,
  ].filter(Boolean) as string[]
  const brand = form.value.brandCn.trim() || form.value.brandEn.trim()
  if (brand) parts.push(`品牌 ${brand}`)
  // 清单没拿到（`/design-options` 挂了）时这里是空的 —— 说「按默认那套」而不是留空：
  // 留空的话它和「这几项没配」长得一样，而服务端确实会用默认那套排完整份。
  return parts.length ? parts.join(' · ') : '按默认那套'
})

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

/**
 * 「生成提纲」那个对话页和这一屏之间的两把钥匙（sessionStorage）。
 *
 * ① `DRAFT_KEY`：跳过去之前把**整张表单**存下来，回来再填回去。不存的话他填好名字、
 *    挑好画风和那四项规范，去生成一趟提纲回来全是空的 —— 而页面上一句话都不说。
 * ② `PICKED_KEY`：对话页里他点「用这份提纲」带回来的那一份。读完**立刻删**：不删的话
 *    下一次新建（同一个标签页里）会被上一次那份提纲填满，他会以为自己贴过。
 */
const DRAFT_KEY = 'ppt:new-draft'
const PICKED_KEY = 'ppt:outline-picked'

/** 被 AI 那份换掉之前框里那一份（撤销用）。整份替换不给撤的话他手里那份就没了。 */
const outlineBefore = ref<string | null>(null)
const outlineNote = ref('')

function stashDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form.value, design: design.value }))
  } catch {
    // 存不下就算了：这一屏的内容会丢，但下面那句提示已经写着「填的会带过去」——
    // 所以这里要把那句话改掉，不能让他以为带过去了。
    err.value = '浏览器拒绝了本地暂存，这一屏填的内容不会带到生成提纲那一页（回来要重新填）。可以先把已填的复制一份。'
  }
}

/** 去生成提纲（先把这一屏存下来）。 */
function goOutlineChat() {
  stashDraft()
  router.push('/ppt/decks/new/outline')
}

function undoOutline() {
  if (outlineBefore.value === null) return
  form.value.outline = outlineBefore.value
  outlineBefore.value = null
  outlineNote.value = '已经恢复成你原来那份提纲。'
}

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
  // **必须在上面那两个 await 之后**：`design.value = { ...d.default }` 会把恢复出来的
  // 那几项盖回默认（他挑的配色/字体静默变回默认，而页面上那一行折叠摘要写着默认那套，
  // 看不出他挑过别的）。
  restoreDraft()
})

/** 从对话页回来：填回整张表单，再把他带回来的那份提纲放进框里（两件事都要出声）。 */
function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (raw) {
      sessionStorage.removeItem(DRAFT_KEY)
      const d = JSON.parse(raw)
      if (d && typeof d === 'object') {
        // 一项项填（整个对象赋过去的话，`design` 会被带进 form 里跟着 POST 上去 ——
        // 服务端那边不认这个键，而请求看起来是成功的）。
        for (const k of ['title', 'outline', 'brandCn', 'brandEn', 'styleId'] as const) {
          if (typeof d[k] === 'string') form.value[k] = d[k]
        }
        if (d.design && typeof d.design === 'object') design.value = { ...design.value, ...d.design }
      }
    }
  } catch {
    // 存的那份坏了就当没有（他会看到一张空表单，但那本来就是没存成的后果）
  }
  try {
    const picked = sessionStorage.getItem(PICKED_KEY)
    if (!picked) return
    sessionStorage.removeItem(PICKED_KEY)
    const had = form.value.outline.trim()
    outlineBefore.value = had ? form.value.outline : null
    form.value.outline = picked
    outlineNote.value = had
      // 整份换掉这件事**必须说**：他框里原来那份是自己一行行写的，不说的话他只会觉得
      // 「提纲变长了」，而自己写的那几行已经不在了。
      ? `提纲框里原来那份（${had.length} 字）已经被 AI 生成的这份（${picked.length} 字）整份替换。`
      : `已经把 AI 生成的那份提纲（${picked.length} 字）填进来了 —— 可以直接在下面改。`
  } catch {
    // 读不到就当他没带回来（对话页那边存不进去时已经报过一次）
  }
}

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

              <!-- 没提纲可写的时候这一屏是走不下去的，所以这个入口摆在框上面、显眼。
                   它会**离开这一屏**（这一屏填的内容存在 sessionStorage 里带过去）。 -->
              <div class="outline-ai">
                <button type="button" class="btn-outline-ai" @click="goOutlineChat">
                  ✨ 生成提纲
                </button>
                <span class="outline-ai-hint">
                  不知道怎么写？和 AI 聊几句（可以上传资料），它出一份提纲，确认后自动填进下面这个框。
                  对话每发一句是一次真实 AI 额度。
                </span>
              </div>
              <p v-if="outlineNote" class="outline-note">
                {{ outlineNote }}
                <button v-if="outlineBefore !== null" type="button" class="link-btn" @click="undoOutline">撤销，换回我原来那份</button>
              </p>

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

            <!-- 画风留在外面：它是这一屏唯一**事后改会花钱**的选项（换了不会重做已配好的图）。 -->
            <div class="row-fields row-one">
              <label class="field small">
                <span class="label">配图画风</span>
                <select v-model="form.styleId">
                  <option value="">（用默认那套）</option>
                  <option v-for="s in styleList" :key="s.id" :value="s.id">{{ s.id }} {{ s.name }}</option>
                </select>
                <span class="hint">
                  整份 deck 只能一套，到生图那一步才用得上 —— <b>配了几页图再回头换的话，前面那几页
                  不会自动重做</b>（那几张是真花过钱的），所以这一项在这里定。
                </span>
              </label>
            </div>

            <div class="adv">
              <button class="adv-toggle" type="button" @click="advOpen = !advOpen">
                <span class="adv-title">{{ advOpen ? '收起高级设置' : '高级设置' }}</span>
                <em v-if="!advOpen">{{ advSummary }}</em>
                <i class="adv-caret" :class="{ open: advOpen }">›</i>
              </button>

              <div v-if="advOpen" class="adv-body">
                <div class="row-fields">
                  <label class="field small">
                    <span class="label">品牌中文名（可空）</span>
                    <input v-model="form.brandCn" type="text" placeholder="示例企业" maxlength="24" />
                  </label>
                  <label class="field small">
                    <span class="label">英文名</span>
                    <input v-model="form.brandEn" type="text" placeholder="SAMPLE" maxlength="24" />
                  </label>
                </div>
                <span class="hint">
                  品牌名只影响 deck 外壳（封面和页脚那几个占位符），逐页 HTML 里没有它。
                </span>

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
                  这四项是整份的<b>设计规范</b>：所有页面统一。<b>之后在工作台的「提纲与设置」里改完，
                  已经生成的页会跟着变</b>（不用重新生成、不花钱）—— 所以这里拿不定主意就先用默认那套。
                </span>
              </div>
            </div>

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
/* 单个字段的那一排别铺满 1000px（一个孤零零的全宽下拉读起来像出了什么问题） */
.row-one { max-width: 360px; }

.adv { margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.adv-toggle {
  display: flex; align-items: baseline; gap: 12px; width: 100%;
  background: none; border: none; padding: 0; cursor: pointer; text-align: left;
  color: var(--text-primary); font-family: var(--font-sans);
}
.adv-title { font-size: 14px; font-weight: 700; flex: none; }
.adv-toggle em {
  font-style: normal; font-size: 13px; color: var(--color-soft);
  flex: 1; min-width: 0; line-height: 1.6;
}
.adv-caret { font-style: normal; color: var(--color-soft); transition: transform .2s; flex: none; }
.adv-caret.open { transform: rotate(90deg); }
.adv-toggle:hover .adv-title { color: var(--brand-yellow); }
.adv-body { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
.adv-body .hint { margin-top: 0; }
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

/* 「生成提纲」那个入口：摆在提纲框上面、按钮用实心黄（这一屏最要紧的一件事是提纲，
   而多数时候他手里压根没有提纲 —— 藏成一行小字的话这个功能等于不存在）。 */
.outline-ai { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.btn-outline-ai {
  padding: 11px 20px; border: none; border-radius: 12px; background: var(--brand-yellow);
  color: #12182B; font-size: 14px; font-weight: 700; font-family: var(--font-sans);
  cursor: pointer; white-space: nowrap; transition: all .2s; flex: none;
}
.btn-outline-ai:hover { background: var(--brand-yellow-hover); transform: translateY(-1px); }
.outline-ai-hint { font-size: 12.5px; line-height: 1.7; color: var(--color-soft); flex: 1; min-width: 240px; }
.outline-note {
  margin: 0 0 12px; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.8;
  background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.3); color: #FFD979;
}
.link-btn {
  margin-left: 8px; padding: 0; background: none; border: none; cursor: pointer;
  color: var(--brand-yellow); font-size: 13px; font-family: var(--font-sans); text-decoration: underline;
}

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
