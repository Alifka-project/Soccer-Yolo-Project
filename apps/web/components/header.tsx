'use client'

import { useSessionStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function Header() {
  const { sessionId, ttl, reset } = useSessionStore()

  return (
    <header className="h-14 border-b px-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Soccer Tracking Dashboard</h1>
        {sessionId && (
          <Badge variant="secondary">
            Session TTL: {Math.floor(ttl / 60)}m
          </Badge>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="cursor-pointer">
          <a href="https://github.com/your-repo" target="_blank" rel="noopener">
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
