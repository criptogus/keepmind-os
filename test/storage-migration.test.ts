import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageManager } from '../src/main/storage/StorageManager';
it('upgrades legacy messages before creating the parent index and preserves data', () => {
 const dir = mkdtempSync(join(tmpdir(), 'km-legacy-'));
 const file = join(dir, 'keepmind-os.db');
 const db = new DatabaseSync(file);
 db.exec("CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, author_kind TEXT, author_id TEXT, author_name TEXT, body TEXT, status TEXT, execution_id TEXT, meta TEXT, created_at TEXT); INSERT INTO messages (id, body) VALUES ('old', 'preserved')");
 db.close();
 const storage = new StorageManager(dir); storage.close();
 const reopened = new StorageManager(dir); reopened.close();
 const check = new DatabaseSync(file);
 expect(check.prepare('SELECT body, parent_id FROM messages WHERE id = ?').get('old')).toMatchObject({ body: 'preserved', parent_id: null });
 expect(check.prepare("SELECT name FROM sqlite_master WHERE name='idx_messages_parent'").get()).toBeTruthy();
 check.close();
});
