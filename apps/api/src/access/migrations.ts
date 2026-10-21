import { QueryTypes, type Sequelize } from 'sequelize';

const migration = `
CREATE TABLE access_tenants (
 id uuid PRIMARY KEY, slug varchar(64) UNIQUE NOT NULL, name varchar(100) NOT NULL,
 mode varchar(10) NOT NULL CHECK(mode IN ('normal','demo')), offline_device_id uuid,
 offline_expires_at timestamptz
);
CREATE TABLE access_roles (
 tenant_id uuid NOT NULL REFERENCES access_tenants(id), name varchar(20) NOT NULL,
 permissions jsonb NOT NULL, PRIMARY KEY(tenant_id,name)
);
CREATE TABLE access_users (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES access_tenants(id),
 username varchar(64) NOT NULL, display_name varchar(100) NOT NULL,
 password_hash text NOT NULL, role varchar(20) NOT NULL, active boolean NOT NULL DEFAULT true,
 must_change boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 UNIQUE(tenant_id,username), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,role) REFERENCES access_roles(tenant_id,name)
);
CREATE TABLE access_sessions (
 token_hash char(64) PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 user_version integer NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,user_id) REFERENCES access_users(tenant_id,id)
);
CREATE INDEX access_sessions_user ON access_sessions(tenant_id,user_id);
CREATE TABLE access_devices (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES access_tenants(id),
 name varchar(100) NOT NULL, public_key char(64) NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(tenant_id,public_key), UNIQUE(tenant_id,id)
);
ALTER TABLE access_tenants ADD CONSTRAINT offline_device_tenant_fk
 FOREIGN KEY(id,offline_device_id) REFERENCES access_devices(tenant_id,id);
CREATE TABLE access_challenges (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 public_key char(64) NOT NULL, purpose varchar(12) NOT NULL CHECK(purpose IN ('register','lease')),
 message text NOT NULL, expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false,
 FOREIGN KEY(tenant_id,user_id) REFERENCES access_users(tenant_id,id)
);
CREATE INDEX access_challenges_expiry ON access_challenges(expires_at);
CREATE TABLE access_audit (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES access_tenants(id), actor_id uuid,
 event varchar(64) NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES access_users(tenant_id,id)
);
CREATE INDEX access_audit_tenant_date ON access_audit(tenant_id,created_at);
`;

export async function migrateAccess(db: Sequelize) {
  await db.transaction(async (transaction) => {
    await db.query('SELECT pg_advisory_xact_lock(77821501)', { transaction });
    await db.query('CREATE TABLE IF NOT EXISTS piscina_migrations (version varchar(64) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())', { transaction });
    const applied = await db.query<{version: string}>("SELECT version FROM piscina_migrations WHERE version = '001_access'", { type: QueryTypes.SELECT, transaction });
    if (!applied.length) {
      await db.query(migration, { transaction });
      await db.query("INSERT INTO piscina_migrations(version) VALUES ('001_access')", { transaction });
    }
  });
}
