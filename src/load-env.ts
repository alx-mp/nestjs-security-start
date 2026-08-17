import { loadDotEnvIfPresent } from './config/env';

// Side-effect module: import this FIRST in main.ts. ES module imports run
// before any importer code, so loading .env here guarantees the file is in
// process.env before AppModule is evaluated (its @Module metadata reads env
// at import time). A call inside bootstrap() would run too late.
loadDotEnvIfPresent();
