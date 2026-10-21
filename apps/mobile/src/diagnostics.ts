import * as SQLite from 'expo-sqlite';
import { diagnosticSchema, DIAGNOSTIC_SCHEMA_VERSION, type Diagnostic } from './diagnostic-schema';

export async function openDiagnostics() {
  const db = await SQLite.openDatabaseAsync('piscina-diagnostics.db');
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) > DIAGNOSTIC_SCHEMA_VERSION) {
    await db.closeAsync();
    throw new Error('Esta versión no admite la base local existente.');
  }
  if ((version?.user_version ?? 0) < DIAGNOSTIC_SCHEMA_VERSION) {
    try { await db.execAsync(diagnosticSchema); }
    catch (error) { await db.closeAsync(); throw error; }
  }
  return db;
}

export async function readDiagnostic(db: SQLite.SQLiteDatabase): Promise<Diagnostic | null> {
  return db.getFirstAsync<Diagnostic>('SELECT status, checked_at FROM diagnostic_cache WHERE key = ?', 'api');
}

export async function saveDiagnostic(db: SQLite.SQLiteDatabase, diagnostic: Diagnostic) {
  await db.runAsync(
    `INSERT INTO diagnostic_cache (key, status, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at`,
    'api', diagnostic.status, diagnostic.checked_at,
  );
}
