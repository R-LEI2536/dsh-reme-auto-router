/**
 * Bundle the browser half into lib/client.js.
 *
 * The client module system fetches `plugins/<package name>/client.js` and
 * executes it in the page: the artifact must hand its factory to
 * `window.__ModuleLoader__.load({ id, factory })`, with the id equal to the
 * package name, and resolve the shell's shared modules through the injected
 * `require` (react and the UI primitives are platform modules and stay
 * external; every other dependency is either type-only or inlined).
 *
 * Run through `pnpm run build` (see package.json) or `pnpm run build:client`.
 */
import * as esbuild from 'esbuild'

/** Platform modules the frozen shell module table answers; everything else inlines. */
const EXTERNAL = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Package name the loader keys this bundle's row by. */
const MODULE_ID = 'dsh-reme-auto-router'

const result = await esbuild.build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  external: EXTERNAL,
  define: { 'process.env.NODE_ENV': '"production"' },
  // esbuild has no top-level `intro` (the harness's tsdown config does): the
  // handoff line and the CJS shim share the banner, in that order, so the
  // factory body still sees `module`/`exports`.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(MODULE_ID)}, factory: (require) => {\n`
      + 'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  metafile: true,
  logLevel: 'info',
})

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  console.log(`client bundle: ${file} (${meta.bytes} bytes)`)
}
