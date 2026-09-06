'use client'

import { useDeferredValue, useMemo } from 'react'
import { deriveAnalytics } from '@/lib/analytics'
import { useSessionStore } from '@/lib/store'

export function useDerivedAnalytics() {
  const tracks = useSessionStore((state) => state.tracks)
  const analyticsData = useSessionStore((state) => state.analyticsData)
  const videoFps = useSessionStore((state) => state.videoFps)
  const processingStatus = useSessionStore((state) => state.processingStatus)
  const progress = useSessionStore((state) => state.progress)
  const isRealtimeMode = useSessionStore((state) => state.isRealtimeMode)
  const liveStatus = useSessionStore((state) => state.liveStatus)

  const deferredTracks = useDeferredValue(tracks)
  const deferredAnalytics = useDeferredValue(analyticsData)
  const derived = useMemo(
    () => deriveAnalytics(deferredTracks, deferredAnalytics, videoFps),
    [deferredTracks, deferredAnalytics, videoFps],
  )

  return { derived, processingStatus, progress, isRealtimeMode, analyticsData, liveStatus }
}
