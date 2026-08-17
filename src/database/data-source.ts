import 'reflect-metadata';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { type Env, loadDotEnvIfPresent, validateEnv } from '../config/env';
import { UserSessionEntity } from '../modules/auth/user-session.entity';
import { UserEntity } from '../modules/users/user.entity';
import { InitialSchema1786900000000 } from './migrations/1786900000000-initial-schema';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { QuietTypeormLogger } from './typeorm-logger';

export function buildDataSourceOptions(env: Env): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    // TLS verifies the server certificate. A managed Postgres signed by a
    // private CA needs that CA in the trust store (NODE_EXTRA_CA_CERTS);
    // skipping the check would leave the connection encrypted but open to
    // anyone able to answer in the database's place.
    ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
    // Explicit class arrays, no glob patterns: ESM/SWC-safe, and what is not
    // registered here does not exist.
    entities: [UserEntity, UserSessionEntity],
    migrations: [InitialSchema1786900000000],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    // Custom logger: keeps SQL text but drops the parameter array, which for
    // the users table would otherwise leak emails and password hashes.
    logger: new QuietTypeormLogger(),
    logging: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    maxQueryExecutionTime: 400,
    extra: {
      max: env.DB_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      // Short OLTP queries only; the Postgres JIT is priced for analytics and
      // can spend more time compiling than the query itself. Off for the pool.
      options: '-c jit=off',
    },
  };
}

// CLI entrypoint for `typeorm migration:*`. The app itself connects through
// DatabaseModule; this DataSource exists only for the CLI, which runs
// outside Nest and has to load .env on its own.
loadDotEnvIfPresent();

export default new DataSource(buildDataSourceOptions(validateEnv(process.env)));
