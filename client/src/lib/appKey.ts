import { ref } from 'vue'

// 售卖型应用 key（112）：对外没有登录，key 本身就是 Bearer，存在 localStorage、按应用分开存。
//
// 「现在用哪个应用的 key」由路由守卫按 `meta.keyApp` 设置（`setActiveKeyApp`），不从
// window.location 现读：守卫跑的时候地址栏还是上一页，现读的话从首页点进 /ppt 那一下带的是
// 空 token，被判成没 key 送去输入页。

export type KeyApp = 'ppt' | 'consult'

const storeKey = (app: KeyApp) => `qn-app-key:${app}`

let activeApp: KeyApp | null = null

export function setActiveKeyApp(app: KeyApp | null): void {
  activeApp = app
}

export function activeKeyApp(): KeyApp | null {
  return activeApp
}

export function activeAppKey(): string | null {
  if (!activeApp) return null
  try {
    return localStorage.getItem(storeKey(activeApp))
  } catch {
    return null
  }
}

export function saveAppKey(app: KeyApp, key: string): void {
  localStorage.setItem(storeKey(app), key.replace(/\s+/g, '').toUpperCase())
}

export function clearAppKey(app: KeyApp): void {
  try {
    localStorage.removeItem(storeKey(app))
  } catch { /* 存储不可用时本来就没存上 */ }
  keyInfo.value = null
}

export interface KeyInfo {
  keyPrefix: string
  balance: number
}

export const keyInfo = ref<KeyInfo | null>(null)

/**
 * 用这把 key 问一次服务端。**应用对不上要明确拒**：把咨询的卡输进 ppt 页面时服务端认得这张卡
 * （/me 是 200），不在这里拦的话它进了工作台之后每个接口 403，读起来像整个模块坏了。
 */
export async function verifyAppKey(app: KeyApp, key: string): Promise<KeyInfo> {
  const res = await fetch('/api/app-keys/me', { headers: { Authorization: `Bearer ${key.trim()}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `校验失败（HTTP ${res.status}）`)
  if (data.app !== app) throw new Error(`这是「${data.appLabel}」的 key，请到对应页面使用`)
  return { keyPrefix: data.keyPrefix, balance: data.balance }
}

/** 刷新右上角的余额。失败不清 key：网络抖一下就把人踢回输入页的话，他会以为 key 失效了。 */
export async function refreshKeyInfo(): Promise<void> {
  const key = activeAppKey()
  if (!key || !activeApp) {
    keyInfo.value = null
    return
  }
  try {
    keyInfo.value = await verifyAppKey(activeApp, key)
  } catch { /* 真失效时下一个业务请求的 401 会带着成因把他送回输入页 */ }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

/** 连着几个请求只刷一次（生成一份稿子是一串请求）。 */
export function scheduleKeyInfoRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshKeyInfo()
  }, 800)
}
