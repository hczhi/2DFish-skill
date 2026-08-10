<!--
  指令失败原因。用户侧 /feishu 和后台 /admin/feishu 共用。

  缺权限（飞书 code 99991672）是这个模块最高频的失败，也是唯一「点两下就能自己解决」的
  一类。所以它不走通用的 <pre> 错误文本，而是单独渲染成：缺哪几个 scope + 一个直达
  飞书授权页的按钮 + 「开通后必须发版」的提醒。

  最后那条提醒是必须的：只开权限不发版，飞书返回的错误和完全没开一模一样，
  用户会以为按钮没生效。

  通讯录范围没配（code 40004）是**另一类**，必须分开：那时权限点已经开好了，
  要去的是「数据权限」而不是「API 权限」。导到授权页只会让用户看到一片绿勾然后卡住。
-->
<template>
  <div v-if="detail && detail.kind === 'scope_denied'" class="scope-denied">
    <div class="sd-head">
      <span class="sd-icon">🔒</span>
      <span class="sd-title">飞书应用缺少权限</span>
    </div>

    <p v-if="detail.scopes?.length" class="sd-line">
      需要开通{{ detail.scopes.length > 1 ? '以下任一项' : '' }}：
      <code v-for="s in detail.scopes" :key="s" class="sd-scope">{{ s }}</code>
    </p>

    <div class="sd-actions">
      <!--
        rel=noopener 必须有：target=_blank 打开的页面能通过 window.opener 反向操作本页。
        链接优先透传飞书自己返回的（域名分 feishu.cn / larksuite.com 两套），
        飞书没给时服务端用 app_id + scopes 兜底拼一个。
      -->
      <a
        v-if="detail.apply_url"
        class="sd-btn"
        :href="detail.apply_url"
        target="_blank"
        rel="noopener noreferrer"
      >
        去飞书后台开通权限 ↗
      </a>
      <button class="sd-btn sd-btn-ghost" @click="copyLink">
        {{ copied ? '已复制' : '复制链接' }}
      </button>
    </div>

    <p class="sd-warn">
      ⚠️ 开通后还要在飞书开发者后台<strong>创建并发布新版本</strong>才生效 ——
      权限不发版时的报错和没开通完全一样。
    </p>

    <p v-if="detail.log_id" class="sd-meta">
      code {{ detail.code }} · log_id <span class="mono">{{ detail.log_id }}</span>
    </p>
  </div>

  <!--
    通讯录范围没配（code 40004）。和上面那类分开渲染，因为在飞书后台是两个不同的地方：
    权限**点**在「API 权限」，权限**范围**在「数据权限 > 通讯录范围」。
    用户到这一步时权限点通常已经全是绿的了 —— 再让他去授权页只会让他卡住，
    所以这里的按钮文案和指引都指向数据权限。
  -->
  <div v-else-if="detail && detail.kind === 'contact_scope_empty'" class="scope-denied">
    <div class="sd-head">
      <span class="sd-icon">📇</span>
      <span class="sd-title">通讯录权限范围是空的</span>
    </div>

    <p class="sd-line">
      权限点开了不等于能读通讯录 —— 还要在飞书开发者后台的
      <strong>【权限管理 &gt; 数据权限 &gt; 通讯录范围】</strong>
      里，把要让助理认识的部门（或全部成员）加进去。
    </p>

    <div class="sd-actions">
      <a
        v-if="detail.apply_url"
        class="sd-btn"
        :href="detail.apply_url"
        target="_blank"
        rel="noopener noreferrer"
      >
        去飞书后台配通讯录范围 ↗
      </a>
      <button v-if="detail.apply_url" class="sd-btn sd-btn-ghost" @click="copyLink">
        {{ copied ? '已复制' : '复制链接' }}
      </button>
    </div>

    <p class="sd-warn">
      ⚠️ 改完同样要<strong>创建并发布新版本</strong>才生效。
      不想开通讯录也可以：把机器人拉进有同事的群，助理会用群成员建一份小名册。
    </p>

    <p v-if="detail.log_id" class="sd-meta">
      code {{ detail.code }} · log_id <span class="mono">{{ detail.log_id }}</span>
    </p>
  </div>

  <!--
    对方不在应用的可用范围里（code 230013）。第三套设置，在「应用发布」页而不是权限页。
    新建的应用默认只有创建者本人可用，所以第一次把任务派给同事一定会撞到这里 ——
    而飞书的原文是英文的 'Bot has NO availability to this user'，
    里面一个字都没提「可用范围」，用户基本不可能猜到该去哪。
  -->
  <div v-else-if="detail && detail.kind === 'availability_denied'" class="scope-denied">
    <div class="sd-head">
      <span class="sd-icon">👥</span>
      <span class="sd-title">对方不在应用的「可用范围」里</span>
    </div>

    <p class="sd-line">
      能在通讯录里查到这个人，和能把任务派给他，是两件事。去飞书开发者后台的
      <strong>【应用发布 &gt; 版本管理与发布】</strong>，把「可用范围」改成全体成员
      （或加上这位同事所在的部门）。
    </p>

    <div class="sd-actions">
      <a
        v-if="detail.apply_url"
        class="sd-btn"
        :href="detail.apply_url"
        target="_blank"
        rel="noopener noreferrer"
      >
        去飞书后台改可用范围 ↗
      </a>
      <button v-if="detail.apply_url" class="sd-btn sd-btn-ghost" @click="copyLink">
        {{ copied ? '已复制' : '复制链接' }}
      </button>
    </div>

    <p class="sd-warn">
      ⚠️ 改完要<strong>创建并发布新版本</strong>才生效。
      新建的应用默认只有创建者本人可用 —— 第一次把任务派给同事必然撞到这里，不是配错了什么。
    </p>

    <p v-if="detail.log_id" class="sd-meta">
      code {{ detail.code }} · log_id <span class="mono">{{ detail.log_id }}</span>
    </p>
  </div>

  <!-- 其余错误照旧展示原文：里面通常有 code 和 log_id，能直接在飞书后台查。 -->
  <pre v-else class="detail-pre error-pre">{{ text }}</pre>
</template>

<script setup lang="ts">
import { ref } from 'vue'

export interface FeishuErrorDetailData {
  kind: 'scope_denied' | 'contact_scope_empty' | 'availability_denied' | 'api_error'
  message: string
  code?: number
  log_id?: string
  scopes?: string[]
  apply_url?: string
}

const props = defineProps<{
  /** feishu_commands.error —— 老记录只有这个 */
  text: string
  /** 结构化原因。migration 055 之前的历史记录是 null，此时回落到 text。 */
  detail: FeishuErrorDetailData | null
}>()

const copied = ref(false)

/** 复制链接：管理员看到的失败往往要转给别的同事去点（他才有那个应用的权限）。 */
async function copyLink() {
  const url = props.detail?.apply_url
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    /* 剪贴板不可用（非 https 等）时静默失败，链接本身还在按钮里 */
  }
}
</script>

<style scoped>
.scope-denied {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  padding: 12px 14px;
}

.sd-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.sd-icon { font-size: 15px; }
.sd-title { font-weight: 600; color: #92400e; font-size: 14px; }

.sd-line { margin: 0 0 10px; font-size: 13px; color: #78350f; line-height: 1.7; }

.sd-scope {
  display: inline-block;
  background: #fff;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #92400e;
}

.sd-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }

.sd-btn {
  display: inline-block;
  background: #d97706;
  color: #fff;
  border: 1px solid #d97706;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}
.sd-btn:hover { background: #b45309; }

.sd-btn-ghost {
  background: #fff;
  color: #92400e;
  border-color: #fcd34d;
}
.sd-btn-ghost:hover { background: #fef3c7; }

.sd-warn {
  margin: 0;
  font-size: 12px;
  color: #78350f;
  line-height: 1.6;
  background: #fef3c7;
  border-radius: 6px;
  padding: 8px 10px;
}
.sd-warn strong { color: #92400e; }

.sd-meta { margin: 8px 0 0; font-size: 11px; color: #a16207; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.detail-pre {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.error-pre { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
</style>
