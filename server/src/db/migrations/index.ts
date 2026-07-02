import type { Migration } from '../migrator.js';
import { migration_001 } from './001_add_user_id_columns.js';
import { migration_002 } from './002_add_role_and_quota.js';
import { migration_003 } from './003_add_token_scopes.js';
import { migration_004 } from './004_home_content.js';
import { migration_005 } from './005_seed_home_content.js';
import { migration_006 } from './006_seo_config.js';

export const allMigrations: Migration[] = [
  migration_001,
  migration_002,
  migration_003,
  migration_004,
  migration_005,
  migration_006,
];
