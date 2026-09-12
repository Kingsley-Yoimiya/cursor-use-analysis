import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

function modelRatesPlugin(): Plugin {
  const virtualId = 'virtual:model-rates'
  return {
    name: 'virtual-model-rates',
    resolveId(id) {
      if (id === virtualId) return id
      return undefined
    },
    load(id) {
      if (id !== virtualId) return undefined
      const json = readFileSync(
        path.join(repoRoot, 'config', 'model-rates.json'),
        'utf8',
      )
      return `export default ${json}`
    },
  }
}

export default defineConfig({
  plugins: [react(), modelRatesPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
