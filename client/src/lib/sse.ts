import { api } from './api'

export interface SSEOptions {
  url: string
  body: Record<string, unknown>
  onContent?: (text: string) => void
  onToolCall?: (data: { id: string; name: string; arguments: unknown }) => void
  onToolResult?: (data: { id: string; name: string; result: string; success: boolean }) => void
  onError?: (error: string) => void
  onDone?: () => void
  onSkillsActivated?: (skills: string[]) => void
  maxRetries?: number
  signal?: AbortSignal
}

export async function streamSSE(options: SSEOptions): Promise<void> {
  const { url, body, maxRetries = 2, signal } = options
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      // 走 api() 而不是裸 fetch：原来这里自己拼 Authorization 头，
      // 于是 AI 对话流在 401/429 时都只走 onError 打一行红字，
      // 既不清过期 token 也不弹额度提示。
      const res = await api(url, {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }))
        options.onError?.(data.error || `HTTP ${res.status}`)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { options.onError?.('No stream body'); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // 按空行分帧：一帧内部才按行拆 event:/data:。
        // 原来直接按 \n 拆整个 buffer，data 的 JSON 里带换行就会被劈成两半，
        // 而当时 JSON.parse 没有 try——一次解析失败会把整条流连同重试一起打断。
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''

        for (const frame of frames) {
          let currentEvent = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7)
            } else if (line.startsWith('data: ')) {
              try {
                handleEvent(currentEvent, JSON.parse(line.slice(6)), options)
              } catch { /* 半截帧，丢掉这一条 */ }
            }
          }
        }
      }

      return
    } catch (e: any) {
      if (e.name === 'AbortError') return
      attempt++
      if (attempt > maxRetries) {
        options.onError?.(e.message || 'Connection failed')
        return
      }
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
}

function handleEvent(event: string, data: any, options: SSEOptions) {
  switch (event) {
    case 'content':
      options.onContent?.(data.content)
      break
    case 'tool_call':
      options.onToolCall?.(data)
      break
    case 'tool_result':
      options.onToolResult?.(data)
      break
    case 'error':
      options.onError?.(data.error)
      break
    case 'done':
      options.onDone?.()
      break
    case 'skills_activated':
      options.onSkillsActivated?.(data.skills)
      break
  }
}
