<template>
  <Transition name="modal-fade">
    <div v-if="showLoginModal" class="login-modal-overlay" @click.self="closeLoginModal">
      <div class="login-modal-container">
        <button class="close-btn" @click="closeLoginModal">&times;</button>
        
        <!-- Left Side: Form -->
        <div class="login-form-side">
          <div class="login-header">
            <div class="brand">
              <span class="brand-text">QiaoNan.</span>
            </div>
            <h2>Get started</h2>
            <p class="subtitle" v-if="loginReason === 'ai'">
              {{ isEn ? 'Login required to use AI features' : '使用 AI 功能需要登录' }}
            </p>
          </div>

          <form @submit.prevent="handleSubmit" class="login-form">
            <div class="input-group">
              <label>{{ isEn ? 'Name' : '用户名' }}</label>
              <div class="input-wrapper">
                <input v-model="username" type="text" :placeholder="isEn ? 'Enter your name' : '输入用户名'" autocomplete="username" />
              </div>
            </div>
            
            <div class="input-group">
              <label>{{ isEn ? 'Password' : '密码' }}</label>
              <div class="input-wrapper">
                <input v-model="password" type="password" :placeholder="isEn ? 'Enter your password' : '输入密码'" autocomplete="current-password" />
              </div>
            </div>

            <p class="error" v-if="error">{{ error }}</p>
            
            <button type="submit" class="submit-btn" :disabled="loading">
              {{ loading ? (isEn ? 'Processing...' : '处理中...') : (isEn ? 'Sign in' : '登录') }}
            </button>
          </form>

          <div class="trial-prompt">
            <p v-if="isEn">Questions? Contact admin via Xiaohongshu: <a href="#">小智同学Hc</a></p>
            <p v-else>如需体验账号，请通过小红书联系管理员：<a href="#">小智同学Hc</a></p>
          </div>
        </div>

        <!-- Right Side: Graphic/Illustration -->
        <div class="login-graphic-side">
          <TransitionGroup name="tab-transition" tag="div" class="graphic-wrapper">
            <div 
              class="graphic-content" 
              v-for="(tab, index) in tabs" 
              :key="tab.id" 
              v-show="activeTab === index"
            >
              
              <!-- Scene 0: AI Planet -->
              <div v-if="index === 0" class="scene scene-0">
                <div class="floating-elements layer-3">
                  <div class="star s1">✦</div>
                  <div class="star s2">✦</div>
                  <div class="star s3">✦</div>
                  <div class="circle c1"></div>
                  <div class="triangle t1"></div>
                </div>
                <div class="center-illustration">
                  <div class="planet-orbit layer-1"></div>
                  <div class="planet layer-1">
                    <div class="planet-band">Hc Design</div>
                  </div>
                  <div class="hand hand-left layer-2"></div>
                  <div class="hand hand-right layer-2"></div>
                  <div class="ai-text layer-3">Ai</div>
                </div>
              </div>

              <!-- Scene 1: Creative Palette -->
              <div v-if="index === 1" class="scene scene-1">
                <div class="floating-elements layer-3">
                  <div class="star s1" style="color: #38D9A9">✦</div>
                  <div class="star s2" style="color: #FFD43B">✦</div>
                </div>
                <div class="center-illustration">
                  <div class="palette-card layer-1">
                    <div class="color-swatch c-red"></div>
                    <div class="color-swatch c-yellow"></div>
                    <div class="color-swatch c-blue"></div>
                  </div>
                  <div class="float-shape shape-circle layer-2"></div>
                  <div class="float-shape shape-rect layer-2"></div>
                  <div class="float-shape shape-triangle layer-3"></div>
                </div>
              </div>

              <!-- Scene 2: Data Dashboard -->
              <div v-if="index === 2" class="scene scene-2">
                <div class="floating-elements layer-3">
                  <div class="data-node n1"></div>
                  <div class="data-node n2"></div>
                  <div class="data-node n3"></div>
                </div>
                <div class="center-illustration">
                  <div class="chart-base layer-1">
                    <div class="bar b1"></div>
                    <div class="bar b2"></div>
                    <div class="bar b3"></div>
                    <div class="bar b4"></div>
                  </div>
                  <div class="chart-line layer-2">
                    <svg viewBox="0 0 100 50" preserveAspectRatio="none">
                      <path d="M0,50 L20,30 L40,40 L70,10 L100,20" fill="none" stroke="#FFD43B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                  <div class="data-float-card layer-3">
                    <span>+124%</span>
                  </div>
                </div>
              </div>

              <div class="graphic-text layer-1">
                <h3 style="white-space: pre-wrap">{{ tab.title }}</h3>
              </div>
            </div>
          </TransitionGroup>

          <div class="dots-container">
            <span 
              class="dot" 
              v-for="(_, i) in tabs" 
              :key="'dot-'+i" 
              :class="{ active: activeTab === i }" 
              @click="setActiveTab(i)"
            ></span>
          </div>
        </div>

      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '../../lib/auth'
import { showLoginModal, closeLoginModal, loginRedirect, loginReason } from '../../lib/loginModal'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const isEn = computed(() => localStorage.getItem('locale') === 'en')

const activeTab = ref(0)
let tabInterval: number | null = null

const tabs = computed(() => [
  { 
    id: 0, 
    title: 'Have your own\npersonal website' 
  },
  { 
    id: 1, 
    title: 'Unleash your\ncreative design' 
  },
  { 
    id: 2, 
    title: 'Data driven\nsmart decisions' 
  }
])

function startTabInterval() {
  if (tabInterval) clearInterval(tabInterval)
  tabInterval = window.setInterval(() => {
    activeTab.value = (activeTab.value + 1) % 3
  }, 4000)
}

onMounted(() => {
  startTabInterval()
})

onUnmounted(() => {
  if (tabInterval) clearInterval(tabInterval)
})

function setActiveTab(index: number) {
  activeTab.value = index
  startTabInterval() // Reset interval on manual click
}

async function handleSubmit() {
  error.value = ''

  if (!username.value || !password.value) {
    error.value = isEn.value ? 'Please fill in username and password' : '请填写用户名和密码'
    return
  }

  loading.value = true
  try {
    await login(username.value, password.value)
    const redirect = loginRedirect.value || '/'
    closeLoginModal()
    
    // Clear form
    username.value = ''
    password.value = ''
    
    // Refresh page or push to redirect
    if (window.location.pathname === redirect) {
      window.location.reload()
    } else {
      router.push(redirect)
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-active .login-modal-container {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-fade-leave-active .login-modal-container {
  transition: all 0.3s ease;
}
.modal-fade-enter-from .login-modal-container {
  opacity: 0;
  transform: translateY(30px) scale(0.95);
}
.modal-fade-leave-to .login-modal-container {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.login-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 24px;
}

.login-modal-container {
  background: #ffffff;
  width: 100%;
  max-width: 900px;
  height: 600px;
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.04);
  display: flex;
  overflow: hidden;
  position: relative;
}

.close-btn {
  position: absolute;
  top: 24px;
  right: 24px;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #ffffff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.4);
  color: #ffffff;
  transform: rotate(90deg) scale(1.1);
}

/* --- Left Side: Form --- */
.login-form-side {
  flex: 1;
  padding: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: #ffffff;
}

.login-header {
  margin-bottom: 40px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 48px;
}

.brand-icon {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #4361EE, #3B5BDB);
  border-radius: 10px 10px 10px 0;
  box-shadow: 0 4px 8px rgba(67, 97, 238, 0.3);
}

.brand-text {
  font-family: var(--font-sans, sans-serif);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.1;
  color: #111827;
}

.login-header h2 {
  font-family: var(--font-sans, sans-serif);
  font-size: 42px;
  font-weight: 800;
  color: #111827;
  margin: 0;
  letter-spacing: -1px;
}

.subtitle {
  color: #ef4444;
  font-size: 13px;
  margin-top: 8px;
  font-weight: 600;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.input-group label {
  display: block;
  font-family: var(--font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  color: #4b5563;
  margin-bottom: 8px;
}

.input-wrapper {
  position: relative;
}

.input-wrapper input {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f9fafb;
  color: #111827;
  font-size: 15px;
  font-family: var(--font-sans, sans-serif);
  outline: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
}

.input-wrapper input:focus {
  background: #ffffff;
  border-color: #3B5BDB;
  box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15);
}

.submit-btn {
  padding: 16px;
  background: linear-gradient(135deg, #5c7cfa, #3B5BDB);
  color: #ffffff;
  border: none;
  border-radius: 10px;
  font-family: var(--font-sans, sans-serif);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 12px rgba(59, 91, 219, 0.3);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(59, 91, 219, 0.4);
}

.error {
  color: #ef4444;
  font-size: 13px;
  font-weight: 600;
  margin: -4px 0 0 0;
}

.trial-prompt {
  margin-top: 32px;
  font-size: 13px;
  color: #6b7280;
}

.trial-prompt a {
  color: #3B5BDB;
  text-decoration: none;
  font-weight: 600;
  transition: color 0.2s;
}

.trial-prompt a:hover {
  color: #2b45a8;
}

/* --- Right Side: Graphic --- */
.login-graphic-side {
  flex: 1;
  background: linear-gradient(135deg, #5c7cfa 0%, #3B5BDB 100%);
  border-radius: 10px;
  margin: 12px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1);
  perspective: 1000px;
}

.graphic-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
}

.graphic-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transform-style: preserve-3d;
}

/* Tab Transition with Depth */
.tab-transition-enter-active,
.tab-transition-leave-active {
  transition: all 1s cubic-bezier(0.22, 1, 0.36, 1);
}

.tab-transition-enter-from {
  opacity: 0;
  transform: translateZ(120px) translateY(-20px) rotateX(5deg);
}

.tab-transition-leave-to {
  opacity: 0;
  transform: translateZ(-120px) translateY(20px) rotateX(-5deg);
}

/* Layers for parallax effect during transition */
.layer-1 { transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s, opacity 1s ease 0.1s; }
.layer-2 { transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s, opacity 1s ease 0.2s; }
.layer-3 { transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s, opacity 1s ease 0.3s; }

.tab-transition-enter-from .layer-1 { opacity: 0; transform: translateZ(50px); }
.tab-transition-enter-from .layer-2 { opacity: 0; transform: translateZ(100px); }
.tab-transition-enter-from .layer-3 { opacity: 0; transform: translateZ(150px); }

.tab-transition-leave-to .layer-1 { opacity: 0; transform: translateZ(-50px); }
.tab-transition-leave-to .layer-2 { opacity: 0; transform: translateZ(-100px); }
.tab-transition-leave-to .layer-3 { opacity: 0; transform: translateZ(-150px); }

.scene {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-style: preserve-3d;
}

.floating-elements {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform-style: preserve-3d;
}

.star {
  position: absolute;
  color: #fff;
  font-size: 24px;
  animation: float 4s ease-in-out infinite;
}
.s1 { top: 20%; left: 20%; color: #FFD43B; font-size: 32px; }
.s2 { top: 30%; right: 20%; font-size: 16px; animation-delay: 1s; }
.s3 { bottom: 25%; left: 30%; color: #38D9A9; animation-delay: 2s; }

.circle {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 50%;
  bottom: 20%; right: 25%;
  animation: float 5s ease-in-out infinite reverse;
}

.center-illustration {
  position: relative;
  width: 240px;
  height: 240px;
  margin-bottom: 40px;
  transform-style: preserve-3d;
}

/* Scene 0 Elements */
.planet {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 120px;
  height: 120px;
  background: radial-gradient(circle at 30% 30%, #38D9A9, #0ca678);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 16px 32px rgba(0,0,0,0.15), inset -10px -10px 20px rgba(0,0,0,0.1);
  overflow: hidden;
}

.planet-orbit {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-15deg);
  width: 200px;
  height: 60px;
  border: 2px dashed rgba(255,255,255,0.3);
  border-radius: 50%;
  animation: orbitSpin 10s linear infinite;
}

@keyframes orbitSpin {
  from { transform: translate(-50%, -50%) rotate(-15deg) scale(1); }
  50% { transform: translate(-50%, -50%) rotate(-15deg) scale(1.05); }
  to { transform: translate(-50%, -50%) rotate(-15deg) scale(1); }
}

.planet-band {
  position: absolute;
  top: 50%; left: -10%; right: -10%;
  transform: translateY(-50%) rotate(-15deg);
  background: #fff;
  border-top: 3px solid #111827;
  border-bottom: 3px solid #111827;
  padding: 4px 0;
  text-align: center;
  font-weight: 900;
  font-size: 14px;
  color: #111827;
  letter-spacing: 1px;
}

.ai-text {
  position: absolute;
  top: -20px; left: 0;
  font-family: var(--font-sans, sans-serif);
  font-size: 48px;
  font-weight: 800;
  font-style: italic;
  color: #fff;
  text-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.hand {
  position: absolute;
  width: 80px;
  height: 100px;
  background-size: contain;
  background-repeat: no-wrap;
  background: #B197FC;
  border: 2px solid rgba(255,255,255,0.2);
  border-radius: 40px;
  box-shadow: 0 8px 16px rgba(0,0,0,0.1);
}
.hand-left { bottom: 0; left: -20px; transform: rotate(45deg); }
.hand-right { top: 0; right: -20px; transform: rotate(-135deg); }

/* Scene 1 Elements */
.palette-card {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-10deg);
  width: 140px;
  height: 160px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 24px 48px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,1);
  border: 1px solid rgba(255,255,255,0.5);
}
.color-swatch {
  flex: 1;
  border-radius: 10px;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
}
.c-red { background: linear-gradient(135deg, #ff8787, #fa5252); }
.c-yellow { background: linear-gradient(135deg, #fcc419, #f59f00); }
.c-blue { background: linear-gradient(135deg, #74c0fc, #339af0); }

.float-shape {
  position: absolute;
  background: linear-gradient(135deg, rgba(255,255,255,0.4), rgba(255,255,255,0.1));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.6);
  box-shadow: 0 8px 32px rgba(0,0,0,0.1);
}
.shape-circle {
  width: 60px; height: 60px; border-radius: 50%;
  top: 10%; right: 10%;
  animation: float 5s infinite;
}
.shape-rect {
  width: 80px; height: 40px; border-radius: 10px;
  bottom: 20%; left: 0;
  transform: rotate(20deg);
  animation: float 4s infinite reverse;
}
.shape-triangle {
  width: 0; height: 0;
  border-left: 30px solid transparent;
  border-right: 30px solid transparent;
  border-bottom: 50px solid rgba(255,255,255,0.3);
  background: transparent; border-top: none;
  top: 40%; left: -10%;
  animation: float 6s infinite;
}

/* Scene 2 Elements */
.chart-base {
  position: absolute;
  bottom: 40px; left: 50%;
  transform: translateX(-50%);
  width: 160px;
  height: 120px;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 2px solid rgba(255,255,255,0.4);
}
.bar {
  flex: 1;
  background: linear-gradient(to top, rgba(255,255,255,0.1), rgba(255,255,255,0.3));
  border-radius: 4px 4px 0 0;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.4);
  border-bottom: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.b1 { height: 40%; }
.b2 { height: 70%; }
.b3 { height: 50%; }
.b4 { height: 90%; background: linear-gradient(to top, #0ca678, #38D9A9); border-color: #38D9A9; box-shadow: 0 0 16px rgba(56, 217, 169, 0.4); }

.chart-line {
  position: absolute;
  inset: 20px -20px 40px -20px;
  pointer-events: none;
}
.chart-line svg {
  width: 100%; height: 100%;
  filter: drop-shadow(0 8px 12px rgba(255, 212, 59, 0.6));
}

.data-float-card {
  position: absolute;
  top: 20px; right: -20px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  color: #3B5BDB;
  padding: 8px 16px;
  border-radius: 10px;
  font-weight: 900;
  font-size: 16px;
  box-shadow: 0 12px 24px rgba(0,0,0,0.15), inset 0 1px 1px #fff;
  border: 1px solid rgba(255,255,255,0.8);
  animation: float 3s infinite;
}
.data-node {
  position: absolute;
  width: 12px; height: 12px;
  background: #fff; border-radius: 50%;
  box-shadow: 0 0 12px #fff;
}
.n1 { top: 30%; left: 20%; animation: float 4s infinite; }
.n2 { top: 50%; right: 10%; animation: float 5s infinite reverse; }
.n3 { bottom: 30%; left: 30%; animation: float 3s infinite; }

.graphic-text {
  text-align: center;
  color: #fff;
  z-index: 10;
  position: absolute;
  bottom: 80px;
  width: 100%;
}

.graphic-text h3 {
  font-family: var(--font-sans, sans-serif);
  font-size: 32px;
  font-weight: 800;
  margin: 0;
  line-height: 1.2;
  letter-spacing: -0.5px;
  text-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.dots-container {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  gap: 8px;
  z-index: 20;
}

.dot {
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.dot.active {
  background: #fff;
  width: 24px;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
}

@keyframes float {
  0% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
  100% { transform: translateY(0px); }
}

@media (max-width: 768px) {
  .login-modal-container {
    flex-direction: column;
    height: auto;
    max-height: 90vh;
    overflow-y: auto;
  }
  .login-graphic-side {
    display: none; /* Hide graphic on mobile */
  }
  .login-form-side {
    padding: 32px;
  }
  .login-header h2 {
    font-size: 32px;
  }
}
</style>
