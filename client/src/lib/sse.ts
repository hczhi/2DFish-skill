import { getToken } from './auth'

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
      const token = getToken()
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7)
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            handleEvent(currentEvent, data, options)
            currentEvent = ''
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
