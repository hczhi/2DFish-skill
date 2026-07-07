import dotenv from 'dotenv';
dotenv.config();

import { initDatabase } from './db/index.js';
import { generateStaticPages } from './services/ssgService.js';

initDatabase();

const result = generateStaticPages();

if (result.success) {
  console.log(`SSG completed. Generated ${result.generated.length} pages.`);
  result.generated.forEach(p => console.log(`  ✓ ${p}`));
} else {
  console.error('SSG failed:');
  result.errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

if (result.errors.length > 0) {
  console.warn('Warnings:');
  result.errors.forEach(e => console.warn(`  ⚠ ${e}`));
}
