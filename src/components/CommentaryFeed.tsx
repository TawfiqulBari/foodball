import { useEffect, useState } from 'react'
import { fetchCommentary } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { MatchCommentary } from '../lib/database.types'

const DOT: Record<string, string> = {
  goal: 'bg-primary',
  ko: 'bg-primary',
  ft: 'bg-muted-foreground',
  ht: 'bg-muted-foreground',
  card: 'bg-yellow',
  note: 'bg-border',
}

/** Live text commentary for a match (auto goal/kickoff/full-time lines + admin
 *  notes), newest-first, updating in real time. */
export function CommentaryFeed({ matchId }: { matchId: number }) {
  const [lines, setLines] = useState<MatchCommentary[]>([])

  useEffect(() => {
    let alive = true
    fetchCommentary(matchId)
      .then((d) => alive && setLines(d))
      .catch(() => {})
    const ch = supabase
      .channel(`commentary-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_commentary', filter: `match_id=eq.${matchId}` },
        (payload) => setLines((prev) => [payload.new as MatchCommentary, ...prev]),
      )
      .subscribe()
    return () => {
      alive = false
      void supabase.removeChannel(ch)
    }
  }, [matchId])

  return (
    <div className="mt-3 rounded-card border border-border bg-card p-4 shadow-sm">
      <h3 className="font-display text-sm font-bold text-foreground">Live commentary</h3>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No commentary yet — it kicks in when the match goes live.</p>
      ) : (
        <ul className="mt-2.5 space-y-2.5">
          {lines.map((l) => {
            const dot = DOT[l.kind] ?? 'bg-border'
            const strong = l.kind === 'goal' || l.kind === 'ko'
            return (
              <li key={l.id} className="flex gap-2.5 text-sm leading-snug">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                <span className={strong ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                  {l.minute != null && (
                    <span className="mr-1.5 rounded bg-muted px-1 text-[11px] font-semibold text-foreground">{l.minute}&apos;</span>
                  )}
                  {l.body}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
