// Render the animated "How to play" guide (static composition) → out/guide.mp4.
//   npm run render:guide
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

console.log('🍔 Bundling Remotion…')
const serveUrl = await bundle({ entryPoint: path.join(__dirname, 'src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'Guide', inputProps: {} })
const outputLocation = path.join(__dirname, 'out', 'guide.mp4')
console.log(`🎬 Rendering ${outputLocation} …`)
await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation, inputProps: {} })
console.log(`✅ Done: ${outputLocation}`)
