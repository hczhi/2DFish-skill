<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiPost } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'
import FileExtractPanel from '../../components/common/FileExtractPanel.vue'

const router = useRouter()
const creating = ref(false)
const err = ref('')

const form = ref({ brandName: '', brief: '' })
const MAX_BRIEF = 20000

/**
 * 上传的那几个文件整理出来的正文。**不再往上面那个 textarea 里插** ——
 * 插进去之后他只能对着一大段混在一起的文字改，分不清哪句是自己写的、哪句是从 PPT 里抠的；
 * 分开放着，提交时由服务端合成（`briefCompose.buildBrief`，超上限只拒不截并点名哪个文件）。
 */
const attachments = ref<Array<{ filename: string; text: string; variant: 'tidy' | 'raw' }>>([])
/**
 * 还有文件在提取/整理。这段时间里**禁掉「创建项目」**：不禁的话他点下去，正在整理的那几份
 * 压根不在 attachments 里，而项目建出来一切正常（资料里少几节，读起来完整），
 * 后面十二步就照着少几份的资料推。
 */
const filesBusy = ref(false)

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '创建品牌项目需要登录')
  }
})

async function create() {
  if (!form.value.brandName.trim()) { err.value = '请填写品牌 / 客户名称' ; return }
  creating.value = true
  err.value = ''
  try {
    const res = await apiPost('/api/consult/projects', {
      brandName: form.value.brandName.trim(),
      brief: form.value.brief,
      // 文件内容一律跟着提交走，不用他手动插入（要求 4）。服务端合成并复查上限。
      attachments: attachments.value,
    })
    // 新建项目先去补料问卷页，不直接进工作台
    router.push(`/consult/projects/${res.project.id}/intake?auto=1`)
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
      <!-- 装饰背景 -->
      <div class="bg-elements">
        <div class="bg-overlay"></div>
        <div class="grid-bg"></div>
      </div>

      <header class="hero">
        <div class="hero-main">
          <div class="hero-content">
            <div class="hero-kicker">
              <span class="kicker-line"></span>
              <span class="kicker-text">NEW PROJECT</span>
            </div>
            <h1>新建品牌咨询项目</h1>
          </div>
          <button class="btn-back-icon" @click="router.push('/consult/projects')" title="返回工作台">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
        </div>
      </header>

      <main class="consult-page">
        <div class="consult-container">
          <div v-if="err" class="alert">{{ err }}</div>

          <div class="create-card">
            <label class="field">
              <span class="label">品牌 / 客户名称</span>
              <input v-model="form.brandName" type="text" placeholder="例：捷停车" maxlength="60" />
            </label>
            <label class="field">
              <span class="label">
                客户原始资料（纯文字，可后续补充）
                <em :class="{ over: form.brief.length > MAX_BRIEF }">
                  {{ form.brief.length }} / {{ MAX_BRIEF }}
                </em>
              </span>
              <textarea
                v-model="form.brief"
                rows="16"
                placeholder="把你手上关于这个客户的东西直接贴进来：做什么的、业务线、规模数据、现有定位表述、竞品名单、目标人群、当前的痛点……缺的部分后面 AI 会问你。"
              ></textarea>
            </label>
            <!-- 放在 label 外面：label 里点任何东西都会连带激活它的表单控件（上面那个 textarea），
                 上传按钮和预览框套在里面会被 label 的点击行为带着跑。 -->
            <FileExtractPanel
              api-base="/api/consult"
              :current-chars="form.brief.length"
              @change="attachments = $event"
              @busy="filesBusy = $event"
            />
            <div class="create-actions">
              <!-- 禁用的**理由要写在按钮上**：只是灰掉的话他会以为页面卡了，刷新一次
                   前面传的几个文件全没了（文件不落盘，重来一遍还要再花几次额度）。 -->
              <button class="btn-primary" :disabled="creating || filesBusy" @click="create">
                {{ creating ? '创建中…' : filesBusy ? '文件还在处理中…' : '创建项目' }}
              </button>
              <span class="muted">
                创建后先进补料问卷：全部答完才进工作台，答案会追加进这段资料。
                填不完可以先离开，已填的都存着。
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
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;

  --brand-yellow: #FFB800;
  --brand-yellow-hover: #E6A600;
  
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.85);
  --color-soft: rgba(255, 255, 255, 0.6);
  --bg-color: #12182B; /* 从 #0A0F1E 调亮 */
  
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-color);
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.create-layout {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  padding-top: 30px; /* 避免被固定的 SiteHeader 遮挡 */
}

.bg-elements {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image: url('http://file.qiaonan.vip/uploads/2026/09/01/90892237-f079-493e-b2e4-13c15d0106e5.jpg');
  background-size: cover;
  background-position: center;
}

.bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(18, 24, 43, 0.65); /* 从 0.85 降低到 0.65 */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.grid-bg {
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 32px 32px;
  z-index: 1;
}

.hero {
  position: relative; 
  z-index: 1;
  padding: 40px 4vw 48px;
}

.hero-main { 
  max-width: 1000px; 
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.hero-content {
  flex: 1;
}

.hero-kicker {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.kicker-line {
  width: 48px;
  height: 2px;
  background: var(--brand-yellow);
}

.kicker-text {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--brand-yellow);
}

.hero h1 {
  font-size:36px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.1;
}

.consult-page { 
  position: relative;
  z-index: 1;
  flex: 1; 
  padding: 0 4vw 80px; 
}

.consult-container { 
  width: 100%; 
  max-width: 1000px;
  margin: 0 auto;
}

.back-nav { 
  margin-bottom: 32px; 
}

.btn-back-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.btn-back-icon:hover {
  background: var(--brand-yellow);
  color: #000;
  transform: translateY(-2px);
}

.btn-back-icon:active {
  transform: translateY(0) scale(0.98);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: var(--brand-yellow);
  color: #111;
  padding: 14px 28px;
  font-size: 15px;
  font-weight: 700;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 184, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--font-sans);
}
.btn-primary:hover { 
  background: var(--brand-yellow-hover);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 184, 0, 0.3);
}
.btn-primary:active { 
  transform: translateY(0) scale(0.98); 
}
.btn-primary:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }

.alert {
  margin-bottom: 24px; padding: 12px 16px; border-radius: 12px;
  background: rgba(254, 242, 242, 0.1); border: 1px solid rgba(252, 165, 165, 0.3); color: #FCA5A5; font-size: 14px;
  backdrop-filter: blur(10px);
}

.create-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px); 
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px; 
  padding: 28px; 
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.field { display: block; margin-bottom: 32px; }
.label { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
.label em { font-style: normal; color: var(--color-soft); font-family: var(--font-mono); font-weight: 400; }
.label em.over { color: #FCA5A5; }
.field input, .field textarea {
  width: 100%; box-sizing: border-box; padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px;
  font-size: 15px; font-family: var(--font-sans); color: var(--text-primary);
  background: rgba(0, 0, 0, 0.2); resize: vertical; line-height: 1.8;
  transition: all 0.2s;
}
.field input::placeholder, .field textarea::placeholder {
  color: rgba(255, 255, 255, 0.3);
}
.field input:focus, .field textarea:focus {
  outline: none; border-color: var(--brand-yellow);
  box-shadow: 0 0 0 4px rgba(255, 184, 0, 0.1);
  background: rgba(0, 0, 0, 0.4);
}
.hint { display: block; margin-top: 12px; font-size: 13px; line-height: 1.7; color: var(--color-soft); }

.create-actions {
  display: flex; gap: 24px; align-items: center; flex-wrap: wrap;
  margin-top: 48px; padding-top: 32px; border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.muted { font-size: 13px; color: var(--color-soft); line-height: 1.6; flex: 1; min-width: 300px; }

@media (max-width: 820px) {
  .hero { padding: 40px 20px 32px; }
  .hero-main { flex-direction: column; align-items: flex-start; gap: 24px; }
  .hero h1 { font-size: 48px; }
  .consult-page { padding: 0 20px 48px; }
  .create-card { padding: 24px; }
  .create-actions { flex-direction: column; align-items: stretch; gap: 16px; }
}
</style>
