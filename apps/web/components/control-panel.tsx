'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Play, Pause, Zap, Square } from 'lucide-react'
import { useSessionStore } from '@/lib/store'

export function ControlPanel() {
  const [mode, setMode] = useState('preview')
  const { 
    startTracking, 
    startRealtimeTracking, 
    stopRealtimeTracking,
    processingStatus, 
    progress, 
    error,
    isRealtimeMode,
    videoData,
    sessionId,
    backendMode,
    workerInfo,
  } = useSessionStore()

  const handleStart = async () => {
    await startTracking(mode)
  }

  const handleRealtimeStart = async () => {
    await startRealtimeTracking()
  }

  const handleRealtimeStop = () => {
    stopRealtimeTracking()
  }

  const isProcessing = processingStatus === 'processing'
  const isRealtime = processingStatus === 'realtime'
  const hasVideo = !!videoData
  const hasSession = !!sessionId

  return (
    <div className="space-y-4">
      <div className={`text-xs rounded p-2 ${backendMode === 'worker' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
        {backendMode === 'worker'
          ? `YOLO26 worker connected${workerInfo?.device ? ` (${workerInfo.device})` : ''}`
          : 'Demo mode: Vercel cannot run YOLO. Start the local worker for real tracking.'}
      </div>

      <div>
        <Label className="text-base font-medium">Tracking Mode</Label>
        <RadioGroup value={mode} onValueChange={setMode} className="mt-2">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="preview" id="preview" />
            <Label htmlFor="preview" className="font-normal">
              Preview (YOLO26s, faster)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="publish" id="publish" />
            <Label htmlFor="publish" className="font-normal">
              Publish (YOLO26m, higher quality)
            </Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Button
          className="w-full"
          onClick={handleStart}
          disabled={isProcessing || isRealtime || !hasVideo || !hasSession}
        >
          {isProcessing ? (
            <>
              <Pause className="mr-2 h-4 w-4" />
              Processing... {progress}%
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Start Batch Tracking
            </>
          )}
        </Button>

        <Button
          className="w-full"
          variant={isRealtime ? "destructive" : "default"}
          onClick={isRealtime ? handleRealtimeStop : handleRealtimeStart}
          disabled={isProcessing || !hasVideo || !hasSession}
        >
          {isRealtime ? (
            <>
              <Square className="mr-2 h-4 w-4" />
              Stop Real-time Tracking
            </>
          ) : (
            <>
              <Zap className="mr-2 h-4 w-4" />
              Start Real-time Tracking
            </>
          )}
        </Button>
      </div>
      
      {error && (
        <div className="text-red-500 text-sm p-2 bg-red-50 rounded">
          Error: {error}
        </div>
      )}
      
      {processingStatus === 'completed' && (
        <div className="text-green-500 text-sm p-2 bg-green-50 rounded">
          Processing completed successfully!
        </div>
      )}

      {isRealtime && (
        <div className="text-blue-500 text-sm p-2 bg-blue-50 rounded">
          Real-time tracking active
        </div>
      )}

      <div className="text-xs text-gray-500 space-y-1">
        <div>Session: {hasSession ? 'yes' : 'no'}</div>
        <div>Video: {hasVideo ? 'yes' : 'no'}</div>
        <div>Status: {processingStatus}</div>
        {sessionId && <div>ID: {sessionId.slice(0, 8)}...</div>}
      </div>
    </div>
  )
}
