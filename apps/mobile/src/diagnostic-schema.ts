// Persistencia técnica. No contiene alumnos, permisos ni operaciones offline.
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
export const diagnosticSchema = `
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS diagnostic_cache (
  key TEXT PRIMARY KEY CHECK (key = 'api'),
  status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
  checked_at TEXT NOT NULL
);
PRAGMA user_version = 1;
COMMIT;
`;

export interface Diagnostic {
  status: 'ready' | 'unavailable';
  checked_at: string;
}
