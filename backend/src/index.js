import { pathToFileURL } from 'node:url';
import { startServer, handleFatal, maybeRunSeed } from './server.js';

// ---------------------------------------------------------------------------
// Entry point. This module is IMPORT-SAFE.
//
// It contains no top-level side effects: importing it does not listen on a
// port, does not start schedulers and does not write to the database. That
// matters because tooling imports this file — a previous incident seeded the
// PRODUCTION database purely because something did `import('./src/index.js')`.
//
// Startup only happens when this file is executed directly as the program
// (`node src/index.js`, i.e. `npm start` / `npm run dev`).
// ---------------------------------------------------------------------------

const isEntrypoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isEntrypoint) {
  // A failure to start the server is fatal: the platform should restart us.
  startServer().catch((err) => handleFatal('startup', err));
}

export { startServer, handleFatal, maybeRunSeed };
