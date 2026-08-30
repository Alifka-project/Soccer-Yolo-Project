export const WORKER_HTTP = (process.env.NEXT_PUBLIC_WORKER_HTTP_BASE || '').replace(/\/$/, '')
export const WORKER_WS = (process.env.NEXT_PUBLIC_WORKER_WS_BASE || '').replace(/\/$/, '')

export type BackendMode = 'worker' | 'demo'

export function hasWorkerConfig() {
  return Boolean(WORKER_HTTP)
}

export function workerHttpUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${WORKER_HTTP}${normalized}`
}

export function workerWsUrl(path: string) {
  const base = WORKER_WS || WORKER_HTTP.replace(/^http/i, 'ws')
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}
