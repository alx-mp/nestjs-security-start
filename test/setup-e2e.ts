/**
 * Runs before every e2e suite. Loads .env for DB credentials and JWT key
 * paths, then forces the values a test run must never inherit from the shell:
 * the test database, a quiet log level, and the lockout thresholds the auth
 * assertions count on.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // No .env (CI passes real vars) or a runtime without loadEnvFile.
}

process.env.NODE_ENV = 'test';
process.env.DB_DATABASE = 'eduia_test';
process.env.LOG_LEVEL = 'warn';
process.env.AUTH_MAX_LOGIN_ATTEMPTS = '5';
process.env.AUTH_LOCKOUT_MINUTES = '15';
