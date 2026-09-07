'use client'

import { useEffect } from 'react'
import { VideoUpload } from '@/components/video-upload'
import { VideoPlayer } from '@/components/video-player'
import { ControlPanel } from '@/components/control-panel'
import { AnalysisTabs } from '@/components/analysis-tabs'
import { Timeline } from '@/components/timeline'
import { Header } from '@/components/header'
import { useSessionStore } from '@/lib/store'

export default function WorkspacePage() {
  const { sessionId, createSession, loadVideoFromUrl } = useSessionStore()

  useEffect(() => {
    if (!sessionId) {
      createSession()
    }
  }, [sessionId, createSession])

  // `?video=<url>` opens the workspace straight onto a clip, which makes the
  // dashboard shareable as a live demo link.
  useEffect(() => {
    if (!sessionId) return
    const url = new URLSearchParams(window.location.search).get('video')
    if (url) void loadVideoFromUrl(url)
    // Only the first session gets the deep-linked clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <div className="w-80 shrink-0 border-r p-4 space-y-4 overflow-y-auto">
          <VideoUpload />
          <ControlPanel />
        </div>

        {/* Center - Video Player */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative bg-black">
            <VideoPlayer />
          </div>
          <Timeline />
        </div>

        {/* Right Panel - Analysis */}
        <div className="w-96 shrink-0 border-l bg-white flex flex-col">
          <AnalysisTabs />
        </div>
      </div>
    </div>
  )
}
