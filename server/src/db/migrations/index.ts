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
];
