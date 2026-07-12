with open('client/src/views/uiReview/UiReviewPage.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update fadeUp animation
content = content.replace(
'''@keyframes fadeUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}''',
'''@keyframes fadeUp {
  from { opacity: 0; transform: translateY(40px) scale(0.98); filter: blur(4px); }
  to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}''')

# 2. Update search bar styling
content = content.replace(
'''.unified-search-bar {
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 24px;
  padding: 8px 8px 8px 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(0, 0, 0, 0.1);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}''',
'''.unified-search-bar {
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 32px;
  padding: 12px 12px 12px 32px;
  box-shadow: 0 32px 64px -16px rgba(17, 24, 39, 0.08), 0 0 0 1px rgba(17, 24, 39, 0.05);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}''')

content = content.replace(
'''.unified-search-bar.is-focused {
  background: #FFFFFF;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}''',
'''.unified-search-bar.is-focused {
  background: #ffffff;
  box-shadow: 0 40px 80px -16px rgba(17, 24, 39, 0.12), 0 0 0 1px rgba(17, 24, 39, 0.1);
  transform: translateY(-4px);
}''')

content = content.replace(
'''.unified-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 16px;
  color: #111827;
  outline: none;
  min-width: 0;
}''',
'''.unified-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 18px;
  font-weight: 500;
  color: #111827;
  outline: none;
  min-width: 0;
}''')

content = content.replace(
'''.start-btn {
  position: relative;
  overflow: hidden;
  padding: 0 28px;
  height: 48px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 16px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}''',
'''.start-btn {
  position: relative;
  overflow: hidden;
  padding: 0 40px;
  height: 56px;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 24px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}''')

content = content.replace(
'''.hero-badge {
  display: inline-block;
  padding: 4px 12px;
  background: transparent;
  color: #111827;
  border: 1px solid #111827;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 32px;
}''',
'''.hero-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 16px;
  background: #ffffff;
  color: #111827;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 100px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 40px;
  box-shadow: 0 4px 12px -4px rgba(17, 24, 39, 0.05);
}''')

with open('client/src/views/uiReview/UiReviewPage.vue', 'w', encoding='utf-8') as f:
    f.write(content)
