import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const notionDir = path.join(rootDir, 'docs', 'notion');

const PAGES = [
  {
    id: '3dd34a9faea380ebb1d1cf8d15f7853b',
    name: 'MASTER_PRD.md',
    title: 'Koma — Open, Context-Aware Manga & Manhwa Translator (Master PRD)',
    url: 'https://app.notion.com/p/Koma-Open-Context-Aware-Manga-Manhwa-Translator-3dd34a9faea380ebb1d1cf8d15f7853b',
  },
  {
    id: '3dd34a9faea380fca850dffd82cced8a',
    name: 'SPRINT_1_PRD.md',
    title: 'Koma — Sprint 1 PRD',
    url: 'https://app.notion.com/p/Koma-Sprint-1-PRD-3dd34a9faea380fca850dffd82cced8a',
  },
];

fs.mkdirSync(notionDir, { recursive: true });

console.log('🔄 Syncing official PRDs from Notion via CLI (ntn)...');

for (const page of PAGES) {
  try {
    const raw = execSync(`/usr/local/bin/ntn pages get ${page.id}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const targetPath = path.join(notionDir, page.name);
    fs.writeFileSync(targetPath, raw.trim() + '\n', 'utf8');
    console.log(`✅ Synced ${page.title} -> docs/notion/${page.name}`);
  } catch (err) {
    console.error(`❌ Failed to fetch Notion page ${page.id}:`, err.message);
    process.exitCode = 1;
  }
}
