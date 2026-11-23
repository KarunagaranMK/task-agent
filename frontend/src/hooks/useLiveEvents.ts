import { useEffect, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { createStreamTicket, eventStreamUrl } from '../api/client'

export type ConnectionState = 'connecting' | 'live' | 'reconnecting'

export function useLiveEvents(queryClient: QueryClient, enabled: boolean) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [lastMessage, setLastMessage] = useState('')

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let source: EventSource | null = null
    let retryTimer: number | undefined
    let pollTimer: number | undefined
    let attempt = 0

    const connect = async () => {
      if (stopped) return
      setConnectionState(attempt === 0 ? 'connecting' : 'reconnecting')
      try {
        const { ticket } = await createStreamTicket()
        if (stopped) return
        source = new EventSource(eventStreamUrl(ticket))
        source.onopen = () => {
          attempt = 0
          setConnectionState('live')
          if (pollTimer !== undefined) window.clearInterval(pollTimer)
          pollTimer = undefined
        }
        source.addEventListener('notification', event => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as { message?: string }
            setLastMessage(payload.message ?? 'New onboarding update')
          } catch {
            setLastMessage('New onboarding update')
          }
          void queryClient.invalidateQueries()
        })
        source.onerror = () => {
          source?.close()
          source = null
          if (stopped) return
          attempt += 1
          setConnectionState('reconnecting')
          if (attempt >= 3 && pollTimer === undefined) {
            pollTimer = window.setInterval(() => { void queryClient.invalidateQueries() }, 15_000)
          }
          const delay = Math.min(15_000, 1_000 * 2 ** Math.min(attempt - 1, 4))
          retryTimer = window.setTimeout(connect, delay)
        }
      } catch {
        if (stopped) return
        attempt += 1
        setConnectionState('reconnecting')
        if (attempt >= 3 && pollTimer === undefined) {
          pollTimer = window.setInterval(() => { void queryClient.invalidateQueries() }, 15_000)
        }
        const delay = Math.min(15_000, 1_000 * 2 ** Math.min(attempt - 1, 4))
        retryTimer = window.setTimeout(connect, delay)
      }
    }

    void connect()
    return () => {
      stopped = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
      source?.close()
    }
  }, [enabled, queryClient])

  return { connectionState, lastMessage }
}
