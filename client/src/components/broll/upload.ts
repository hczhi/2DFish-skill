import { api } from '../../lib/api'

// 动效卡里的图片一律先传到服务器（平台的 /api/upload/image，存 COS），卡片里存的是返回的地址。
// 不用本机 objectURL：导出是在服务器上逐帧渲染的，它读不到你电脑上的文件 —— 那样预览好好的，
// 导出来那个位置是空的，而导出照样「成功」。
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api('/api/upload/image', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || `上传失败（HTTP ${res.status}）`)
  return data.url
}
