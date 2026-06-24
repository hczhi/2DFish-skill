export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface AILogEntry {
  id: number
  timestamp: string
  type: 'request' | 'response' | 'error'
  duration?: number
  request?: {
    model: string
    fishCount: number
    foodCount: number
  }
  response?: {
    decisions: Array<{
      id: string
      name?: string
      action: string
      target: string | null
      urgency: number
    }>
  }
  usage?: TokenUsage
  error?: string
  rawRequest?: string
  rawResponse?: string
}

class AILoggerClass {
  private logs: AILogEntry[] = []
  private idCounter = 0
  private listeners: Array<(logs: AILogEntry[]) => void> = []
  private maxLogs = 50
  private _totalTokens = 0
  private _totalPromptTokens = 0
  private _totalCompletionTokens = 0
  private _requestCount = 0

  addLog(entry: Omit<AILogEntry, 'id' | 'timestamp'>) {
    const log: AILogEntry = {
      ...entry,
      id: ++this.idCounter,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    }
    if (entry.usage) {
      this._totalPromptTokens += entry.usage.prompt_tokens
      this._totalCompletionTokens += entry.usage.completion_tokens
      this._totalTokens += entry.usage.total_tokens
      this._requestCount++
    }
    this.logs.unshift(log)
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }
    this.notify()
  }

  getLogs(): AILogEntry[] {
    return this.logs
  }

  get totalTokens() { return this._totalTokens }
  get totalPromptTokens() { return this._totalPromptTokens }
  get totalCompletionTokens() { return this._totalCompletionTokens }
  get requestCount() { return this._requestCount }

  clear() {
    this.logs = []
    this._totalTokens = 0
    this._totalPromptTokens = 0
    this._totalCompletionTokens = 0
    this._requestCount = 0
    this.notify()
  }

  subscribe(listener: (logs: AILogEntry[]) => void) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  private notify() {
    this.listeners.forEach(l => l(this.logs))
  }
}

export const AILogger = new AILoggerClass()
