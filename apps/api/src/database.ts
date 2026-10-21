import { Sequelize } from 'sequelize';
import type { ApiConfig } from './config.js';

export interface DatabaseConnection {
  authenticate(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(config: ApiConfig): Sequelize {
  return new Sequelize(config.databaseUrl, {
    dialect: 'postgres',
    logging: false,
    pool: { max: 5, min: 0, acquire: 3000, idle: 10000 },
    dialectOptions: {
      connectionTimeoutMillis: 3000,
      statement_timeout: 3000,
      ...(config.databaseSsl ? { ssl: { require: true, rejectUnauthorized: true } } : {}),
    },
    retry: { max: 0 },
  });
}
