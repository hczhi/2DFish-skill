<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiPost } from '../../lib/api'
import { getToken } from '../../lib/auth'
import { openLoginModal } from '../../lib/loginModal'
import SiteHeader from '../../components/common/SiteHeader.vue'
import SiteFooter from '../../components/common/SiteFooter.vue'

const router = useRouter()
const creating = ref(false)
const err = ref('')

const form = ref({ brandName: '', brief: '' })
const MAX_BRIEF = 20000

onMounted(() => {
  if (!getToken()) {
    openLoginModal(window.location.pathname, '创建品牌项目需要登录')
  }
})

async function create() {
  if (!form.value.brandName.trim()) { err.value = '请填写品牌 / 客户名称'; return }
  creating.value = true
  err.value = ''
  try {
    const res = await apiPost('/api/consult/projects', {
      brandName: form.value.brandName.trim(),
      brief: form.value.brief,
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

    <header class="hero">
      <div class="hero-main">
        <div class="hero-kicker">NEW PROJECT</div>
        <h1>新建品牌咨询项目</h1>
      </div>
    </header>

    <div class="consult-page">
      <div class="consult-container">
        <div class="back-nav">
          <button class="btn-ghost" @click="router.push('/consult/projects')">
            &larr; 返回工作台
          </button>
        </div>

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
            <span class="hint">
              这段资料会进「四看」每一次分析的 prompt。超过 {{ MAX_BRIEF }} 字会被拒绝而不是自动截断
              —— 悄悄砍掉后半段的话，AI 是照着半份资料出结论的，而结论看起来完全正常。
            </span>
          </label>
          <div class="create-actions">
            <button class="btn-primary" :disabled="creating" @click="create">
              {{ creating ? '创建中…' : '创建并让 AI 看看还缺什么' }}
            </button>
            <span class="muted">
              创建后先进补料问卷（消耗 1 次 AI 额度）：全部答完才进工作台，答案会追加进这段资料。
              填不完可以先离开，已填的都存着。
            </span>
          </div>
        </div>
      </div>
    </div>

    <SiteFooter />
  </div>
</template>

<style scoped>
.page-wrapper {
  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SF Mono", Menlo, Monaco, "JetBrains Mono", monospace;

  --brand: #0B4A6F;
  --brand-ink: #063553;
  --navy: #0B1424;
  --navy-2: #16233C;

  --color-text: #1D1D1F;
  --color-muted: #434344;
  --color-soft: #86868B;
  --color-bg-elevated: rgba(255, 255, 255, 0.75);
  --color-border: rgba(0, 0, 0, 0.07);
  --color-border-strong: rgba(0, 0, 0, 0.16);
  
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #F5F5F7;
  background-image: linear-gradient(rgba(0,0,0,.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,0,0,.03) 1px, transparent 1px);
  background-size: 24px 24px;
  background-attachment: fixed;
  color: var(--color-text);
  font-family: var(--font-sans);
}

.hero {
  position: relative; overflow: hidden;
  padding: 40px 48px 34px; color: #F2F6FC;
  background: linear-gradient(135deg, #080F1D 0%, var(--navy) 38%, var(--navy-2) 68%, #1E3A5C 105%);
}
.hero::before {
  content: ""; position: absolute; top: -200px; right: -60px; width: 460px; height: 460px;
  background: radial-gradient(circle, rgba(11, 74, 111, .55) 0%, transparent 65%); pointer-events: none;
}
.hero-main { position: relative; z-index: 1; max-width: 720px; }
.hero-kicker {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 5px;
  color: rgba(242, 246, 252, .5); text-transform: uppercase;
}
.hero h1 {
  margin: 10px 0 0; font-size: 34px; font-weight: 800; letter-spacing: .5px;
  font-family: var(--font-sans); color: #fff;
}

.consult-page { flex: 1; padding: 32px 48px 64px; }
.consult-container { width: 100%; }

.back-nav { margin-bottom: 24px; }

.btn-primary {
  padding: 9px 18px; border: 1px solid var(--brand); border-radius: 10px;
  background: var(--brand); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  font-family: var(--font-sans);
}
.btn-primary:hover { background: var(--brand-ink); }
.btn-primary:disabled { opacity: .5; cursor: default; }
.btn-ghost {
  padding: 9px 18px; border: 1px solid var(--color-border-strong); border-radius: 10px;
  background: transparent; color: var(--color-muted); font-size: 13px; cursor: pointer;
  font-family: var(--font-sans);
}
.btn-ghost:hover { border-color: var(--brand); color: var(--brand); }

.alert {
  margin-bottom: 16px; padding: 11px 14px; border-radius: 10px;
  background: #FEF3F2; border: 1px solid #FDA29B; color: #B42318; font-size: 13px; line-height: 1.7;
}

.create-card {
  background: var(--color-bg-elevated);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--color-border); border-top: 4px solid var(--brand);
  border-radius: 14px; padding: 40px 48px; box-shadow: 0 12px 32px -12px rgba(0, 0, 0, .06);
}
.field { display: block; margin-bottom: 32px; }
.label { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; color: var(--color-text); margin-bottom: 12px; }
.label em { font-style: normal; color: var(--color-soft); font-family: var(--font-mono); font-weight: 400; }
.label em.over { color: #B42318; }
.field input, .field textarea {
  width: 100%; box-sizing: border-box; padding: 14px 16px;
  border: 1px solid var(--color-border-strong); border-radius: 12px;
  font-size: 14px; font-family: var(--font-sans); color: var(--color-text);
  background: #fff; resize: vertical; line-height: 1.8;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.field input:focus, .field textarea:focus {
  outline: none; border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.hint { display: block; margin-top: 10px; font-size: 12px; line-height: 1.7; color: var(--color-soft); }
.create-actions {
  display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
  margin-top: 40px; padding-top: 32px; border-top: 1px dashed var(--color-border);
}
.muted { font-size: 13px; color: var(--color-soft); line-height: 1.6; flex: 1; min-width: 300px; }

@media (max-width: 820px) {
  .hero { padding: 32px 24px 28px; }
  .hero h1 { font-size: 26px; }
  .consult-page { padding: 24px 20px 48px; }
  .create-card { padding: 20px; }
}
</style>
