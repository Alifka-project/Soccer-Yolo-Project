'use client'

import { useSessionStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * Names the engine that actually produced the numbers on screen.
 *
 * The badge used to read "YOLO26" whenever a worker was merely reachable, and
 * "Demo" otherwise — neither reflected what was computing the analytics. In
 * browser mode a real detector is running, and a reachable worker is not the
 * same as a worker that did the work.
 */
function engineLabel(
  processingStatus: string,
  backendMode: string,
  detectorReady: boolean,
) {
  if (processingStatus === 'processing' || processingStatus === 'completed') return 'YOLO26 worker'
  if (processingStatus === 'realtime') return 'YOLO26 stream'
  if (processingStatus === 'live') return 'In-browser vision'
  if (detectorReady) return 'In-browser vision · idle'
  return backendMode === 'worker' ? 'Worker connected' : 'Loading engine'
}

export function Header() {
  const sessionId = useSessionStore((state) => state.sessionId)
  const ttl = useSessionStore((state) => state.ttl)
  const reset = useSessionStore((state) => state.reset)
  const backendMode = useSessionStore((state) => state.backendMode)
  const processingStatus = useSessionStore((state) => state.processingStatus)
  const liveStatus = useSessionStore((state) => state.liveStatus)
  const workerVideoReady = useSessionStore((state) => state.workerVideoReady)

  const label = engineLabel(processingStatus, backendMode, liveStatus?.state === 'ready')
  const active = processingStatus === 'live' || processingStatus === 'realtime' || processingStatus === 'processing'

  // The TTL is the worker's session lifetime. There is no server-side session
  // in browser mode, so showing a countdown there would be inventing one.
  const showTtl = backendMode === 'worker' && Boolean(sessionId) && workerVideoReady && ttl > 0

  return (
    <header className="h-14 border-b px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Soccer Tracking Dashboard</h1>
        <Badge variant={active ? 'default' : 'outline'} className="gap-1.5">
          {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
          {label}
        </Badge>
        {showTtl && (
          <Badge variant="secondary">Worker session {Math.floor(ttl / 60)}m</Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="cursor-pointer">
          <a href="https://github.com/Alifka-project/Soccer-Yolo-Project" target="_blank" rel="noopener noreferrer">
            AGPL Open-Source
          </a>
        </Badge>
        <Button variant="outline" size="sm" onClick={reset}>
          Reset Session
        </Button>
      </div>
    </header>
  )
}
