'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSessionStore } from '@/lib/store'
import { SoccerAnalytics } from './soccer-analytics'
import { PlayerMetrics } from './player-metrics'
import { TeamShape } from './team-shape'
import { Heatmaps } from './heatmaps'
import { PassNetwork } from './pass-network'

export function AnalysisTabs() {
  const { processingStatus, tracks, progress, analyticsData, isRealtimeMode } = useSessionStore()
  
  const hasData = tracks.size > 0 || analyticsData || isRealtimeMode
  
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="analytics" className="h-full flex flex-col">
        <TabsList className="w-full rounded-none border-b bg-gray-50 h-12 px-2">
          <TabsTrigger 
            value="analytics" 
            className="flex-1 text-xs px-2 py-2 h-8 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            Live Analytics
          </TabsTrigger>
          <TabsTrigger 
            value="players" 
            className="flex-1 text-xs px-2 py-2 h-8 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            Players
          </TabsTrigger>
          <TabsTrigger 
            value="team" 
            className="flex-1 text-xs px-2 py-2 h-8 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            Team
          </TabsTrigger>
          <TabsTrigger 
            value="heatmaps" 
            className="flex-1 text-xs px-2 py-2 h-8 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            Heatmaps
          </TabsTrigger>
          <TabsTrigger 
            value="passes" 
            className="flex-1 text-xs px-2 py-2 h-8 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            Passes
          </TabsTrigger>
        </TabsList>
        
        <div className="flex-1 overflow-y-auto">
          <TabsContent value="analytics" className="p-4 m-0 h-full">
            <SoccerAnalytics />
          </TabsContent>
          
          <TabsContent value="players" className="p-4 m-0 h-full">
            <PlayerMetrics />
          </TabsContent>
          
          <TabsContent value="team" className="p-4 m-0 h-full">
            <TeamShape />
          </TabsContent>
          
          <TabsContent value="heatmaps" className="p-4 m-0 h-full">
            <Heatmaps />
          </TabsContent>
          
          <TabsContent value="passes" className="p-4 m-0 h-full">
            <PassNetwork />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
