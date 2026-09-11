import { buildApp } from './app.js'
import { createDurableProductService } from './product/DurableProductService.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
const productService = await createDurableProductService()
const staticCandidates = [resolve(process.cwd(), '../web/dist'), resolve(process.cwd(), 'apps/web/dist')]
const staticRoot = process.env.WEB_DIST ?? staticCandidates.find(existsSync)
const app = buildApp({ productService, staticRoot })
let closing = false

async function shutdown() {
  if (closing) return
  closing = true
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

try {
  await app.listen({ port, host })
} catch (error) {
  console.error(error)
  process.exit(1)
}
