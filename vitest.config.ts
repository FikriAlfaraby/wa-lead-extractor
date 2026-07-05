import { defineConfig } from "vitest/config";

// Explicit scope, needed now that ui/ has its own test file
// (ui/src/scenarios.test.ts, run via ui's own "npm test"): vitest's default
// glob otherwise sweeps the whole repo and tries to load ui/'s tests here
// too, where the @pipeline alias (defined only in ui/vite.config.ts) and
// ui's node_modules aren't available. Matches the existing test/ convention
// exactly — doesn't change which of the 50 existing tests run.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
