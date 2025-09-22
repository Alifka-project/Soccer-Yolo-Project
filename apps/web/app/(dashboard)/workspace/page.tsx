'use client'

import { useState, useEffect } from 'react'
import { VideoUpload } from '@/components/video-upload'
import { VideoPlayer } from '@/components/video-player'
import { ControlPanel } from '@/components/control-panel'
import { AnalysisTabs } from '@/components/analysis-tabs'
import { Timeline } from '@/components/timeline'
import { Header } from '@/components/header'
import { useSessionStore } from '@/lib/store'

export default function WorkspacePage() {
  const { sessionId, createSession } = useSessionStore()

  useEffect(() => {
    if (!sessionId) {
      createSession()
    }
  }, [sessionId, createSession])

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <div className="w-80 border-r p-4 space-y-4 overflow-y-auto">
          <VideoUpload />
          <ControlPanel />
        </div>

        {/* Center - Video Player */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 relative bg-black">
            <VideoPlayer />
          </div>
          <Timeline />
        </div>

        {/* Right Panel - Analysis */}
        <div className="w-96 border-l bg-white flex flex-col">
          <AnalysisTabs />
        </div>
      </div>
    </div>
  )
}
