// Lets `node` run the WebUI's TypeScript sources directly (Node >= 22.18 strips types):
// Chromium's TypeScript imports siblings as './x.js', so map those to './x.ts'.
//
//   cd chrome/browser/resources/swan/node_tests
//   node --import ./ts_loader.mjs --test coda_client_test.mjs web_search_duckduckgo_test.mjs
//
// The TS files must stay "erasable" (no enums / namespaces / parameter properties) and use `import type`.
import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      } catch (e) {
        // fall through to the normal resolution
      }
    }
    return nextResolve(specifier, context);
  },
});
