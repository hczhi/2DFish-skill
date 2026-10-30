import { ref } from 'vue'
import { apiGet, apiPut } from '../../lib/api'

// 模版上线状态存在服务端（作者在调试台点上线 / 下线），这里是页面共用的一份。没列出的 = 草稿。
export type TemplateStatus = 'draft' | 'live'

export const templateStatus = ref<Record<string, TemplateStatus>>({})
export const statusLoaded = ref(false)
export const statusError = ref('')

export const statusOf = (id: string): TemplateStatus => templateStatus.value[id] || 'draft'

export async function loadTemplateStatus() {
  statusError.value = ''
  try {
    templateStatus.value = (await apiGet<{ status: Record<string, TemplateStatus> }>('/api/broll/templates')).status
    statusLoaded.value = true
  } catch (e: any) {
    // 读不到不能当「全是草稿」—— 那样用户这边加卡下拉框是空的，读起来像本来就没有卡
    statusError.value = `读取卡片上线状态失败：${e?.message || e}`
  }
}

export async function setTemplateStatus(id: string, status: TemplateStatus) {
  await apiPut(`/api/broll/templates/${id}`, { status })
  templateStatus.value = { ...templateStatus.value, [id]: status }
}
