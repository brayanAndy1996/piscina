import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { diagnosticSchema } from '../src/diagnostic-schema.ts';

test('SQLite real conserva diagnóstico al reabrir y repetir inicialización', () => {
  const directory = mkdtempSync(join(tmpdir(), 'piscina-diagnostic-'));
  const withinTemp = relative(resolve(tmpdir()), resolve(directory));
  assert.ok(withinTemp && !withinTemp.startsWith('..') && !isAbsolute(withinTemp));
  const path = join(directory, 'diagnostic.db');
  let db = new DatabaseSync(path);
  try {
    db.exec(diagnosticSchema);
    db.prepare('INSERT INTO diagnostic_cache VALUES (?, ?, ?)').run('api', 'ready', '2026-10-21T12:00:00Z');
    db.close();
    db = new DatabaseSync(path);
    db.exec(diagnosticSchema);
    assert.equal(db.prepare('SELECT count(*) AS n FROM diagnostic_cache').get()?.n, 1);
    assert.equal(db.prepare('SELECT status FROM diagnostic_cache').get()?.status, 'ready');
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
    assert.throws(() => db.prepare('INSERT INTO diagnostic_cache VALUES (?, ?, ?)').run('other', 'ready', 'date'));
    assert.throws(() => db.prepare('UPDATE diagnostic_cache SET status = ?').run('invented'));
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});
