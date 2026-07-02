<template>
  <router-view />
  <QuotaExhaustedModal />
</template>

<script setup lang="ts">
import QuotaExhaustedModal from './components/common/QuotaExhaustedModal.vue'
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --primary: #0052FF;
  --primary-light: #3375FF;
  --primary-dark: #003ECC;
  --primary-subtle: #E5EEFF;

  --accent: #FF5A00;
  --accent-light: #FF7A33;
  --accent-subtle: #FFF0E5;

  --bg: #ffffff;
  --bg-secondary: #f4f5f7;
  --bg-tertiary: #ebecee;
  --bg-blur: rgba(255, 255, 255, 0.7);

  --text: #0f1115;
  --text-secondary: #5c606a;
  --text-muted: #9ba0aa;
  --text-inverse: #ffffff;

  --border: #e2e4e9;
  --border-light: #f0f1f5;

  --shadow-sm: 0 2px 8px -2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 8px 24px -4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 24px 48px -12px rgba(0, 0, 0, 0.1);
  --shadow-dock: 0 16px 32px -8px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.03);

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-pill: 9999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  --font-sans: 'Inter', -apple-system, 'PingFang SC', system-ui, sans-serif;
  --font-serif: 'Instrument Serif', Georgia, serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-smooth: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --primary: #4d8aff;
    --primary-light: #6b9fff;
    --primary-dark: #3375FF;
    --primary-subtle: #1a2744;

    --accent: #ff7a33;
    --accent-light: #ff9966;
    --accent-subtle: #2a1f17;

    --bg: #111318;
    --bg-secondary: #1a1d24;
    --bg-tertiary: #22262e;
    --bg-blur: rgba(17, 19, 24, 0.7);

    --text: #eaecf0;
    --text-secondary: #a0a5b0;
    --text-muted: #6b7080;
    --text-inverse: #111318;

    --border: #2a2e38;
    --border-light: #1f2329;

    --shadow-sm: 0 2px 8px -2px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 8px 24px -4px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 24px 48px -12px rgba(0, 0, 0, 0.4);
    --shadow-dock: 0 16px 32px -8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
}

html.dark {
  --primary: #4d8aff;
  --primary-light: #6b9fff;
  --primary-dark: #3375FF;
  --primary-subtle: #1a2744;

  --accent: #ff7a33;
  --accent-light: #ff9966;
  --accent-subtle: #2a1f17;

  --bg: #111318;
  --bg-secondary: #1a1d24;
  --bg-tertiary: #22262e;
  --bg-blur: rgba(17, 19, 24, 0.7);

  --text: #eaecf0;
  --text-secondary: #a0a5b0;
  --text-muted: #6b7080;
  --text-inverse: #111318;

  --border: #2a2e38;
  --border-light: #1f2329;

  --shadow-sm: 0 2px 8px -2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 8px 24px -4px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 24px 48px -12px rgba(0, 0, 0, 0.4);
  --shadow-dock: 0 16px 32px -8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05);
}

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  font-size: 15px;
  line-height: 1.6;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-serif);
  font-weight: 400;
}

button {
  font-family: inherit;
  cursor: pointer;
}
</style>
