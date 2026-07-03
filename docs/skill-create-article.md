# Skill: 创建 Discover 文章

## 概述

通过 API 在 QiaoNan 平台的 DISCOVER 栏目下创建一篇文章。支持中英文双语内容，创建后可触发静态页面生成（SSG）以获得 SEO 收录。

## 鉴权

所有请求需在 Header 中携带 API Token：

```
Authorization: Bearer mmPla_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Token 需对应一个 `admin` 角色的用户。否则返回 `403 { "error": "admin required" }`。

---

## 工作流程

```
1. 准备文章数据（slug、中英文内容、元信息）
2. POST /api/discover/admin/articles  → 创建文章
3. （可选）POST /api/discover/admin/articles/:id/generate  → 生成静态页
```

---

## Step 1: 创建文章

### 请求

```
POST /api/discover/admin/articles
Content-Type: application/json
Authorization: Bearer <token>
```

### 请求体

```json
{
  "slug": "my-article-slug",
  "author": "Author Name",
  "icon": "💡",
  "cover_image": "",
  "bg_color": "#f0f5ff",
  "avatar_color": "#0077ff",
  "sort_order": 0,
  "status": "published",
  "visible_locales": ["zh", "en"],
  "contents": [
    {
      "locale": "zh",
      "title": "文章中文标题",
      "summary": "卡片上显示的简短描述",
      "content": "<p>正文 HTML 内容</p>",
      "seo_title": "SEO 标题（留空则使用 title）",
      "seo_description": "搜索结果中的描述",
      "seo_keywords": "关键词1,关键词2"
    },
    {
      "locale": "en",
      "title": "Article English Title",
      "summary": "Short description for card display",
      "content": "<p>Body HTML content</p>",
      "seo_title": "SEO Title (empty = use title)",
      "seo_description": "Search result description",
      "seo_keywords": "keyword1,keyword2"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slug` | string | **是** | URL 标识，仅允许英文、数字、连字符。如 `how-to-use-qiaonan`。全局唯一。 |
| `author` | string | 否 | 作者名称，显示在文章页和卡片上 |
| `icon` | string | 否 | 一个 emoji，用于首页卡片展示。如 `💡` `🎯` `📝` |
| `cover_image` | string | 否 | 封面图 URL，用于 OG 分享图 |
| `bg_color` | string | 否 | 卡片背景色，默认 `#f0f5ff` |
| `avatar_color` | string | 否 | 作者头像色块颜色，默认 `#0077ff` |
| `sort_order` | number | 否 | 排序权重，数字越小越靠前，默认 `0` |
| `status` | string | 否 | `draft` 或 `published`，默认 `draft`。只有 `published` 的文章前台可见 |
| `visible_locales` | string[] | 否 | 选择在哪些语言版本展示，如 `["zh"]`、`["en"]`、`["zh","en"]`。空数组或不传 = 不展示 |
| `contents` | array | 否 | 多语言内容数组，每项对应一个语言版本 |

#### contents 子项字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `locale` | string | **是** | 语言标识：`zh` 或 `en` |
| `title` | string | 是 | 文章标题（该语言版本的主标题） |
| `summary` | string | 否 | 摘要，显示在首页卡片上 |
| `content` | string | 否 | 正文，支持 HTML 格式 |
| `seo_title` | string | 否 | SEO 标题，留空自动使用 title |
| `seo_description` | string | 否 | SEO 描述，用于搜索结果和 OG 标签 |
| `seo_keywords` | string | 否 | SEO 关键词，逗号分隔 |

### 成功响应

```
HTTP 201 Created
```

```json
{
  "id": "uuid-of-created-article",
  "slug": "my-article-slug",
  "author": "Author Name",
  "icon": "💡",
  "cover_image": "",
  "bg_color": "#f0f5ff",
  "avatar_color": "#0077ff",
  "sort_order": 0,
  "visible_locales": ["zh", "en"],
  "status": "published",
  "static_generated_at": null,
  "created_at": "2026-07-03T10:00:00.000Z",
  "updated_at": "2026-07-03T10:00:00.000Z",
  "contents": [
    { "id": "...", "article_id": "...", "locale": "zh", "title": "...", ... },
    { "id": "...", "article_id": "...", "locale": "en", "title": "...", ... }
  ],
  "recommendations": []
}
```

### 错误响应

| HTTP Code | error | 原因 |
|-----------|-------|------|
| 400 | `slug is required` | 未传 slug 字段 |
| 403 | `admin required` | Token 无效或不是 admin 角色 |
| 409 | `slug already exists` | slug 重复，请更换 |

---

## Step 2: 生成静态页（可选）

创建文章后，如果希望生成 SEO 友好的静态 HTML（用于搜索引擎收录），调用此接口。

### 前提条件

- 文章 `status` 为 `published`
- `visible_locales` 不为空
- 服务端 `client/dist/` 目录存在（需先执行前端构建）

### 请求

```
POST /api/discover/admin/articles/:id/generate
Authorization: Bearer <token>
```

`:id` 为文章创建成功后返回的 `id` 字段。

### 成功响应

```json
{
  "success": true,
  "generated": ["/discover/my-article-slug", "/en/discover/my-article-slug"],
  "errors": [],
  "outputDir": "/path/to/client/dist"
}
```

### 错误响应

| HTTP Code | error | 原因 |
|-----------|-------|------|
| 400 | `No visible locales configured for this article` | visible_locales 为空 |
| 403 | `admin required` | 鉴权失败 |
| 404 | `not found` | 文章 ID 不存在 |

---

## 完整示例

### 创建一篇中英文文章并生成静态页

```bash
# Step 1: 创建文章
RESPONSE=$(curl -s -X POST https://your-domain.com/api/discover/admin/articles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mmPla_your_token_here" \
  -d '{
    "slug": "ai-productivity-tips-2026",
    "author": "QiaoNan Team",
    "icon": "🚀",
    "bg_color": "#f0f5ff",
    "avatar_color": "#3B5BDB",
    "sort_order": 1,
    "status": "published",
    "visible_locales": ["zh", "en"],
    "contents": [
      {
        "locale": "zh",
        "title": "2026 AI 效率提升指南",
        "summary": "用 AI 工具打造高效工作流的实用技巧",
        "content": "<h2>为什么需要 AI 工作流</h2><p>在 2026 年...</p>",
        "seo_title": "2026 AI 效率提升指南 - QiaoNan",
        "seo_description": "探索如何用 AI 工具打造高效工作流",
        "seo_keywords": "AI,效率,工作流,2026"
      },
      {
        "locale": "en",
        "title": "2026 AI Productivity Guide",
        "summary": "Practical tips for building efficient workflows with AI",
        "content": "<h2>Why You Need an AI Workflow</h2><p>In 2026...</p>",
        "seo_title": "2026 AI Productivity Guide - QiaoNan",
        "seo_description": "How to build efficient workflows with AI tools",
        "seo_keywords": "AI,productivity,workflow,2026"
      }
    ]
  }')

echo "$RESPONSE"

# 提取文章 ID
ARTICLE_ID=$(echo "$RESPONSE" | jq -r '.id')

# Step 2: 生成静态页
curl -s -X POST "https://your-domain.com/api/discover/admin/articles/$ARTICLE_ID/generate" \
  -H "Authorization: Bearer mmPla_your_token_here"
```

---

## 注意事项

1. **slug 规范**：仅使用小写英文字母、数字和连字符（`-`），不要用中文或特殊字符。slug 一旦创建不可修改。
2. **content 字段支持 HTML**：可使用 `<h2>`、`<h3>`、`<p>`、`<ul>`、`<ol>`、`<blockquote>`、`<code>`、`<pre>`、`<img>` 等标签。
3. **只提交中文**：`visible_locales` 设为 `["zh"]`，`contents` 数组只传 `locale: "zh"` 的一项即可。
4. **只提交英文**：`visible_locales` 设为 `["en"]`，`contents` 数组只传 `locale: "en"` 的一项即可。
5. **草稿模式**：`status` 设为 `draft` 时前台不可见，适合先保存再审核发布。
6. **发布后不生成静态页**：文章仍然可以通过 SPA 路由访问（`/discover/:slug`），只是不会有预渲染的 HTML 给搜索引擎。
