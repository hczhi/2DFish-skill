import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, 'data/app.db');
const db = new Database(dbPath);

try {
  db.exec('DELETE FROM ui_review_rules;');
  db.exec('DELETE FROM ui_style_skills;');
  console.log('Old rules and skills deleted successfully.');
} catch (err) {
  console.error('Error deleting data:', err);
}
db.close();
