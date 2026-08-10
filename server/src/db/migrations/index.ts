import type { Migration } from '../migrator.js';
import { migration_001 } from './001_add_user_id_columns.js';
import { migration_002 } from './002_add_role_and_quota.js';
import { migration_003 } from './003_add_token_scopes.js';
import { migration_004 } from './004_home_content.js';
import { migration_005 } from './005_seed_home_content.js';
import { migration_006 } from './006_seo_config.js';
import { migration_007 } from './007_discover_articles.js';
import { migration_008 } from './008_article_recommendations.js';
import { migration_009 } from './009_page_views.js';
import { migration_010 } from './010_seo_locale.js';
import { migration_011 } from './011_module_tokens.js';
import { migration_012 } from './012_discover_topics.js';
import { migration_013 } from './013_token_version.js';
import { migration_014 } from './014_ad_slots.js';
import { migration_015 } from './015_ad_slot_height.js';
import { migration_016 } from './016_discover_admin_module.js';
import { migration_017 } from './017_ui_review.js';
import { migration_018 } from './018_ui_review_pro_mode.js';
import { migration_019 } from './019_tender_system.js';
import { migration_020 } from './020_tender_home_module.js';
import { migration_021 } from './021_tender_ai_fields.js';
import { migration_022 } from './022_tender_keyword_pool.js';
import { migration_023 } from './023_tender_content_hash.js';
import { migration_024 } from './024_tender_status.js';
import { migration_025 } from './025_tender_user_feedback.js';
import { migration_026 } from './026_performance_indexes.js';
import { migration_027 } from './027_xhs_scoring.js';
import { migration_028 } from './028_xhs_home_module.js';
import { migration_029 } from './029_xhs_weights.js';
import { migration_030 } from './030_skill_registry.js';
import { migration_031 } from './031_skill_files.js';
import { migration_032 } from './032_seed_more_skills.js';
import { migration_033 } from './033_user_writing_skills.js';
import { migration_034 } from './034_sdk_keys.js';
import { migration_035 } from './035_tender_feishu.js';
import { migration_036 } from './036_refresh_writing_style.js';
import { migration_037 } from './037_refresh_ai_detection.js';
import { migration_038 } from './038_refresh_skills_genre.js';
import { migration_039 } from './039_xhs_writer.js';
import { migration_040 } from './040_seed_xhs_structure_skill.js';
import { migration_041 } from './041_ai_providers.js';
import { migration_042 } from './042_ai_logs_full_bodies.js';
import { migration_043 } from './043_tender_user_platforms.js';
import { migration_044 } from './044_tender_module_config.js';
import { migration_045 } from './045_tender_bitable.js';
import { migration_046 } from './046_tender_bitable_all.js';
import { migration_047 } from './047_tender_bitable_sync_fix.js';
import { migration_048 } from './048_tender_company_profile.js';
import { migration_049 } from './049_jobs.js';
import { migration_050 } from './050_encrypt_secrets.js';
import { migration_051 } from './051_drop_dead_tables.js';
import { migration_052 } from './052_dedicated_ai_channel.js';
import { migration_053 } from './053_feishu_assistant.js';
import { migration_054 } from './054_feishu_assistant_home_module.js';
import { migration_055 } from './055_feishu_command_error_detail.js';
import { migration_056 } from './056_seed_feishu_intent_skill.js';
import { migration_057 } from './057_feishu_directory.js';
import { migration_058 } from './058_feishu_chats.js';
import { migration_059 } from './059_feishu_intent_supplement.js';
import { migration_060 } from './060_tender_extract_prompt_deadline.js';
import { migration_061 } from './061_tender_feishu_app_push.js';
import { migration_062 } from './062_per_app_ai_channel.js';
import { migration_063 } from './063_agent_skills.js';
// 064 曾经播一个内置技能 group-assistant（aily 版群助理），
// 已随该功能一起删除；067 负责把老库里那一行清掉。迁移号不复用。
import { migration_065 } from './065_normalize_base_url.js';
import { migration_066 } from './066_feishu_diary.js';
import { migration_067 } from './067_drop_seed_group_assistant.js';
import { migration_068 } from './068_feishu_project_tasks.js';
import { migration_069 } from './069_feishu_diary_record_origin.js';
import { migration_070 } from './070_feishu_task_base.js';

export const allMigrations: Migration[] = [
  migration_001,
  migration_002,
  migration_003,
  migration_004,
  migration_005,
  migration_006,
  migration_007,
  migration_008,
  migration_009,
  migration_010,
  migration_011,
  migration_012,
  migration_013,
  migration_014,
  migration_015,
  migration_016,
  migration_017,
  migration_018,
  migration_019,
  migration_020,
  migration_021,
  migration_022,
  migration_023,
  migration_024,
  migration_025,
  migration_026,
  migration_027,
  migration_028,
  migration_029,
  migration_030,
  migration_031,
  migration_032,
  migration_033,
  migration_034,
  migration_035,
  migration_036,
  migration_037,
  migration_038,
  migration_039,
  migration_040,
  migration_041,
  migration_042,
  migration_043,
  migration_044,
  migration_045,
  migration_046,
  migration_047,
  migration_048,
  migration_049,
  migration_050,
  migration_051,
  migration_052,
  migration_053,
  migration_054,
  migration_055,
  migration_056,
  migration_057,
  migration_058,
  migration_059,
  migration_060,
  migration_061,
  migration_062,
  migration_063,
  migration_065,
  migration_066,
  migration_067,
  migration_068,
  migration_069,
  migration_070,
];
