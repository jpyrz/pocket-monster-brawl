import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { SaveImportView } from '@pmb/domain'

export const fireRedSaveSize = 128 * 1024

type ParserResult = Omit<
  SaveImportView,
  'uploadId' | 'filename' | 'sourceDevice' | 'profileId' | 'importedAt' | 'rawSaveStored'
>

export class SaveImportError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'SaveImportError'
  }
}

export function validateSaveFilename(encodedFilename: unknown): string {
  if (typeof encodedFilename !== 'string' || !encodedFilename || encodedFilename.length > 600) {
    throw new SaveImportError('A valid save filename is required.', 400)
  }

  let filename: string
  try {
    filename = decodeURIComponent(encodedFilename)
  } catch {
    throw new SaveImportError('The save filename could not be decoded.', 400)
  }

  if (
    filename.length > 200 ||
    filename !== path.basename(filename) ||
    filename.includes('\\') ||
    path.extname(filename).toLowerCase() !== '.sav'
  ) {
    throw new SaveImportError('Choose a raw FireRed .sav file without folders in its name.', 400)
  }
  return filename
}

export function validateSaveBytes(value: unknown): Buffer {
  if (!Buffer.isBuffer(value)) throw new SaveImportError('Upload the save as a binary file.', 400)
  if (value.length !== fireRedSaveSize) {
    throw new SaveImportError('FireRed imports must be exactly 128 KiB. Save states and ROM files are not accepted.', 400)
  }
  return value
}

export async function importFireRedSave(
  bytes: Buffer,
  filename: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveImportView> {
  const parserUrl = process.env.PARSER_URL ?? 'http://127.0.0.1:3002'
  let response: Response
  try {
    response = await fetcher(`${parserUrl}/parse/fire-red`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new SaveImportError('The local save parser is not available. Start it with npm run dev:parser.', 503)
  }

  const body = await response.json() as ParserResult | { error?: string }
  if (!response.ok) {
    throw new SaveImportError('error' in body && body.error ? body.error : 'PKHeX could not parse this save.', 422)
  }

  const parsed = body as ParserResult
  const expectedHash = createHash('sha256').update(bytes).digest('hex')
  if (parsed.sha256 !== expectedHash) {
    throw new SaveImportError('The parser returned a mismatched save fingerprint.', 502)
  }

  return {
    uploadId: randomUUID(),
    filename,
    sourceDevice: 'Analogue Pocket',
    profileId: 'firered-gen3-v1',
    importedAt: new Date().toISOString(),
    rawSaveStored: false,
    ...parsed,
  }
}
