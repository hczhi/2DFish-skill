<template>
  <div class="not-found">
    <h1>404</h1>
    <p>页面不存在</p>
    <router-link to="/">返回首页</router-link>
  </div>
</template>

<style scoped>
.not-found {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.not-found h1 {
  font-size: 72px;
  font-weight: 700;
  color: var(--text-muted);
}
.not-found p {
  font-size: 18px;
  color: var(--text-secondary);
}
.not-found a {
  margin-top: 16px;
  color: var(--primary);
  text-decoration: none;
}
.not-found a:hover { text-decoration: underline; }
</style>
