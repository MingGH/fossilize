import { useMemo, useRef, useState } from 'react'
import { sha256 } from '@noble/hashes/sha2.js'
import DetachedTimestampFile from 'javascript-opentimestamps/src/detached-timestamp-file.js'
import Context from 'javascript-opentimestamps/src/context.js'
import Timestamp from 'javascript-opentimestamps/src/timestamp.js'
import Ops from 'javascript-opentimestamps/src/ops.js'
import Notary from 'javascript-opentimestamps/src/notary.js'
import './App.css'

const CORS_PROXY_PREFIX = 'https://proxy.onetool.app/proxy/'
const WORKER_URL = `${CORS_PROXY_PREFIX}https://a.pool.opentimestamps.org/digest`
const BLOCKSTREAM_API = 'https://blockstream.info/api'

const bytesToHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const equalBytes = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((value, index) => value === b[index])

const reverseBytes = (bytes: ArrayLike<number>) => Array.from(bytes).reverse()

const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const downloadBytes = (bytes: Uint8Array, filename: string) => {
  const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

type HashResult = {
  hex: string
  bytes: Uint8Array
}

type IconName = 'seal' | 'upload' | 'verify' | 'file' | 'hash' | 'chain' | 'download' | 'shield'

const iconPaths: Record<IconName, string[]> = {
  seal: [
    'M12 3.75 5.25 6.75v5.25c0 4.31 2.83 8.21 6.75 9.5 3.92-1.29 6.75-5.19 6.75-9.5V6.75L12 3.75Z',
    'm9.75 12.25 1.55 1.55 3.45-3.6',
  ],
  upload: [
    'M12 16.5V5.75',
    'm8.25 9.25 3.75-3.75 3.75 3.75',
    'M5 17.5v1.25A2.25 2.25 0 0 0 7.25 21h9.5A2.25 2.25 0 0 0 19 18.75V17.5',
  ],
  verify: [
    'M9 12.75 11.25 15 15.5 9.75',
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  ],
  file: [
    'M7.5 3.75h6l4 4v12.5H7.5V3.75Z',
    'M13.5 3.75V8h4',
    'M9.75 13h4.5M9.75 16h3',
  ],
  hash: ['M10 4.75 8.5 19.25', 'M15.5 4.75 14 19.25', 'M5.75 9h12.5', 'M5.25 15h12.5'],
  chain: [
    'M9.75 7.75 8.4 6.4a3.15 3.15 0 0 0-4.46 4.46l2.05 2.05a3.15 3.15 0 0 0 4.46 0l1.05-1.05',
    'm14.25 16.25 1.35 1.35a3.15 3.15 0 0 0 4.46-4.46l-2.05-2.05a3.15 3.15 0 0 0-4.46 0l-1.05 1.05',
    'm9.75 14.25 4.5-4.5',
  ],
  download: [
    'M12 4.75V15.5',
    'm8.25 12 3.75 3.75L15.75 12',
    'M5 17.75v1A2.25 2.25 0 0 0 7.25 21h9.5A2.25 2.25 0 0 0 19 18.75v-1',
  ],
  shield: [
    'M12 3.75 5.25 6.6v5.42c0 4.15 2.75 7.95 6.75 9.48 4-1.53 6.75-5.33 6.75-9.48V6.6L12 3.75Z',
    'M9.25 12.25h5.5M12 9.5V15',
  ],
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {iconPaths[name].map((path) => (
        <path key={path} d={path} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

const hashFile = (file: File, onProgress: (progress: number) => void): Promise<HashResult> => {
  const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' })
  const id = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.id !== id) return

      if (event.data.type === 'progress') {
        onProgress(event.data.progress)
      }

      if (event.data.type === 'done') {
        worker.terminate()
        resolve({ hex: event.data.hex, bytes: event.data.bytes })
      }

      if (event.data.type === 'error') {
        worker.terminate()
        reject(new Error(event.data.error))
      }
    }

    worker.onerror = () => {
      worker.terminate()
      reject(new Error('哈希计算线程异常'))
    }

    worker.postMessage({ id, file })
  })
}

function DropZone({
  label,
  description,
  accept,
  icon,
  file,
  onFile,
}: {
  label: string
  description: string
  accept?: string
  icon: IconName
  file: File | null
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <button
      className="drop-zone"
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const dropped = event.dataTransfer.files[0]
        if (dropped) onFile(dropped)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(event) => {
          const selected = event.target.files?.[0]
          if (selected) onFile(selected)
        }}
      />
      <span className="drop-icon">
        <Icon name={icon} />
      </span>
      <span className="drop-label">{label}</span>
      <strong>{file ? file.name : '拖拽文件到此处'}</strong>
      <small>{file ? formatSize(file.size) : description}</small>
    </button>
  )
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-wrap">
      <div className="progress-meta">
        <span>处理进度</span>
        <strong>{value.toFixed(0)}%</strong>
      </div>
      <div className="progress" aria-label="计算进度">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="loading-spinner" />
        <p className="loading-message">{message}</p>
        <p className="loading-hint">正在与区块链网络通信，可能需要多次请求，请耐心等待…</p>
      </div>
    </div>
  )
}

function NotarizeTab() {
  const [file, setFile] = useState<File | null>(null)
  const [hash, setHash] = useState('')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('选择文件后，将在本地完成摘要计算并生成存证文件。')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const canSubmit = useMemo(() => Boolean(file) && !busy, [file, busy])

  const notarize = async () => {
    if (!file) return
    if (!WORKER_URL) {
      setError('请先在 src/App.tsx 中填写 Cloudflare Worker 地址常量 WORKER_URL')
      return
    }

    setBusy(true)
    setError('')
    setHash('')
    setProgress(0)

    try {
      setStatus('正在本地分块计算 SHA-256。')
      const digest = await hashFile(file, setProgress)
      setHash(digest.hex)

      setStatus('正在提交摘要到 OpenTimestamps calendar。')
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: toArrayBuffer(digest.bytes),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `Worker 返回 HTTP ${response.status}`)
      }

      const timestampBytes = new Uint8Array(await response.arrayBuffer())
      const timestamp = Timestamp.deserialize(
        new Context.StreamDeserialization(timestampBytes),
        Array.from(digest.bytes),
      )
      const detached = new DetachedTimestampFile(new Ops.OpSHA256(), timestamp)
      downloadBytes(detached.serializeToBytes(), `${file.name}.ots`)
      setStatus('存证文件已生成并开始下载。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '存证失败')
      setStatus('存证未完成，请检查网络或代理配置。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="work-card">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Timestamp</span>
          <h2>创建文件存在性证明</h2>
        </div>
        <p>仅上传文件摘要，原始文件始终保留在本地。</p>
      </div>

      <div className="notice-card">
        <Icon name="chain" />
        <p>
          刚生成的 .ots 通常处于待上链状态。OpenTimestamps calendar 需要一段时间将摘要聚合并写入 Bitcoin 区块；
          等区块确认后，证明才能包含最终的链上时间戳。
        </p>
      </div>

      <DropZone
        label="待存证文件"
        description="支持任意格式，大文件将分块处理"
        icon="upload"
        file={file}
        onFile={setFile}
      />

      <div className="action-row">
        <button className="primary" type="button" disabled={!canSubmit} onClick={notarize}>
          <Icon name="seal" />
          生成存证文件
        </button>
        <p className="status">{status}</p>
      </div>

      <ProgressBar value={progress} />

      {hash && (
        <div className="info-card">
          <span className="info-icon">
            <Icon name="hash" />
          </span>
          <div>
            <span>SHA-256 摘要</span>
            <code>{hash}</code>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

type TimestampNode = {
  msg: number[]
  attestations: any[]
}

type TxResponse = {
  txid: string
  status?: {
    confirmed?: boolean
    block_height?: number
    block_hash?: string
  }
  vout?: Array<{
    scriptpubkey?: string
    scriptpubkey_asm?: string
  }>
}

type BlockResponse = {
  id: string
  height: number
  timestamp: number
  merkle_root: string
}

type VerificationSuccess = {
  height: number
  time: string
  blockHash: string
  blockUrl: string
  txid: string
  txUrl: string
}

type PendingProof = {
  uri: string
  msg: number[]
  timestamp: any  // reference to the actual Timestamp node for merging
}

type UpgradeResult = {
  changed: boolean
  bitcoinCount: number
  pendingCount: number
  fileName: string
  detached?: any  // upgraded DetachedTimestampFile kept in memory
}

const collectNodes = (timestamp: any): TimestampNode[] => {
  const nodes: TimestampNode[] = [{ msg: Array.from(timestamp.msg), attestations: timestamp.attestations ?? [] }]
  timestamp.ops?.forEach((child: any) => {
    nodes.push(...collectNodes(child))
  })
  return nodes
}

const countBitcoinAttestations = (timestamp: any) =>
  collectNodes(timestamp).reduce(
    (count, node) =>
      count + node.attestations.filter((attestation) => attestation instanceof Notary.BitcoinBlockHeaderAttestation).length,
    0,
  )

const collectPendingProofsFromTimestamp = (timestamp: any): PendingProof[] => {
  const results: PendingProof[] = []
  for (const att of (timestamp.attestations ?? [])) {
    if (att instanceof Notary.PendingAttestation) {
      results.push({ uri: att.uri, msg: Array.from(timestamp.msg), timestamp })
    }
  }
  if (timestamp.ops) {
    timestamp.ops.forEach((child: any) => {
      results.push(...collectPendingProofsFromTimestamp(child))
    })
  }
  return results
}

const proxiedUrl = (url: string) => `${CORS_PROXY_PREFIX}${url}`

const upgradeDetachedTimestamp = async (otsFile: File): Promise<UpgradeResult> => {
  const otsBytes = new Uint8Array(await otsFile.arrayBuffer())
  const detached = DetachedTimestampFile.deserialize(otsBytes)
  const beforeBitcoinCount = countBitcoinAttestations(detached.timestamp)
  const pendingProofs = collectPendingProofsFromTimestamp(detached.timestamp)

  if (pendingProofs.length === 0) {
    return {
      changed: false,
      bitcoinCount: beforeBitcoinCount,
      pendingCount: 0,
      fileName: otsFile.name,
    }
  }

  for (const pending of pendingProofs) {
    const url = `${pending.uri.replace(/\/$/, '')}/timestamp/${bytesToHex(pending.msg)}`
    const response = await fetch(proxiedUrl(url), {
      headers: { Accept: 'application/vnd.opentimestamps.v1' },
    })

    if (response.status === 404) continue
    if (!response.ok) throw new Error(`查询 calendar 失败：HTTP ${response.status}`)

    const timestampBytes = new Uint8Array(await response.arrayBuffer())
    const upgradedTimestamp = Timestamp.deserialize(
      new Context.StreamDeserialization(timestampBytes),
      Array.from(pending.msg),
    )
    pending.timestamp.merge(upgradedTimestamp)
  }

  const bitcoinCount = countBitcoinAttestations(detached.timestamp)
  const changed = bitcoinCount > beforeBitcoinCount

  if (changed) {
    const upgradedName = otsFile.name.replace(/\.ots$/i, '.upgraded.ots')
    downloadBytes(detached.serializeToBytes(), upgradedName)
  }

  return {
    changed,
    bitcoinCount,
    pendingCount: pendingProofs.length,
    fileName: otsFile.name,
    detached,
  }
}

const findTxForHeight = async (
  nodes: TimestampNode[],
  height: number,
  onStep?: (current: number, total: number) => void,
) => {
  const candidates = nodes
    .map((node) => new Uint8Array(node.msg))
    .filter((msg) => msg.length > 60 && msg.length < 4096)

  for (let i = 0; i < candidates.length; i++) {
    onStep?.(i + 1, candidates.length)
    const rawTx = candidates[i]
    const txid = bytesToHex(reverseBytes(sha256(sha256(rawTx))))
    const response = await fetch(`${BLOCKSTREAM_API}/tx/${txid}`)
    if (!response.ok) continue

    const tx = (await response.json()) as TxResponse
    if (tx.status?.confirmed && tx.status.block_height === height) {
      return tx
    }
  }

  throw new Error('未能在 .ots 证明路径中定位可由 blockstream 查询的 Bitcoin 交易')
}

const verifyOpReturn = (tx: TxResponse, nodes: TimestampNode[]) => {
  const proofHexes = new Set<string>()
  nodes.forEach((node) => {
    if (node.msg.length >= 20 && node.msg.length <= 64) {
      proofHexes.add(bytesToHex(node.msg))
      proofHexes.add(bytesToHex(reverseBytes(node.msg)))
    }
  })

  return tx.vout?.some((output) => {
    const script = `${output.scriptpubkey ?? ''} ${output.scriptpubkey_asm ?? ''}`
    return script.includes('OP_RETURN') && Array.from(proofHexes).some((hex) => script.includes(hex))
  })
}

async function verifyDetachedTimestamp(
  file: File,
  otsFile: File,
  onProgress: (progress: number) => void,
  onStep?: (current: number, total: number) => void,
) {
  const digest = await hashFile(file, onProgress)
  const otsBytes = new Uint8Array(await otsFile.arrayBuffer())
  const detached = DetachedTimestampFile.deserialize(otsBytes)

  if (!equalBytes(detached.fileDigest(), digest.bytes)) {
    throw new Error('原始文件 SHA-256 与 .ots 文件中记录的摘要不匹配')
  }

  const nodes = collectNodes(detached.timestamp)
  const bitcoinNodes = nodes.flatMap((node) =>
    node.attestations
      .filter((attestation) => attestation instanceof Notary.BitcoinBlockHeaderAttestation)
      .map((attestation) => ({ node, attestation })),
  )

  if (bitcoinNodes.length === 0) {
    throw new Error('该 .ots 尚未包含 Bitcoin 区块证明，可能仍是 PendingAttestation，请稍后升级后再验证')
  }

  const { node, attestation } = bitcoinNodes.sort((a, b) => a.attestation.height - b.attestation.height)[0]
  const tx = await findTxForHeight(nodes, attestation.height, onStep)

  if (!verifyOpReturn(tx, nodes)) {
    throw new Error('交易 OP_RETURN 与 .ots 证明路径中的承诺不匹配')
  }

  const blockHash = tx.status?.block_hash
  if (!blockHash) throw new Error('blockstream 交易响应缺少区块哈希')

  const blockResponse = await fetch(`${BLOCKSTREAM_API}/block/${blockHash}`)
  if (!blockResponse.ok) throw new Error(`blockstream 区块查询失败：HTTP ${blockResponse.status}`)

  const block = (await blockResponse.json()) as BlockResponse
  const expectedMerkleRoot = bytesToHex(reverseBytes(node.msg))

  if (block.height !== attestation.height) {
    throw new Error('区块高度与 .ots 证明中的 Bitcoin attestation 不匹配')
  }

  if (block.merkle_root !== expectedMerkleRoot) {
    throw new Error('区块 merkle_root 与 .ots 执行结果不匹配')
  }

  return {
    height: block.height,
    time: new Date(block.timestamp * 1000).toLocaleString(),
    blockHash,
    blockUrl: `https://blockstream.info/block/${blockHash}`,
    txid: tx.txid,
    txUrl: `https://blockstream.info/tx/${tx.txid}`,
  } satisfies VerificationSuccess
}

function VerifyTab() {
  const [file, setFile] = useState<File | null>(null)
  const [otsFile, setOtsFile] = useState<File | null>(null)
  const [upgradedDetached, setUpgradedDetached] = useState<any>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<VerificationSuccess | null>(null)
  const [upgradeResult, setUpgradeResult] = useState<UpgradeResult | null>(null)
  const [status, setStatus] = useState('上传原始文件和对应 .ots 文件后，将在本地完成校验。')
  const [upgradeStatus, setUpgradeStatus] = useState('如果验证提示 pending，可点击升级 .ots，工具会自动调用 calendar 并把结果合并到内存中的 .ots，再继续验证。')
  const [error, setError] = useState('')
  const [upgradeError, setUpgradeError] = useState('')
  const [busy, setBusy] = useState(false)
  const [upgradeBusy, setUpgradeBusy] = useState(false)

  const canVerify = Boolean(file && otsFile && !busy)
  const canUpgrade = Boolean(otsFile && !upgradeBusy)

  const verify = async () => {
    if (!file || !otsFile) return

    setBusy(true)
    setError('')
    setResult(null)
    setProgress(0)
    setStatus('正在重新计算文件摘要并解析证明。')

    const onStep = (current: number, total: number) => {
      setStatus(`正在查询 Blockstream 网络验证交易（${current}/${total}）…`)
    }

    try {
      // If we have an upgraded detached in memory, use it directly
      if (upgradedDetached) {
        const digest = await hashFile(file, setProgress)
        if (!equalBytes(upgradedDetached.fileDigest(), digest.bytes)) {
          throw new Error('原始文件 SHA-256 与 .ots 文件中记录的摘要不匹配')
        }

        const nodes = collectNodes(upgradedDetached.timestamp)
        const bitcoinNodes = nodes.flatMap((node) =>
          node.attestations
            .filter((attestation) => attestation instanceof Notary.BitcoinBlockHeaderAttestation)
            .map((attestation) => ({ node, attestation })),
        )

        if (bitcoinNodes.length === 0) {
          throw new Error('该 .ots 尚未包含 Bitcoin 区块证明，可能仍是 PendingAttestation，请稍后升级后再验证')
        }

        setStatus('正在查询 Blockstream 网络定位交易…')
        const { node, attestation } = bitcoinNodes.sort((a, b) => a.attestation.height - b.attestation.height)[0]
        const tx = await findTxForHeight(nodes, attestation.height, onStep)

        if (!verifyOpReturn(tx, nodes)) {
          throw new Error('交易 OP_RETURN 与 .ots 证明路径中的承诺不匹配')
        }

        const blockHash = tx.status?.block_hash
        if (!blockHash) throw new Error('blockstream 交易响应缺少区块哈希')

        setStatus('正在查询区块信息…')
        const blockResponse = await fetch(`${BLOCKSTREAM_API}/block/${blockHash}`)
        if (!blockResponse.ok) throw new Error(`blockstream 区块查询失败：HTTP ${blockResponse.status}`)

        const block = (await blockResponse.json()) as BlockResponse
        const expectedMerkleRoot = bytesToHex(reverseBytes(node.msg))

        if (block.height !== attestation.height) {
          throw new Error('区块高度与 .ots 证明中的 Bitcoin attestation 不匹配')
        }

        if (block.merkle_root !== expectedMerkleRoot) {
          throw new Error('区块 merkle_root 与 .ots 执行结果不匹配')
        }

        const verification = {
          height: block.height,
          time: new Date(block.timestamp * 1000).toLocaleString(),
          blockHash,
          blockUrl: `https://blockstream.info/block/${blockHash}`,
          txid: tx.txid,
          txUrl: `https://blockstream.info/tx/${tx.txid}`,
        } satisfies VerificationSuccess
        setResult(verification)
        setStatus('验证通过，证明与链上记录一致。')
      } else {
        const verification = await verifyDetachedTimestamp(file, otsFile, setProgress, onStep)
        setResult(verification)
        setStatus('验证通过，证明与链上记录一致。')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证失败')
      setStatus('验证未通过。')
    } finally {
      setBusy(false)
    }
  }

  const upgrade = async () => {
    if (!otsFile) return

    setUpgradeBusy(true)
    setUpgradeError('')
    setUpgradeResult(null)
    setUpgradeStatus('正在查询 OpenTimestamps calendar。')

    try {
      const upgraded = await upgradeDetachedTimestamp(otsFile)
      setUpgradeResult(upgraded)
      if (upgraded.changed && upgraded.detached) {
        setUpgradedDetached(upgraded.detached)
        setUpgradeStatus('✅ 升级成功，新的 .ots 已合并到当前证明，可直接点击开始验证。')
      } else if (upgraded.bitcoinCount > 0) {
        setUpgradeStatus('该 .ots 已经包含 Bitcoin 区块证明，无需升级。')
      } else {
        setUpgradeStatus('暂未查询到 Bitcoin 区块证明，请稍后再试。')
      }
    } catch (reason) {
      setUpgradeError(reason instanceof Error ? reason.message : '升级失败')
      setUpgradeStatus('升级未完成。')
    } finally {
      setUpgradeBusy(false)
    }
  }

  return (
    <section className="work-card" style={{ position: 'relative' }}>
      {busy && <LoadingOverlay message={status} />}
      {upgradeBusy && <LoadingOverlay message={upgradeStatus} />}

      <div className="section-heading">
        <div>
          <span className="section-kicker">Verification</span>
          <h2>验证与升级</h2>
        </div>
        <p>校验原始文件摘要与链上记录，或对 pending .ots 进行升级。</p>
      </div>

      <div className="grid">
        <DropZone label="原始文件" description="选择需要核验的原文件" icon="file" file={file} onFile={setFile} />
        <DropZone label="存证文件" description="选择对应的 .ots 文件" icon="shield" accept=".ots" file={otsFile} onFile={(f) => { setOtsFile(f); setUpgradedDetached(null); setResult(null); setUpgradeResult(null); setError(''); setUpgradeError('') }} />
      </div>

      <div className="button-group">
        <button className="primary" type="button" disabled={!canVerify} onClick={verify}>
          <Icon name="verify" />
          开始验证
        </button>
        <button className="primary" type="button" disabled={!canUpgrade} onClick={upgrade}>
          <Icon name="download" />
          升级 .ots 证明
        </button>
      </div>

      <div className="status-group">
        <div>
          <p className="status">{status}</p>
          {error && <p className="error">{error}</p>}
        </div>
        <div>
          <p className={`status${upgradedDetached ? ' success' : ''}`}>{upgradeStatus}</p>
          {upgradeError && <p className="error">{upgradeError}</p>}
        </div>
      </div>

      <ProgressBar value={progress} />

      {result && (
        <div className="success-card">
          <span className="success-icon">
            <Icon name="chain" />
          </span>
          <div>
            <span>验证结论</span>
            <h3>文件在 {result.time} 之前已存在</h3>
            <p>Bitcoin 区块高度 {result.height}</p>
            <a href={result.blockUrl} target="_blank" rel="noreferrer">
              查看 Blockstream 区块记录
            </a>
            <a href={result.txUrl} target="_blank" rel="noreferrer">
              查看 OP_RETURN 交易
            </a>
          </div>
        </div>
      )}

      {upgradeResult && (
        <div className="success-card">
          <span className="success-icon">
            <Icon name="download" />
          </span>
          <div>
            <span>升级结果</span>
            <h3>{upgradeResult.changed ? '已生成升级后的 .ots 文件' : '暂未生成新的 .ots 文件'}</h3>
            <p>
              当前 Bitcoin 证明数量：{upgradeResult.bitcoinCount}；pending 记录数量：{upgradeResult.pendingCount}。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function Capability({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="capability">
      <Icon name={icon} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState<'notarize' | 'verify'>('notarize')

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="brand-row">
          <span className="brand-mark"><Icon name="seal" /></span>
          <span>Fossilize</span>
        </div>
        <div className="hero-copy">
          <span className="eyebrow">OpenTimestamps 文件存证</span>
          <h1>为重要文件生成可验证的存在性证明</h1>
          <p>
            文件不离开浏览器。系统只提交 SHA-256 摘要，并生成可独立保存、可链上验证的 .ots 证明文件。
          </p>
        </div>
        <div className="capability-list">
          <Capability icon="hash" title="本地摘要" text="分块计算，适合大文件" />
          <Capability icon="download" title="证明留存" text="自动下载 .ots 文件" />
          <Capability icon="chain" title="链上验证" text="直连 Blockstream 查询" />
        </div>
      </section>

      <section className="workspace">
        <nav className="tabs" aria-label="功能标签">
          <button className={tab === 'notarize' ? 'active' : ''} type="button" onClick={() => setTab('notarize')}>
            <Icon name="seal" />
            <span>创建存证</span>
          </button>
          <button className={tab === 'verify' ? 'active' : ''} type="button" onClick={() => setTab('verify')}>
            <Icon name="verify" />
            <span>验证证明</span>
          </button>
        </nav>

        {tab === 'notarize' ? <NotarizeTab /> : <VerifyTab />}
      </section>

      <footer className="site-footer">
        <span></span>
        <a href="https://www.runnable.run/about" target="_blank" rel="noreferrer">Asher的博客</a>
        <a href="https://996.ninja/" target="_blank" rel="noreferrer">996忍者</a>
        <a href="https://github.com/MingGH/fossilize" target="_blank" rel="noreferrer">GitHub 源码</a>
      </footer>
    </main>
  )
}

export default App
