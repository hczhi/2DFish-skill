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
];
