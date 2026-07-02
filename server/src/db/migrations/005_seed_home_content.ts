import type { Migration } from '../migrator.js';
import { v4 as uuidv4 } from 'uuid';

export const migration_005: Migration = {
  id: '005_seed_home_content',
  up(db) {
    const now = new Date().toISOString();

    const modules = [
      { title: '摸鱼缸', description: 'AI 驱动的桌面养鱼游戏，摸鱼模式一键隐藏', icon: '🐟', path: '/fish', category: 'Game', featured: 1, require_auth: 0, bg_color: '#f0f5ff', grid_span: '2x2', sort_order: 0 },
      { title: '智慧看板', description: '东方智慧翻页看板，论语·易经·佛法为你解惑', icon: '🎋', path: '/board', category: 'Wisdom', featured: 1, require_auth: 0, bg_color: '#f8faff', grid_span: '1x2', sort_order: 1 },
      { title: '知识管理', description: 'AI 对话 · 顾问 · 内容创作 · App 工作台', icon: '🧠', path: '/synap', category: 'Productivity', featured: 1, require_auth: 1, bg_color: '#f5f5ff', grid_span: '2x1', sort_order: 2 },
      { title: '极简灵感', description: '随时记录你的奇思妙想', icon: '📝', path: '/mock-notes', category: '', featured: 0, require_auth: 0, bg_color: '#f0f4f8', grid_span: '1x1', sort_order: 3 },
      { title: '配色工坊', description: '发现优雅的色彩搭配', icon: '🎨', path: '/mock-colors', category: '', featured: 0, require_auth: 0, bg_color: '#fcfcfc', grid_span: '1x1', sort_order: 4 },
      { title: '专注番茄', description: '极简番茄钟沉浸体验', icon: '⏱️', path: '/mock-focus', category: '', featured: 0, require_auth: 0, bg_color: '#fafafa', grid_span: '1x1', sort_order: 5 },
      { title: '数据透镜', description: '个人数字资产可视化', icon: '📊', path: '/mock-data', category: '', featured: 0, require_auth: 1, bg_color: '#f0f5ff', grid_span: '1x1', sort_order: 6 },
    ];

    const feeds = [
      { title: '如何用 QiaoNan 构建个人效率闭环？', author: 'mmPla Team', icon: '💡', bg_color: '#e6f0ff', avatar_color: '#0077ff', likes: 128, image_height: 280, sort_order: 0 },
      { title: '深度工作：为什么你需要一个极简番茄钟', author: 'Focus Master', icon: '⏱️', bg_color: '#f0fdf4', avatar_color: '#00c853', likes: 89, image_height: 220, sort_order: 1 },
      { title: '分享我的 2026 数字资产管理方案', author: 'Data Geek', icon: '📊', bg_color: '#f3f0ff', avatar_color: '#7b61ff', likes: 210, image_height: 180, sort_order: 2 },
      { title: '摸鱼缸隐藏彩蛋：你发现这只蓝色的鱼了吗？', author: 'Fisher', icon: '🐟', bg_color: '#e6fcff', avatar_color: '#20c997', likes: 999, image_height: 260, sort_order: 3 },
    ];

    const insertModule = db.prepare(`
      INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, image_url, bg_color, sort_order, visible, grid_span, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 1, ?, ?, ?)
    `);

    const insertFeed = db.prepare(`
      INSERT INTO home_feeds (id, title, author, icon, bg_color, avatar_color, link, likes, image_height, sort_order, visible, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1, ?, ?)
    `);

    for (const m of modules) {
      insertModule.run(uuidv4(), m.title, m.description, m.icon, m.path, m.category, m.featured, m.require_auth, m.bg_color, m.sort_order, m.grid_span, now, now);
    }

    for (const f of feeds) {
      insertFeed.run(uuidv4(), f.title, f.author, f.icon, f.bg_color, f.avatar_color, f.likes, f.image_height, f.sort_order, now, now);
    }
  },
};
