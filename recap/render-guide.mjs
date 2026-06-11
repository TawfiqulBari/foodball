// Render the animated "How to play" guide → out/guide.mp4 + a poster still
// (out/guide-poster.png from the title frame), then install both into the SPA's
// public/ so it ships with the app.   npm run render:guide
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const out = (f) => path.join(__dirname, 'out', f)
const pub = (f) => path.join(__dirname, '..', 'public', f)

console.log('🍔 Bundling Remotion…')
const serveUrl = await bundle({ entryPoint: path.join(__dirname, 'src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'Guide', inputProps: {} })

console.log('🖼  Rendering poster (title frame)…')
await renderStill({ composition, serveUrl, output: out('guide-poster.png'), frame: 20, inputProps: {} })

console.log('🎬 Rendering guide.mp4…')
await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: out('guide.mp4'), inputProps: {} })

fs.copyFileSync(out('guide.mp4'), pub('guide.mp4'))
fs.copyFileSync(out('guide-poster.png'), pub('guide-poster.png'))
console.log('✅ Done → public/guide.mp4 + public/guide-poster.png')
