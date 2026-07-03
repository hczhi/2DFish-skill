import { ref } from 'vue'

export const showLoginModal = ref(false)
export const loginRedirect = ref('')
export const loginReason = ref('')

export function openLoginModal(redirect = '/', reason = '') {
  loginRedirect.value = redirect
  loginReason.value = reason
  showLoginModal.value = true
}

export function closeLoginModal() {
  showLoginModal.value = false
}
