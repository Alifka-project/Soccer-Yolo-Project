'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Play, Pause, Zap, Square, Cpu, ChevronDown, ChevronRight } from 'lucide-react'
import { useSessionStore } from '@/lib/store'
import { hasWorkerConfig } from '@/lib/config'
import type { DetectorQuality } from '@/lib/vision/detector'

const QUALITY_OPTIONS: Array<{ value: DetectorQuality; label: string; hint: string }> = [
  { value: 'fast', label: 'Fast', hint: 'Single pass, light model — highest detection rate' },
  { value: 'balanced', label: 'Balanced', hint: '2 tiles, light model — default' },
  { value: 'accurate', label: 'Accurate', hint: '2 tiles, full model — best on distant players, slowest' },
]

export function ControlPanel() {
  const [mode, setMode] = useState('preview')
  const [showWorker, setShowWorker] = useState(false)
  const {
    startTracking,
    startRealtimeTracking,
    stopRealtimeTracking,
    processingStatus,
    progress,
    error,
    videoData,
    videoReady,
    isUploading,
    sessionId,
    backendMode,
    workerInfo,
    currentFrame,
    totalFrames,
    liveEnabled,
    liveStatus,
    liveQuality,
    liveFrameCount,
    workerVideoReady,
    setLiveEnabled,
    setLiveQuality,
  } = useSessionStore()

  const isProcessing = processingStatus === 'processing'
  const isRealtime = processingStatus === 'realtime'
  const hasVideo = !!videoData && (backendMode !== 'worker' || videoReady)
  const hasSession = !!sessionId
  const workerConfigured = hasWorkerConfig()

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4 text-emerald-600" />
              Live analysis
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Runs in this browser while the video plays. No upload, no job to start.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={liveEnabled}
            aria-label="Toggle live analysis"
            onClick={() => setLiveEnabled(!liveEnabled)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
              liveEnabled ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
          >
            {/* Positioned with an explicit left rather than a translate. The
                knob previously had no left at all, so it sat at its static
                position - centred, because it lives in a button - and the
                translate pushed it clear of the pill, which read as a bite out
                of the right-hand side. Animating left keeps the offset a single
                unambiguous number instead of depending on transform variables. */}
            <span
              aria-hidden="true"
              style={{ left: liveEnabled ? 18 : 2 }}
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-200 ease-out"
            />
          </button>
        </div>

        {liveEnabled && (
          <>
            <div className="grid grid-cols-3 gap-1">
              {QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  onClick={() => setLiveQuality(option.value)}
                  className={`rounded border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    liveQuality === option.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="rounded bg-gray-50 p-2 text-[11px] text-gray-600 space-y-1">
              <StatusLine
                label="Model"
                value={
                  liveStatus?.state === 'ready'
                    ? `ready · ${liveStatus.backend}`
                    : liveStatus?.state === 'loading'
                      ? 'downloading…'
                      : liveStatus?.state === 'error'
                        ? 'failed'
                        : 'idle'
                }
                tone={liveStatus?.state === 'error' ? 'bad' : liveStatus?.state === 'ready' ? 'good' : 'muted'}
              />
              <StatusLine
                label="Analysis"
                value={
                  liveStatus?.running
                    ? `${liveStatus.analysisFps.toFixed(1)} fps · ${liveStatus.inferenceMs}ms`
                    : videoData
                      ? 'paused — press play'
                      : 'waiting for video'
                }
                tone={liveStatus?.running ? 'good' : 'muted'}
              />
              <StatusLine
                label="Detected"
                value={`${liveStatus?.detectedPlayers ?? 0} players · ${liveStatus?.ballDetected ? 'ball ✓' : 'no ball'}`}
                tone={liveStatus?.detectedPlayers ? 'good' : 'muted'}
              />
              <StatusLine label="Frames analysed" value={String(liveFrameCount)} tone="muted" />
            </div>

            {liveStatus?.state === 'error' && (
              <p className="rounded bg-red-50 p-2 text-[11px] text-red-700">
                {liveStatus.message || 'The detector could not start in this browser.'}
              </p>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border bg-white">
        <button
          type="button"
          onClick={() => setShowWorker((value) => !value)}
          className="flex w-full items-center justify-between p-3 text-sm font-semibold"
        >
          <span className="flex items-center gap-2">
            {showWorker ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            High-accuracy worker
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              backendMode === 'worker' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {backendMode === 'worker' ? 'connected' : workerConfigured ? 'offline' : 'not configured'}
          </span>
        </button>

        {showWorker && (
          <div className="space-y-3 border-t p-3">
            <p className="text-[11px] text-muted-foreground">
              Optional YOLO26 backend for a full-quality pass over the whole clip.
              {backendMode === 'worker' && workerInfo?.device ? ` Running on ${workerInfo.device}.` : ''}
              {' '}The clip is sent to the worker only when you start a job here — live
              analysis does not need it.
              {workerVideoReady ? ' Clip already uploaded.' : ''}
            </p>

            <div>
              <Label className="text-xs font-medium">Tracking mode</Label>
              <RadioGroup value={mode} onValueChange={setMode} className="mt-1.5">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="preview" id="preview" />
                  <Label htmlFor="preview" className="text-xs font-normal">
                    Preview{workerInfo?.model_preview ? ` (${workerInfo.model_preview})` : ''}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="publish" id="publish" />
                  <Label htmlFor="publish" className="text-xs font-normal">
                    Publish{workerInfo?.model_publish ? ` (${workerInfo.model_publish})` : ''}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Button
              className="w-full"
              size="sm"
              onClick={() => startTracking(mode)}
              disabled={isProcessing || isRealtime || !hasVideo || !hasSession || isUploading || backendMode !== 'worker'}
            >
              {isProcessing ? (
                <>
                  <Pause className="mr-2 h-4 w-4" />
                  Processing {progress}%{totalFrames > 0 ? ` · ${currentFrame}/${totalFrames}` : ''}
                </>
              ) : isUploading ? (
                'Sending clip to worker…'
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run batch tracking
                </>
              )}
            </Button>

            <Button
              className="w-full"
              size="sm"
              variant={isRealtime ? 'destructive' : 'outline'}
              onClick={isRealtime ? stopRealtimeTracking : startRealtimeTracking}
              disabled={isProcessing || !hasVideo || !hasSession || isUploading || backendMode !== 'worker'}
            >
              {isRealtime ? (
                <>
                  <Square className="mr-2 h-4 w-4" />
                  Stop worker stream
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Stream from worker
                </>
              )}
            </Button>

            {backendMode !== 'worker' && (
              <p className="text-[11px] text-muted-foreground">
                {workerConfigured
                  ? 'Worker unreachable. Live browser analysis is handling the video instead.'
                  : 'Set NEXT_PUBLIC_WORKER_HTTP_BASE to enable. Not required — live analysis already works.'}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</div>
      )}

      {processingStatus === 'completed' && (
        <div className="rounded bg-green-50 p-2 text-sm text-green-600">
          Batch tracking completed.
        </div>
      )}
    </div>
  )
}

function StatusLine({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'good' | 'bad' | 'muted'
}) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-gray-500'
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium tabular-nums ${color}`}>{value}</span>
    </div>
  )
}
