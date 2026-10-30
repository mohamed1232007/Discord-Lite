import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const VAD_ASSET_NAMES = [
  'silero_vad_v5.onnx',
  'vad.worklet.bundle.min.js',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]

const sileroVadAssets = () => {
  const packageFiles = new Map([
    ['silero_vad_v5.onnx', resolve('node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx')],
    ['vad.worklet.bundle.min.js', resolve('node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js')],
    ['ort-wasm-simd-threaded.mjs', resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs')],
    ['ort-wasm-simd-threaded.wasm', resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')],
  ])

  return {
    name: 'silero-vad-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname
        const prefix = '/vad-assets/'
        if (!pathname.startsWith(prefix)) {
          next()
          return
        }

        const filename = pathname.slice(prefix.length)
        const filePath = packageFiles.get(filename)
        if (!filePath) {
          next()
          return
        }
        if (!existsSync(filePath)) {
          next(new Error(`Silero VAD asset is missing: ${filePath}`))
          return
        }

        response.setHeader(
          'Content-Type',
          filename.endsWith('.wasm')
            ? 'application/wasm'
            : filename.endsWith('.onnx')
              ? 'application/octet-stream'
              : 'text/javascript',
        )
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        const fileStream = createReadStream(filePath)
        fileStream.on('error', (error) => {
          if (response.headersSent) {
            response.destroy(error)
          } else {
            next(error)
          }
        })
        fileStream.pipe(response)
      })
    },
    generateBundle() {
      VAD_ASSET_NAMES.forEach((filename) => {
        const filePath = packageFiles.get(filename)
        if (!filePath || !existsSync(filePath)) {
          this.error(`Silero VAD asset is missing: ${filePath || filename}`)
        }
        this.emitFile({
          type: 'asset',
          fileName: `vad-assets/${filename}`,
          source: readFileSync(filePath),
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sileroVadAssets(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
})
