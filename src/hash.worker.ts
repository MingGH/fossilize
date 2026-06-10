import { sha256 } from '@noble/hashes/sha2.js'

const CHUNK_SIZE = 8 * 1024 * 1024

type HashRequest = {
  id: string
  file: File
}

type HashProgress = {
  id: string
  type: 'progress'
  progress: number
}

type HashDone = {
  id: string
  type: 'done'
  hex: string
  bytes: Uint8Array
}

type HashError = {
  id: string
  type: 'error'
  error: string
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  const { id, file } = event.data

  try {
    const hasher = sha256.create()
    let offset = 0

    while (offset < file.size) {
      const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer())
      hasher.update(chunk)
      offset += chunk.byteLength

      const progress = file.size === 0 ? 100 : Math.min(100, (offset / file.size) * 100)
      self.postMessage({ id, type: 'progress', progress } satisfies HashProgress)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const bytes = hasher.digest()
    self.postMessage({ id, type: 'done', hex: toHex(bytes), bytes } satisfies HashDone)
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : '计算 SHA-256 失败',
    } satisfies HashError)
  }
}
