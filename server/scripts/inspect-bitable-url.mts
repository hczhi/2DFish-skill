// 排查脚本：多维表格的链接落在哪张表、base 里实际有哪些表、链接分享设置是什么。
// 只读，不写库、不改飞书上的任何东西。
//
// 要修的话别用脚本，走后台按钮：标讯管理 > 飞书配置 > 多维表格同步 >
// 「修正链接并收紧权限」（POST /admin/bitable/:userId/secure）——
// 它会补 ?table=、关掉链接分享、清掉自带空表，三件事分开报成败。
// 用法（DB_PATH 必须写在命令行前缀，不能在脚本里 set —— import 已经先跑了）：
//   DB_PATH=./data/app.db ./node_modules/.bin/tsx scripts/inspect-bitable-url.mts
// .env 必须先加载：库里的 App Secret 是用 JWT_SECRET 派生的 key 加密的，
// 不加载就是「密钥解密失败」（见 core/secrets.ts）。
import dotenv from 'dotenv';
dotenv.config();

import { initDatabase, getDatabase } from '../src/db/index.js';
import { getTenantToken, callOpenApi } from '../src/services/tender/feishuOpen.js';

initDatabase();

const row = getDatabase()
  .prepare(
    `SELECT user_id, feishu_app_id, feishu_app_secret, bitable_app_token, bitable_table_id,
            bitable_all_table_id, bitable_url
     FROM tender_user_preferences
     WHERE bitable_app_token IS NOT NULL AND bitable_app_token != ''`
  )
  .get() as any;

if (!row) {
  console.log('没有任何用户创建过多维表格');
  process.exit(0);
}

console.log('库里 bitable_url       :', row.bitable_url);
console.log('库里 bitable_table_id  :', row.bitable_table_id, '（标讯推荐）');
console.log('库里 bitable_all_table :', row.bitable_all_table_id, '（全部标讯）');

const token = await getTenantToken(row.feishu_app_id, row.feishu_app_secret, Date.now());

const tables = await callOpenApi(
  token,
  `/bitable/v1/apps/${row.bitable_app_token}/tables?page_size=50`,
  'GET'
);
console.log('\nbase 里实际的表（飞书返回顺序 = 客户端 tab 顺序）:');
for (const [i, t] of (tables.items || []).entries()) {
  const mark =
    t.table_id === row.bitable_table_id ? ' ← 标讯推荐' :
    t.table_id === row.bitable_all_table_id ? ' ← 全部标讯' : ' ← 库里没记录（建 app 时自带的默认空表？）';
  console.log(`  ${i + 1}. ${t.table_id}  ${t.name}${mark}`);
}

const meta = await callOpenApi(token, `/bitable/v1/apps/${row.bitable_app_token}`, 'GET');
console.log('\n飞书 app.url            :', meta?.app?.url);
console.log('飞书 app.name           :', meta?.app?.name);

// 链接分享策略：卡片按钮发到群里，群里每个人都看得到这个链接。
// 这个值决定「没被授权的人点进去能不能看」。
try {
  const pub = await callOpenApi(
    token,
    `/drive/v1/permissions/${row.bitable_app_token}/public?type=bitable`,
    'GET'
  );
  console.log('\n链接分享设置:', JSON.stringify(pub?.permission_public, null, 2));
} catch (e: any) {
  console.log('\n读链接分享设置失败:', e.message);
}
