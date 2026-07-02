<template>
  <div class="login-page">
    <div class="login-card">
      <h1>{{ isRegister ? '注册' : '登录' }}</h1>
      <p class="subtitle" v-if="reason === 'ai'">使用 AI 功能需要登录</p>
      <form @submit.prevent="handleSubmit">
        <input v-model="username" type="text" placeholder="用户名" autocomplete="username" />
        <input v-model="password" type="password" placeholder="密码" :autocomplete="isRegister ? 'new-password' : 'current-password'" />
        <input v-model="confirmPassword" v-if="isRegister" type="password" placeholder="确认密码" autocomplete="new-password" />
        <p class="error" v-if="error">{{ error }}</p>
        <button type="submit" :disabled="loading">
          {{ loading ? '处理中...' : (isRegister ? '注册' : '登录') }}
        </button>
      </form>
      <div class="switch-mode">
        <span v-if="!isRegister">
          没有账号？<a href="#" @click.prevent="isRegister = true">注册</a>
        </span>
        <span v-else>
          已有账号？<a href="#" @click.prevent="isRegister = false">登录</a>
        </span>
      </div>
      <router-link to="/" class="back-link">&larr; 返回首页</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login, register } from '../lib/auth'

const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const isRegister = ref(false)

const reason = computed(() => route.query.reason as string | undefined)

async function handleSubmit() {
  error.value = ''

  if (!username.value || !password.value) {
    error.value = '请填写用户名和密码'
    return
  }

  if (isRegister.value) {
    if (password.value.length < 6) {
      error.value = '密码至少需要6位'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '两次密码输入不一致'
      return
    }
  }

  loading.value = true
  try {
    if (isRegister.value) {
      await register(username.value, password.value)
    } else {
      await login(username.value, password.value)
    }
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
}

.login-card {
  background: var(--bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 48px 40px;
  width: 360px;
  text-align: center;
  box-shadow: var(--shadow-md);
}

.login-card h1 {
  font-size: 24px;
  margin-bottom: 8px;
}

.subtitle {
  color: var(--text-muted);
  font-size: 13px;
  margin-bottom: 24px;
}

form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

input {
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
  font-size: 15px;
  outline: none;
}
input:focus { border-color: var(--primary); }

button[type="submit"] {
  padding: 12px;
  background: var(--primary);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 8px;
}
button:disabled { opacity: 0.6; cursor: default; }
button:hover:not(:disabled) { background: var(--primary-light); }

.error {
  color: #ef4444;
  font-size: 13px;
}

.switch-mode {
  margin-top: 20px;
  font-size: 13px;
  color: var(--text-secondary);
}
.switch-mode a {
  color: var(--primary);
  text-decoration: none;
}
.switch-mode a:hover {
  text-decoration: underline;
}

.back-link {
  display: inline-block;
  margin-top: 16px;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 13px;
}
.back-link:hover { color: var(--text); }
</style>
