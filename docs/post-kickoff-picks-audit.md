# Post-Kickoff Picks Audit

**Generated:** 2026-06-14 (~14:32 Asia/Dhaka) · **Source:** live DB (`supabase_db_foodball`)
**Scope:** per-match predictions (`match_picks`) that were set after their match had kicked off.

All times below are **Asia/Dhaka (UTC+6)**.

> ## ✅ Resolution (applied 2026-06-14)
> The **23 participant** post-kickoff picks were **voided** via
> `scripts/void-post-kickoff-picks.sql`: each is recorded in the `red_cards` table, its
> `score_events` deleted, and the pick removed — the leaderboard recomputed automatically.
> **Chef tawfiq's 4 picks (ids 69, 71, 79, 227) were excluded** — that's the admin's own
> test data, not a competitor. Reversible backup: `docs/voided-picks-backup-2026-06-14.sql`.
>
> **Points cut:** Emon −45, Fahad −25, pavel −20, nayem −20, ST23 −10 (kaife.adon, Md Rubel,
> shahriar carded but −0, their post-kickoff picks had scored nothing). The deductions are
> shown in-app on the new **Red Cards** screen. Recurrence is prevented by migration `0016`
> (match picks now lock at kickoff).

---

## Methodology & caveat (read first)

`public.match_picks` stores only `created_at` (default `now()`) — there is **no `updated_at`**,
and picks are written via upsert (`on conflict (user_id, match_id, market) do update set
selection = …`). Consequences:

- A prediction **first placed after kickoff** is detectable: `created_at > matches.kickoff`.
- A **silent re-edit** of a pick that already existed *before* kickoff leaves **no timestamp**,
  so it cannot be counted or recovered from this table.

Therefore "how many times" = the number of market predictions a participant **placed** after the
match started (each market counted once). This is a lower bound on tampering — pure edits of
pre-kickoff picks are invisible.

These post-kickoff picks were only possible because the **match-pick launch-grace window**
(migration `0011`) was open. It has since been closed and made inert by migration
**`0016_lock_match_picks_at_kickoff.sql`** — a started/live match now rejects both new picks
**and** changes, so this cannot recur.

---

## Headline

| Metric | Value |
|---|---|
| Post-kickoff picks | **27** |
| Participants involved | **9** |
| Matches affected | **4** |
| Total `match_picks` rows (context) | 586 |

Affected matches: **MEX v RSA** (Jun 12), **CAN v BIH** (Jun 13), **HAI v SCO** (Jun 14),
**AUS v TUR** (Jun 14 — still live at audit time).

---

## Per-participant summary

| Participant | Times | Distinct matches | Latest pick (min after KO) |
|---|---:|---:|---:|
| pavel       | 5 | 2 | 145 |
| ST23        | 4 | 2 | 134 |
| Chef tawfiq | 4 | 1 | 147 |
| Emon        | 4 | 1 | 149 |
| kaife.adon  | 3 | 1 | 115 |
| nayem       | 2 | 2 | 135 |
| Md Rubel    | 2 | 1 |  59 |
| Fahad       | 2 | 1 | 329 |
| shahriar    | 1 | 1 |  85 |

---

## Integrity flags

- **Exact-score picks placed during/after live play** (most unfair — the score is unfolding):
  Chef tawfiq `0-0`, Emon `2-0`, **Fahad `2-0`**, ST23 `0-3` (CAN v BIH, +8 min),
  kaife.adon `2-0`, Md Rubel `0-2`, pavel `1-0`.
- **Fahad — MEX v RSA, +329 min (~5.5 h after kickoff).** The real match had long finished, but
  it was still `live` in the DB (openfootball had not auto-settled it yet) and the grace window
  let the picks through. This is the worst-case gap Bug 1 created.
- **ST23 — CAN v BIH** set outcome + exact score just **7–8 min after kickoff**.
- All **AUS v TUR** entries happened today while grace was still on; they are now blocked by `0016`.

---

## Full detail (27 rows)

| Participant | Match | Status | Market | Selection | Kickoff | Picked | Min after KO |
|---|---|---|---|---|---|---|---:|
| Chef tawfiq | MEX v RSA | finished | btts        | yes   | Jun 12 01:00 | Jun 12 03:04 | 125 |
| Chef tawfiq | MEX v RSA | finished | exact_score | 0-0   | Jun 12 01:00 | Jun 12 03:26 | 147 |
| Chef tawfiq | MEX v RSA | finished | outcome     | draw  | Jun 12 01:00 | Jun 12 03:04 | 124 |
| Chef tawfiq | MEX v RSA | finished | over_under  | over  | Jun 12 01:00 | Jun 12 03:05 | 126 |
| Emon        | MEX v RSA | finished | btts        | no    | Jun 12 01:00 | Jun 12 03:08 | 128 |
| Emon        | MEX v RSA | finished | exact_score | 2-0   | Jun 12 01:00 | Jun 12 03:08 | 129 |
| Emon        | MEX v RSA | finished | outcome     | home  | Jun 12 01:00 | Jun 12 03:28 | 149 |
| Emon        | MEX v RSA | finished | over_under  | under | Jun 12 01:00 | Jun 12 03:08 | 128 |
| Fahad       | MEX v RSA | finished | btts        | yes   | Jun 12 01:00 | Jun 12 06:29 | 329 |
| Fahad       | MEX v RSA | finished | exact_score | 2-0   | Jun 12 01:00 | Jun 12 06:29 | 329 |
| kaife.adon  | AUS v TUR | live     | exact_score | 2-0   | Jun 14 10:00 | Jun 14 11:40 | 101 |
| kaife.adon  | AUS v TUR | live     | outcome     | home  | Jun 14 10:00 | Jun 14 10:58 |  58 |
| kaife.adon  | AUS v TUR | live     | over_under  | under | Jun 14 10:00 | Jun 14 11:54 | 115 |
| Md Rubel    | AUS v TUR | live     | exact_score | 0-2   | Jun 14 10:00 | Jun 14 10:58 |  59 |
| Md Rubel    | AUS v TUR | live     | outcome     | away  | Jun 14 10:00 | Jun 14 10:57 |  57 |
| nayem       | MEX v RSA | finished | outcome     | home  | Jun 12 01:00 | Jun 12 03:14 | 135 |
| nayem       | HAI v SCO | finished | outcome     | away  | Jun 14 07:00 | Jun 14 07:14 |  15 |
| pavel       | MEX v RSA | finished | btts        | no    | Jun 12 01:00 | Jun 12 03:24 | 145 |
| pavel       | MEX v RSA | finished | outcome     | home  | Jun 12 01:00 | Jun 12 03:21 | 141 |
| pavel       | MEX v RSA | finished | over_under  | under | Jun 12 01:00 | Jun 12 03:25 | 145 |
| pavel       | AUS v TUR | live     | exact_score | 1-0   | Jun 14 10:00 | Jun 14 11:11 |  71 |
| pavel       | AUS v TUR | live     | outcome     | home  | Jun 14 10:00 | Jun 14 11:10 |  70 |
| shahriar    | AUS v TUR | live     | outcome     | home  | Jun 14 10:00 | Jun 14 11:24 |  85 |
| ST23        | MEX v RSA | finished | btts        | no    | Jun 12 01:00 | Jun 12 03:13 | 133 |
| ST23        | MEX v RSA | finished | over_under  | under | Jun 12 01:00 | Jun 12 03:14 | 134 |
| ST23        | CAN v BIH | finished | exact_score | 0-3   | Jun 13 01:00 | Jun 13 01:07 |   8 |
| ST23        | CAN v BIH | finished | outcome     | away  | Jun 13 01:00 | Jun 13 01:07 |   7 |

---

## Reproduce

```sql
-- Picks first SET after their match kicked off (Asia/Dhaka display).
select pr.display_name                                   as participant,
       ht.fifa_code || ' v ' || at.fifa_code             as match,
       m.status,
       p.market,
       p.selection,
       to_char(m.kickoff    at time zone 'Asia/Dhaka','Mon DD HH24:MI') as kickoff_bd,
       to_char(p.created_at at time zone 'Asia/Dhaka','Mon DD HH24:MI') as picked_bd,
       round(extract(epoch from (p.created_at - m.kickoff)) / 60)::int   as min_after_ko
from public.match_picks p
join public.matches  m  on m.id  = p.match_id
join public.profiles pr on pr.id = p.user_id
left join public.teams ht on ht.id = m.home_team
left join public.teams at on at.id = m.away_team
where p.created_at > m.kickoff
order by pr.display_name, m.kickoff, p.market;
```

```bash
docker exec -i supabase_db_foodball psql -U postgres -d postgres -P pager=off -f - < the_above.sql
```
