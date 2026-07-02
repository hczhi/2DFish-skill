import { ref, computed } from 'vue';
import { getToken } from './auth';

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
}

export const quotaState = ref<QuotaStatus | null>(null);
export const showQuotaModal = ref(false);

export const quotaRemaining = computed(() => quotaState.value?.remaining ?? null);
export const quotaExhausted = computed(() => quotaState.value !== null && quotaState.value.remaining <= 0);

export async function fetchQuota(): Promise<void> {
  if (!getToken()) {
    quotaState.value = null;
    return;
  }
  try {
    const res = await fetch('/api/quota', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (res.ok) {
      quotaState.value = await res.json();
    }
  } catch { /* ignore */ }
}

export function handleQuotaExceeded(data: { daily_limit?: number }): void {
  const limit = data.daily_limit || 10;
  quotaState.value = { used: limit, limit, remaining: 0 };
  showQuotaModal.value = true;
}

export function dismissQuotaModal(): void {
  showQuotaModal.value = false;
}
