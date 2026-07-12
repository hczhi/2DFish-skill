import re

with open('client/src/views/uiReview/UiReviewPage.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace purple hex
content = content.replace('#3B5BDB', '#111827')
content = content.replace('#2B45A8', '#000000') # hover state for btn

# Replace rgba purple
content = re.sub(r'rgba\(59,\s*91,\s*219,\s*', 'rgba(0, 0, 0, ', content)

# Remove ambient-orb HTML if any
content = re.sub(r'<!-- Ambient Background Orbs -->\s*<main', '<main', content)
content = re.sub(r'/\* Ambient Orbs \*/.*?(?=\n/\* Animations \*/)', '', content, flags=re.DOTALL)

with open('client/src/views/uiReview/UiReviewPage.vue', 'w', encoding='utf-8') as f:
    f.write(content)
