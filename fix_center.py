with open('client/src/views/uiReview/UiReviewPage.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. hero-section
content = content.replace(
'''/* Hero Section */
.hero-section {
  position: relative;
  width: 100%;
  padding: 120px 0 80px 0;
  background: transparent;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}''',
'''/* Hero Section */
.hero-section {
  position: relative;
  width: 100%;
  padding: 120px 24px 80px 24px;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}''')

# 2. hero-text-overlay
content = content.replace(
'''.hero-text-overlay {
  position: relative;
  z-index: 10;
  text-align: left;
  max-width: 800px;
}''',
'''.hero-text-overlay {
  position: relative;
  z-index: 10;
  text-align: center;
  max-width: 800px;
  diswith open('client/src/views/uiReview/UiReviewPs:    content = f.read()

# 1. hero-section
content = content.replace(
'''/* Hero Section */
.her color: #4B5563;
  font-sicontent = contenwi'''/* Hero Se 4.hero-section {
  posi1.7;
  font-  positio00;
}  width: 100%;
  pad' padding: 12-s background: transparent3