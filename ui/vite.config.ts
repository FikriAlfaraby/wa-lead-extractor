import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const pipelineDir = fileURLToPath(new URL('../src', import.meta.url))

// ponytail: root src/ compiles under tsconfig "moduleResolution": "NodeNext",
// which requires relative imports to say "./schema.js" even though the file
// on disk is "schema.ts" (TS rewrites the extension at build time). esbuild
// (what Vite uses to bundle) resolves import specifiers literally and has no
// such rewrite, so a bare alias isn't enough — this plugin falls back to the
// sibling ".ts" file whenever an explicit ".js" import doesn't exist on disk.
function resolveNodeNextTsSources(): Plugin {
  return {
    name: 'resolve-nodenext-ts-sources',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null
      const candidate = resolve(dirname(importer), source)
      if (existsSync(candidate)) return null
      const tsCandidate = candidate.replace(/\.js$/, '.ts')
      return existsSync(tsCandidate) ? tsCandidate : null
    },
  }
}

// https://vite.dev/config/
// `vite build --mode embed` builds the simulator alone, as one script with its
// CSS inlined, for the page on fikrialfaraby.com (see src/embed.tsx).
export default defineConfig(({ mode }) => ({
  plugins: [react(), resolveNodeNextTsSources()],
  resolve: {
    alias: {
      '@pipeline': pipelineDir,
    },
  },
  ...(mode === 'embed' && {
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    publicDir: false as const,
    build: {
      outDir: 'dist-embed',
      emptyOutDir: true,
      lib: {
        entry: fileURLToPath(new URL('src/embed.tsx', import.meta.url)),
        name: 'WaLeadSimulator',
        formats: ['iife' as const],
        fileName: () => 'wa-lead-sim.js',
      },
    },
  }),
}))
