# FoodBall — Logic Audit

**Generated:** 2026-06-14 · **Method:** 9 subsystem reviewers → each candidate adversarially verified against the real code (a second agent tried to refute it).

**Result:** 26 confirmed of 37 candidates (11 refuted as by-design/false-positive).

Severity: **HIGH** 5 · **MEDIUM** 12 · **LOW** 6 · **INFO** 3

> Note: several findings are *by-design tradeoffs* flagged for awareness (e.g. stuck-live behavior, fail-open allowlist). They are included because they can still produce surprising/unfair outcomes.

## ✅ Remediation status (applied 2026-06-14)

**24 of 26 fixed** in migration `0019_logic_audit_fixes.sql` + frontend + the `sync-results`
Edge Function, verified on the live DB by `supabase/tests/m_audit_fixes_test.sql` (and the
existing `m_grace` / `m_openfootball` suites still pass; `npm run build` + 76 Vitest tests green).

- **HIGH (5/5 fixed):** #1 cast-safe scorers + numeric CHECKs; #2/#3 `created_at` is now
  server-stamped + immutable and the scorer ranks the active pick by the immutable `id`
  (anti-cheat closed); #4/#5 RLS now reveals others' tourney/round picks **only while they
  are locked** (no copy-then-pick).
- **MEDIUM (10/12 fixed):** #6 self-correcting round completion + `fb_admin_set_round_complete`;
  #7 `fb_admin_remove_tournament_result` (correct a wrong finalist); #8 delete-a-pick triggers
  clean its `score_events`; #9 empty/finished rounds no longer freeze the revision window;
  #11/#12 Edge Function resolves real `api_match_id`s + routes openfootball through the in-DB
  settler; #13 `fb_ingest_result` never regresses a finished match; #16 allowlist fails
  **closed** when empty; #17 `total_goals` bounded.
  - **Not changed (2):** **#10** finalist scoring — kept single-finalist ("A finalist", 40);
    switching to dual-finalist mid-tournament would change live point values, a product
    decision, not a bug. **#14** stuck-live blocking a round — inherent to token-free
    settlement; mitigated by #6/#9 + admin override (`fb_admin_set_result`), left operational.
- **LOW (6/6):** #18 settle-round won't mark complete with unfinished matches; #19 admins may
  edit other profiles (is_admin still trigger-guarded); #20 `red_cards` unique constraint;
  #21 optimistic picks reconcile on the matches realtime event; #22 exact-score stepper 0–19;
  #23 Golden Glove picker is keepers-only + clean_plate scorer requires a GK.
- **INFO (3):** #24 "The Menu" exact-score wording fixed; #25 signup domain enforced on email
  change too; #26 resolved by `0016` (post-kickoff edits are now impossible).


## 🔴 HIGH

### 1. A non-numeric round-prop/tournament selection aborts settlement for the entire round (denial-of-settlement / griefing)
*Subsystem:* `scoring-ledger`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql — fb_score_round (spice: `public.fb_match_winner(rp.selection::bigint)`, lines ~263-265) and fb_score_tournament (total_goals: `abs(r.selection::int - a.selection::int) <= 5`, lines ~309-310); selection columns have no numeric CHECK (0001 round_props/tourney_picks DDL); RLS round_props_insert only checks user_id (0001 line ~530)

**Flaw:** `round_props.selection` and `tourney_picks.selection` are free `text` with no numeric validation, yet fb_score_round casts the spice selection with `::bigint` and fb_score_tournament casts total_goals with `::int` inside a single set-based statement that processes ALL users' rows at once. A single row whose selection is not a valid integer makes the cast raise, which aborts the whole statement (and the enclosing transaction) — so NO ONE in that round/tournament gets settled.

**Verified:** CONFIRMED from the code and reproduced empirically against the live DB (supabase_db_foodball), in rolled-back transactions.

WHAT THE CODE DOES:
- `round_props.selection` and `tourney_picks.selection` are plain `text` with NO numeric CHECK (verified via pg_constraint: only `prop`/`pick_type` enum checks and uniqueness/FK constraints exist; 0001 lines 85-106). No later migration (0002-0018) adds format validation.
- `fb_score_round` (0003 lines 86-116, the live redefinition of 0002's version) settles ALL of a round's props in ONE set-based `WITH scored` statement. The `spice` branch casts `rp.selection::bigint` (lines 100-102).
- `fb_score_tournament` (0002 lines 295-328) settles ALL active tournament picks in ONE set-based statement; the `total_goals` branch casts `a.selection::int` (line 310).
- Postgres CASE only evaluates the matched branch (verified empirically: a `top_chef` row with selection='abc' is never cast), so ONLY a `spice` row with a non-numeric selection triggers the bigint cast — and that single bad row raises 22P02, aborting the whole statement (verified: alice/carol valid rows scored nothing when bob's 'abc' row was present).

ATTACK PATH (all gates pass for an ordinary logged-in player):
- 0005 grants `authenticated` direct insert/update/delete on `round_props` and `tourney_picks`.
- RLS `round_props_insert` / `tourney_insert` only check `user_id = auth.uid() …

**Fix:** Validate selection format at the write boundary AND make scoring cast-safe (defense in depth):

1) Add CHECK constraints so a non-numeric selection can never be stored:
   - `alter table public.round_props add constraint round_props_spice_numeric check (prop <> 'spice' or selection ~ '^[0-9]+$');` (and similarly require numeric for top_chef/clean_plate which are player ids).
   - `alter table public.tourney_picks add constraint tourney_total_goals_numeric check (pick_type <> 'total_goals' or selection ~ '^[0-9]+$');`
   (Backfill/clean any existing bad rows first.)

2) Make the scorers resilient regardless of input — replace the hard casts with safe conversions so one bad row can never abort the whole batch. E.g. in fb_score_round use a guarded conversion for spice: only treat the row as a match_id when `rp.selection ~ '^[0-9]+$'`, else score 0; in fb_score_tournament guard `a.selection ~ '^-?[0-9]+$'` before `::int` (or use a helper that returns NULL on non-numeric input). This keeps settlement total even if a constraint is ever missing.

3) (Optional hardening) Wrap fb_admin_set_result / fb_admin_settle_round in an exception boundary, or have fb_set_tourney_pick / the prop insert RPC reject non-numeric selections for numeric pick types, so the failure surfaces to the offending writer rather than the settling admin.


### 2. Tournament-pick revision window is bypassable by UPDATEing created_at on an old superseded pick (re-activate any pick, any time, at its original decay bucket)
*Subsystem:* `pick-locking`  
*Location:* supabase/migrations/0007_longshot_grace.sql fb_enforce_tourney_pick() UPDATE branch (lines 99-110); active-pick selection in supabase/migrations/0002_m2_markets_props_decay.sql fb_score_tournament() (lines 295-300, `distinct on (user_id,pick_type) order by created_at desc, id desc`); RLS tourney_update + grant in 0002 line 549-550 / 0005_grants.sql lines 17-19

**Flaw:** fb_enforce_tourney_pick's UPDATE branch only rejects changes to points_awarded, pick_type, selection, and set_after_round, then `return NEW`. It never guards `created_at`. The scorer defines the single authoritative ('active') pick per (user, pick_type) as the latest row by `created_at desc, id desc`. Because authenticated users hold UPDATE on tourney_picks (0005 grant) and RLS tourney_update allows own rows, a client can issue a bare `UPDATE tourney_picks SET created_at = now()+'1h' WHERE id = <old_pick>` — no content column changes, so the trigger passes — and thereby make ANY historical pick the active one, completely outside the revision window the trigger is supposed to enforce. The window check only gates INSERT.

**Verified:** Confirmed from the actual code. The exploit chain holds end-to-end:

1) GRANT (0005_grants.sql lines 17-19): `authenticated` holds INSERT/UPDATE/DELETE on `public.tourney_picks`.

2) RLS (0002 lines 549-550): `tourney_update` allows updating own rows; both USING and WITH CHECK only test `user_id = auth.uid()` — nothing constrains `created_at`.

3) TRIGGER (0007_longshot_grace.sql fb_enforce_tourney_pick, lines 99-110 — this is the LAST definition of the function; 0013 redefines only the match-pick and round-prop triggers, NOT this one). For an `authenticated`/`anon` UPDATE the branch raises ONLY when `points_awarded`, `pick_type`, `selection`, or `set_after_round` change, then `return NEW`. A bare `UPDATE tourney_picks SET created_at = now() WHERE id = <old_row>` changes none of those columns, so it passes and commits. The revision-window check `fb_tourney_revision_open()` is invoked ONLY inside the INSERT branch (lines 84-88), never on UPDATE.

4) SCORER (0002 fb_score_tournament lines 295-300): the authoritative active pick per `(user_id, pick_type)` is `distinct on (tp.user_id, tp.pick_type) ... order by tp.user_id, tp.pick_type, tp.created_at desc, tp.id desc`. 0003 does not redefine this function (it redefines fb_score_round/fb_ingest_result/fb_snapshot_ranks), so this remains authoritative. Bumping `created_at` on any historical row makes that row the active pick scored.
 …

**Fix:** Make the active pick deterministic on an immutable column instead of the client-writable created_at, AND forbid created_at edits by untrusted roles. Two concrete options:

(A) In fb_score_tournament (0002), order the `distinct on` by the immutable identity column only: `order by tp.user_id, tp.pick_type, tp.id desc`. Since fb_set_tourney_pick inserts a fresh row per revision and `id` is `generated always as identity`, the newest revision always has the highest id and a client cannot change it. (Also update the matching `superseded_by` linkage if it relies on created_at ordering.)

(B) Additionally (defense in depth) in the UPDATE branch of fb_enforce_tourney_pick (0007), reject created_at changes by untrusted roles, mirroring the existing content guard:
  `if NEW.created_at is distinct from OLD.created_at then raise exception 'FoodBall: created_at is immutable' using errcode = 'check_violation'; end if;`
This blocks the bare-created_at UPDATE outright. Applying both A and B is safest; A alone removes the authority dependence on a client-writable column, which is the root cause. Re-run m2_markets_props_decay_test.sql after the change and add a regression case: an out-of-window created_at bump on an old NULL-bucket row must NOT change the settled pick/points.


### 3. Client-writable created_at defeats the whole decay/anti-cheat scheme: any player can guarantee max tournament points regardless of outcome
*Subsystem:* `tournament-decay`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql fb_enforce_tourney_pick (INSERT+UPDATE branches, lines 343-385) and fb_score_tournament (active = distinct on (user_id,pick_type) order by created_at desc, id desc, lines 295-299); redefinition in 0007_longshot_grace.sql lines 69-112; grant in 0005_grants.sql line 17-19 (authenticated has INSERT/UPDATE on all columns incl. created_at). Confirmed on live DB: information_schema.column_privileges shows authenticated INSERT+UPDATE on tourney_picks.created_at.

**Flaw:** The scorer chooses the single 'active' pick per (user, pick_type) by `order by created_at desc, id desc`, but `created_at` is fully client-controlled: the INSERT trigger resets set_after_round/points_awarded/superseded_by but NOT created_at, and the UPDATE branch only blocks pick_type/selection/set_after_round/points_awarded changes — it never guards created_at and performs NO revision-window check on UPDATE at all. So which pick is 'active' is attacker-chosen, anytime.

**Verified:** Confirmed from the actual code (files + the live function dump, which matched the file byte-for-byte).

WHAT THE CODE DOES:
- fb_score_tournament (0002_m2_markets_props_decay.sql, lines 295-299) selects the single "active" tournament pick per (user_id, pick_type) with `select distinct on (tp.user_id, tp.pick_type) ... order by tp.user_id, tp.pick_type, tp.created_at desc, tp.id desc`. The `active` CTE has NO WHERE filter on superseded_by or points_awarded — so the row with the greatest created_at (tie-broken by id) is authoritatively settled, and its stored set_after_round (decay bucket) determines the points.
- The current/last definition of fb_enforce_tourney_pick is in 0007_longshot_grace.sql, lines 69-112 (verified via pg_get_functiondef on the live DB — identical; no later migration redefines it; 0013 hardens only the match-pick and round-prop triggers). Its UPDATE branch (lines 99-110) raises only when points_awarded, pick_type, selection, or set_after_round change, and performs NO fb_tourney_revision_open() check. created_at is never guarded and flows through untouched. The INSERT branch resets set_after_round/points_awarded/superseded_by but does not control created_at either.
- Grants: 0005_grants.sql lines 17-19 grant `insert, update, delete` on public.tourney_picks to `authenticated` with no column list, i.e. on all columns including created_at. RLS tourney_update (0 …

**Fix:** In fb_enforce_tourney_pick (redefine in a new migration, e.g. 0019), make created_at server-controlled the same way points_awarded is: on INSERT set `NEW.created_at := now()` and on UPDATE reject any change with `if NEW.created_at is distinct from OLD.created_at then raise exception ... end if;`. Add it to the existing immutable-content guard list alongside pick_type/selection/set_after_round. Additionally/defensively, make fb_score_tournament's "active" selection independent of a client-controllable column: order by `tp.id desc` only (id is `generated always as identity`, not client-writable) instead of `created_at desc, id desc`, OR filter the active CTE to the latest pick reached via the superseded_by chain (the row with superseded_by is null), since fb_set_tourney_pick already maintains that link. Also add an UPDATE-path revision-window check, or simply forbid all client UPDATEs to tourney_picks except the superseded_by link write performed by the RPC. Add a regression SQL test that inserts two full-value champion picks, bumps created_at on the losing one post-result, and asserts the scorer still settles only the legitimately-active pick.


### 4. tourney_picks read-visibility opens at MD1 kickoff but the pick stays editable in every between-rounds revision window — direct copying of tournament-long picks
*Subsystem:* `rls-visibility`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql:540-546 (policy tourney_read) vs supabase/migrations/0007_longshot_grace.sql:52-64 (fb_tourney_revision_open) + fb_enforce_tourney_pick INSERT path

**Flaw:** The read policy makes ALL players' tournament-long picks (champion, golden_boot, golden_glove, young_player, total_goals, finalist) globally readable the instant the single round 'MD1' has kicked off (`r.key='MD1' and now() >= r.first_kickoff`). But the WRITE gate for tourney_picks is `fb_tourney_revision_open()`, which returns true whenever no round is currently in progress — i.e. it REOPENS in every gap between rounds (e.g. after MD3 completes and before R32 kicks off, after R32 completes before R16, etc.). So from MD1 kickoff onward, the visibility boundary and the editability boundary are permanently out of sync: a player can read every rival's tournament picks and then, in the next between-rounds window, set/revise their own to copy the leader's champion/golden-boot selection. The anti-copy invariant ('a pick is visible only to its owner BEFORE its lock time') is violated because tournament picks have no single lock time — they are revisable for the whole tournament — yet they become public after the very first kickoff.

**Verified:** Confirmed from code. The read policy `tourney_read` (supabase/migrations/0002_m2_markets_props_decay.sql:540-546) exposes EVERY player's full tourney_picks row (incl. the `selection` column — 0005_grants.sql:14 grants plain SELECT on all columns) to all authenticated users the instant the single round MD1 has kicked off (`exists(... r.key='MD1' and now() >= r.first_kickoff)`). Nothing after 0002 redefines or tightens this policy.

The WRITE gate is a different, repeatedly-reopening boundary. `fb_tourney_revision_open()` (original 0002:96-107, redefined 0007_longshot_grace.sql:52-64) returns true whenever NO round is currently in progress — i.e. in every gap between a round completing and the next round kicking off (pre-tournament, after MD3 before R32, after R32 before R16, etc.) — and additionally whenever the admin longshot grace window is active (which can be open even mid-round). The INSERT path of `fb_enforce_tourney_pick` (0002:343-385 / 0007:69-112) only checks `fb_tourney_revision_open()`; `fb_set_tourney_pick(text,text)` is granted to `authenticated` (0002:560) and inserts a new pick. `fb_score_tournament()` (0002:288-329) settles ONLY the latest active pick per (user,pick_type) via `distinct on ... order by created_at desc, id desc`, so a later-inserted copied selection becomes the authoritative one.

So the visibility boundary (fixed at MD1 kickoff) and the editabili …

**Fix:** Make tourney_picks visibility track the actual editability/lock semantics instead of a single MD1-kickoff flip. Option A (preferred): keep each player's tourney_picks private to its owner for the entire tournament (these are revisable to the very end, so they never have a public 'after lock' phase that is safe to reveal); only reveal them after the final tournament results are settled / the tournament is marked complete. Option B: gate visibility of a rival's pick on the revision window being CLOSED for that pick — i.e. only expose others' rows while `not fb_tourney_revision_open()` (a round in progress AND no grace window), so no one can read-then-copy during a window they could also write in. Concretely, replace the `r.key='MD1' and now() >= r.first_kickoff` branch in the `tourney_read` policy with a condition tied to tournament completion (e.g. `exists(select 1 from public.tournament_results)` or a settled-flag), or with `not public.fb_tourney_revision_open()`. Whichever is chosen, ensure the longshot grace window does not silently leave the read boundary open while writes are also open.


### 5. round_props and tourney_picks become globally readable at kickoff while the launch grace windows still allow everyone to set/change them — copy-then-pick during the grace window
*Subsystem:* `rls-visibility`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql:523-529 (round_props_read) & 540-546 (tourney_read) vs supabase/migrations/0008_round_props_grace.sql:34-66 (fb_enforce_round_prop_lock) and 0007_longshot_grace.sql:69-112 (fb_enforce_tourney_pick) + the active grace defaults

**Flaw:** The read policies open visibility at `now() >= first_kickoff` (round_props) / `now() >= MD1.first_kickoff` (tourney_picks). The 0008/0007 grace windows deliberately keep these picks WRITABLE past those kickoffs (`...and not public.fb_round_props_grace_active()` / `set_after_round := null when grace active`). 0016 explicitly says these two graces are 'UNTOUCHED'. The grace default is seeded open ('2026-06-14 23:59+06'), and today's date in-context is 2026-06-14 — so the grace is live. During the overlap [first_kickoff, grace cutoff] a player can simultaneously read every rival's round-special/tournament pick AND set or change their own, which is exactly the copying the RLS rule is meant to prevent. Note this is the same class of bug as the match-pick grace that 0011 introduced and 0016 had to revert as 'unfair' — but it was only fixed for match_picks; round_props and tourney_picks still carry it.

**Verified:** Confirmed from the actual code, all links verified.

VISIBILITY OPENS AT KICKOFF: round_props_read (0002_m2_markets_props_decay.sql:523-529) returns rows of OTHER users once `exists(select 1 from rounds r where r.key = round_key and now() >= r.first_kickoff)`. tourney_read (0002:540-546) does the same gated on MD1.first_kickoff. seed.sql:24 sets MD1.first_kickoff = 2026-06-11 16:00 UTC, which is in the past relative to the in-context date 2026-06-14, so both policies currently expose every player's Top Chef / Clean Plate / Spice and tournament-long selections to all authenticated users.

WRITES STILL OPEN VIA GRACE: The current round-prop lock trigger (latest definition fb_enforce_round_prop_lock in 0013_pick_lock_hardening.sql:81-115, line 108) only locks when `now() >= v_lock AND NOT fb_round_props_grace_active()`. The current tourney trigger (fb_enforce_tourney_pick in 0007_longshot_grace.sql:69-112) opens the revision window (fb_tourney_revision_open, lines 52-64) whenever fb_longshot_grace_active() is true, and stamps set_after_round = NULL (full pre-tournament value) for grace-window inserts (lines 90-93). Both grace flags are seeded OPEN until 2026-06-14 23:59 +06 = 17:59 UTC (0008:18-20 and 0007:24-26), i.e. live on the in-context date.

CLIENT PATHS ARE TIME-UNGUARDED: submitRoundProp (src/lib/api.ts:165-178) is a plain upsert; setTourneyPick (api.ts:196-203) calls fb_ …

**Fix:** Apply the 0016 fix pattern to round_props and tourney_picks: make their post-kickoff locks strict and stop consulting the grace flags, OR (preferred, to preserve the legitimate late-launch use case) decouple write-grace from read-visibility. Concretely, gate the read policies on grace as well so a pick is not globally readable while it is still writable. For round_props_read, change the visibility condition to `(now() >= r.first_kickoff AND NOT public.fb_round_props_grace_active())`; for tourney_read, `(now() >= MD1.first_kickoff AND NOT public.fb_longshot_grace_active())`. Owner-always and is_admin branches stay. That keeps the launch-grace convenience (everyone can still set/revise late) without exposing rivals' picks during the writable window, closing the copy-then-pick path. Re-run m_grace_test.sql plus add a case asserting a non-owner cannot read another user's round_prop/tourney_pick while the grace is active.


## 🟠 MEDIUM

### 6. Round completion is a one-way latch with no inverse — a transient/erroneous 'finished' permanently corrupts decay buckets and rank snapshots
*Subsystem:* `scoring-ledger`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql fb_score_match round-complete cascade (`update public.rounds set completed = true ... and not completed`, lines ~226-231) and fb_admin_settle_round (`set completed = true`, line ~483); no migration ever sets completed=false or reverts matches.status from 'finished' (verified across 0001-0018); fb_enforce_tourney_pick stamps `set_after_round := fb_decay_bucket(fb_latest_completed_round())` (0007 lines ~90-93)

**Flaw:** `rounds.completed` and `matches.status='finished'` are monotonic — no code path ever reverses them. fb_latest_completed_round() and fb_tourney_revision_open() derive entirely from `completed`, and the decay bucket a player's tourney pick is permanently stamped with is computed from it at insert time. So a wrong 'finished' (bad openfootball publish, fat-fingered admin result on the last match of a round) permanently advances the completed-round latch, and any tourney pick made in the resulting (incorrectly) open revision window is baked at the wrong, lower decay value with no way to fix it short of manual SQL.

**Verified:** Confirmed from the code. `rounds.completed` and `matches.status='finished'` are strictly monotonic: across migrations 0001–0018 the only writes are `set completed = true` (0002 `fb_score_match` line 229; `fb_admin_settle_round` line 483) and `status='finished'` (0001 `fb_admin_set_result` line 349; 0003 `fb_ingest_result` line 166; 0010 only flips scheduled→live). No path ever sets `completed=false` or moves a match out of `'finished'` (the only `completed=false` occurrences are test fixtures). The round-complete cascade in fb_score_match trips on `bool_and(status='finished')` over the round's matches (line 226), so a single wrong `finished` on the round's LAST still-unplayed match latches `completed=true`. fb_latest_completed_round() (0002 lines 51-60) and fb_tourney_revision_open() (0007 lines 52-64) both derive entirely from `completed`, and fb_enforce_tourney_pick stamps `NEW.set_after_round` from fb_latest_completed_round() at INSERT time (0007 line 92), with the same trigger forbidding any in-place edit of set_after_round (lines 104-109).

Concrete scenario (admin fat-finger, the strongest case): the last MD3 group match kicks off tomorrow. An admin enters a result against the wrong match id, finishing that last MD3 fixture early. bool_and(status='finished') for MD3 becomes true → rounds.completed latches true for MD3. fb_tourney_revision_open() now returns true even thou …

**Fix:** Make round completion derived/reversible rather than a one-way latch. Concretely: (1) recompute `completed` whenever any match in the round changes status — e.g. in fb_score_match set `completed = (bool_and(status='finished'))` unconditionally for the round (so correcting a bad result that re-opens an unplayed match also un-completes the round), instead of `set completed = true ... and not completed`; and (2) add an admin RPC `fb_admin_set_round_complete(round_key, boolean)` that can clear `completed` for recovery. Either approach lets fb_latest_completed_round()/fb_tourney_revision_open() self-correct so picks aren't permanently stamped from a transient/erroneous completion. (Note this makes the revision window able to close again, which is the desired behavior here.) Optionally, also guard fb_admin_set_result/fb_ingest_result so finishing a match whose kickoff is still in the future requires an explicit override flag, to make the fat-finger harder to trigger.


### 7. A wrongly-entered finalist tournament result can never be corrected and permanently over-credits players
*Subsystem:* `scoring-ledger`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql fb_admin_set_tournament_result (lines ~492-509): `if p_pick_type <> 'finalist' then delete ...` then `insert ... on conflict do nothing`

**Flaw:** For every pick_type except 'finalist', the admin RPC deletes prior tournament_results rows before inserting, so a correction overwrites cleanly. But 'finalist' is intentionally append-only (so two finalists can be entered) and there is NO delete/correction path for it anywhere. fb_score_tournament credits a finalist pick if it matches EITHER stored row, so a spurious finalist row permanently inflates scores.

**Verified:** Confirmed from the actual code. In supabase/migrations/0002_m2_markets_props_decay.sql:

- fb_admin_set_tournament_result (lines 492-509) is the ONLY client/admin-callable path to write tournament_results. For pick_type <> 'finalist' it does `delete from public.tournament_results where pick_type = p_pick_type` then inserts, so single-answer types (champion, golden_boot, golden_glove, young_player, total_goals) self-correct cleanly. For 'finalist' it SKIPS the delete (line 502) and only `insert ... on conflict do nothing`. The table PK is (pick_type, selection) (lines 32-36), so `on conflict do nothing` dedupes only an exact-same (finalist, X) re-entry — a different selection is a brand-new row. There is no append-correction/remove path for finalist anywhere: grep across migrations 0003-0018 shows no other code touches tournament_results (only 0001 lists the CHECK constraint and 0015 is the unrelated signup allowlist), and the Admin UI (src/screens/Admin.tsx lines 559-587) exposes only a 'set' action wired to fb_admin_set_tournament_result via src/lib/api.ts:339 — no clear/delete control.

- fb_score_tournament (lines 288-330) credits a finalist pick whenever the player's selection matches ANY stored finalist row: line 313-315 `exists (select 1 from tournament_results r where r.pick_type = a.pick_type and r.selection = a.selection)`. The points land in score_events keyed on (sou …

**Fix:** Add an admin-callable correction path for finalist rows. Simplest: a SECURITY DEFINER RPC `fb_admin_remove_tournament_result(p_pick_type text, p_selection text)` that admin-checks, `delete from public.tournament_results where pick_type = p_pick_type and selection = p_selection`, then `perform public.fb_score_tournament()` so any wrongly-credited picks are re-scored back to 0. Grant execute to authenticated, revoke from public, and expose a "remove" control in the Admin tournament-results UI next to each entered finalist. (Re-scoring after delete correctly zeroes the FRA-pickers because fb_score_tournament recomputes pts=0 for picks no longer matching any stored row and upserts that into score_events.) Optionally also surface the currently-stored finalist rows in the Admin screen so a typo is visible before more entries are added.


### 8. score_events has no FK to match_picks/round_props/tourney_picks — deleting a pick orphans its ledger points (phantom leaderboard total)
*Subsystem:* `scoring-ledger`  
*Location:* supabase/migrations/0001_init.sql score_events DDL (lines 117-128: only `user_id ... references public.profiles(id) on delete cascade`; source_table/source_id are loose columns); 0018_red_cards.sql header claims voiding 'delete[s] the pick + its score_events' but no committed function does both atomically

**Flaw:** The ledger keys events by (source_table, source_id) but holds no foreign key to the source rows, and the source pick tables (match_picks etc.) have no trigger/cascade that removes the corresponding score_event on delete. So any deletion of a scored pick — the red-card void flow, the 0009 match-cascade teardown, or any manual cleanup — leaves a dangling score_event whose points the leaderboard view keeps summing (it joins profiles→score_events, never the pick tables).

**Verified:** Confirmed from the actual code. `public.score_events` (0001_init.sql lines 117-128) keys an event by the loose pair (`source_table text`, `source_id bigint`) and holds exactly ONE foreign key: `user_id ... references public.profiles(id) on delete cascade`. There is no FK, ON DELETE rule, or trigger linking `source_id` back to `match_picks`/`round_props`/`tourney_picks`. I grepped every migration and docker init: no `alter table score_events add foreign key`, no `references ... match_picks`, and no statement that ever deletes from `score_events` (the only `delete from score_events` would be a cascade, which does not exist). The `match_picks` lock trigger is `before insert or update or delete` only (0001_init.sql line 263-265; body in 0009/0016) — on DELETE it just returns OLD to permit the delete; it never removes the matching `score_events` row.\n\nThe leaderboard view (0001 lines 135-149, redefined in 0003 lines 35-60) computes each player's `total` as `coalesce(sum(se.points),0)` from `profiles p LEFT JOIN score_events se ON se.user_id = p.id` — it never joins the pick tables, so a `score_events` row whose pick no longer exists is still summed.\n\nScenario A (live, documented path): `match_picks.match_id` is `references public.matches(id) on delete cascade` (0001 line 75). Suppose pick 42 is settled: `fb_score_match`/`fb_score_round` (0002 line 219/0003 line 113) write `score …

**Fix:** Tie the ledger to the pick rows so deletions self-clean. Cleanest is per-source FKs with cascade, e.g. a new migration adding an AFTER DELETE trigger on each pick table that runs `delete from public.score_events where source_table = '<table>' and source_id = OLD.id;` (a real FK is impossible because source_id is polymorphic across three tables). Add the same to match deletion if matches should purge their picks' events. For the 0018 void flow, ship the documented `fb_void_pick(pick_id)` RPC that, in one transaction, inserts the `red_cards` row, deletes the `score_events` row, then deletes the pick — rather than relying on the operator to remember both. Either way, after deletion the security_invoker leaderboard view recomputes correctly with no phantom points.


### 9. Revision window closes permanently once an empty knockout round's seeded first_kickoff passes
*Subsystem:* `tournament-decay`  
*Location:* supabase/migrations/0002 fb_tourney_revision_open (lines 96-107) / redefined in 0007 (lines 52-64); round-complete cascade in fb_score_match (lines 224-231); seed.sql rounds with fixed first_kickoff for R32..F (lines 23-32). Live DB state confirmed: R32/R16/QF/SF/F have 0 matches, completed=false, with seeded first_kickoffs.

**Flaw:** The window is open iff no round has `first_kickoff is not null and now() >= first_kickoff and not completed`. A round is only marked completed by the cascade when ALL its matches finish (bool_and over matches). A round with ZERO matches never gets completed (bool_and over empty set is NULL → coalesce(false)). The seed gives every knockout round a fixed first_kickoff. So once now() passes R32's seeded kickoff (2026-06-28) while R32 still has no imported fixtures, R32 satisfies 'in progress' forever and the window can never reopen.

**Verified:** Confirmed from code AND live DB simulation. fb_tourney_revision_open() (final def in supabase/migrations/0007_longshot_grace.sql lines 52-64) returns true iff the longshot grace is active OR no round satisfies (first_kickoff is not null AND now() >= first_kickoff AND not completed). A round is marked completed only in two spots: fb_score_match (0002 line 229), which fires only when bool_and(status='finished') is true over that round's matches — NULL→coalesce(false) for an empty round, and which never even runs for a round with 0 matches; and the admin RPC fb_admin_settle_round (0002 line 483). seed.sql (lines 27-31) seeds R32..F with fixed future first_kickoffs (R32 = 2026-06-28). Live DB confirms R32/R16/QF/SF/F each have 0 matches, completed=false. I simulated now()=2026-06-29 with the longshot grace expired: the in-progress EXISTS clause is satisfied by R32 (match_count=0), so revision_open=false. I then simulated the precise §4.4 scenario (group stage MD1-MD3 marked complete, grace expired, 2026-06-29): the ONLY blocking round is R32, and revision_window_open=false. So the prime window for revising champion/finalist/golden-boot picks — between the group stage completing and the real R32 kickoff — never opens; every fb_set_tourney_pick INSERT is rejected by the trg_tourney_pick_window trigger ('revision window is closed'). The bug is currently masked only because longshot_gr …


### 10. Finalist pick scores at most one team (40), contradicting spec 'Both finalists (each)' (up to 80)
*Subsystem:* `tournament-decay`  
*Location:* spec plans/worldcup-league-claude-code-prompt.md line 77 ('Both finalists (each) | 40 ...'); schema/scorer: fb_score_tournament distinct on (user_id, pick_type) (0002 lines 295-299) means one active 'finalist' pick per user; UI src/screens/MyPicks.tsx line 26 label 'A finalist'.

**Flaw:** Spec §4.3 intends the player to predict BOTH finalists and earn the value per correct finalist (up to 2×40=80 pre-tournament). The implementation models 'finalist' as a single pick_type with exactly one active row per user, and the scorer awards the decayed value once if the single selection matches EITHER tournament_results finalist row. A player can therefore never earn more than one finalist award (40 at full value).

**Verified:** Confirmed from the actual code. Spec §4.3 (plans/worldcup-league-claude-code-prompt.md line 77) lists "Both finalists (each) | 40 | 30 | 20 | 15 | 8 | —", where "(each)" means a player predicts BOTH finalists and earns the decayed value per correct finalist (up to 2×40 = 80 pre-tournament).

The implementation models 'finalist' as a SINGLE pick_type holding ONE team:
- Schema: tourney_picks.pick_type CHECK (0001_init.sql line 99-100) allows exactly one 'finalist' value; grepping all 18 migrations and src/ finds no second finalist type (no finalist2/finalist_b/etc.).
- Scorer: fb_score_tournament (0002_m2_markets_props_decay.sql lines 295-326) uses `select distinct on (tp.user_id, tp.pick_type)` (line 296), so it picks exactly ONE active finalist row per user (latest by created_at,id). It then awards fb_decay_points('finalist', bucket) ONCE if that single selection matches EITHER tournament_results finalist row (lines 314-315). So the maximum a user can ever earn for finalist is one decayed award (40 at full value).
- tournament_results does accumulate two finalist rows (admin "submit once per finalist", lines 489-506 / comment lines 28-31), but that only changes which single team can match — it cannot double the user's payout because the user side has only one scorable row.
- UI: MyPicks.tsx renders one finalist row (PICK_META line 26, label "A finalist 🥈" singular) and `active …


### 11. sync-results Edge Function can never settle the live fixtures — api_match_id namespaces don't match (broken hosted-Supabase / football-data path)
*Subsystem:* `results-sync`  
*Location:* /root/personal-projects/foodball/supabase/functions/sync-results/index.ts:122,136 (fromFootballData/fromOpenFootball build apiId) vs /root/personal-projects/foodball/scripts/import-real-fixtures.mjs:71 (real api_match_id) and /root/personal-projects/foodball/supabase/migrations/0003_m3_autosync_realtime.sql:146-149 (fb_ingest_result lookup)

**Flaw:** The live fixtures are imported with api_match_id like 'WC26-MD1-A-MEX-RSA' (import-real-fixtures.mjs:71). The sync-results Edge Function instead constructs apiId='FD-<id>' (football-data) or 'OF-<date>-<team1>-<team2>' (openfootball). fb_ingest_result looks up `where api_match_id = p_api_match_id` and returns 'skip: unknown api_match_id' on no match. None of the Edge Function's ids can ever equal the WC26-* ids, so every ingest is a no-op skip.

**Verified:** Confirmed from the code. The live league's fixtures are seeded by scripts/import-real-fixtures.mjs:71, which writes api_match_id = 'WC26-<round>-<group>-<homecode>-<awaycode>' (e.g. WC26-MD1-A-MEX-RSA). This is the documented and actual live-population path (session_status.md:34, README.md:79, CLAUDE.md:136,210-211). The sync-results Edge Function instead constructs apiId = 'FD-<id>' (supabase/functions/sync-results/index.ts:122) or 'OF-<date>-<team1>-<team2>' (:136) and passes it straight to fb_ingest_result as p_api_match_id (:167). fb_ingest_result (supabase/migrations/0003_m3_autosync_realtime.sql:146) does an exact lookup `where api_match_id = p_api_match_id` and returns 'skip: unknown api_match_id' (:148) on no match — there is no team-based or fuzzy fallback in the RPC. No WC26-* id can ever equal an FD-*/OF-* id, so on the live DB every ingest from this function is a no-op skip; no match is ever settled via the football-data/openfootball Edge path. The failure is monitoring-blind: index.ts:173-179 counts the skip as `skipped++` and returns { ok: true } with HTTP 200, and the 0004 cron reports success, so an operator sees green while nothing settles.

Two refinements to the candidate's framing, both of which I verified and neither of which refutes it: (1) The flaw is NOT that fb_ingest_result is wired wrong in general — the two Edge Functions are internally consistent wi …

**Fix:** Make fb_ingest_result resolve a match without depending on api_match_id namespace agreement, or align the two namespaces. Concretely: (a) Change the Edge Function to identify matches the same way 0014 does — by team identity + date/kickoff — rather than a synthesized api_match_id. For football-data, resolve teams by tla and match by (home_team, away_team) (optionally date); for openfootball, by team1/team2 name. Pass those to a match-resolution that does not require api_match_id equality. (b) Alternatively, give fb_ingest_result a team-pair fallback: when the exact api_match_id lookup fails, fall back to `where home_team = (teams.fifa_code = home_tla) and away_team = (teams.fifa_code = away_tla)` (passing TLAs as new params), mirroring 0014's resolution so the two settle paths agree. (c) At minimum, stop the silent green: surface 'skip: unknown api_match_id' counts distinctly in the response (e.g. unknownIds[]) and have the function return ok:false (or a non-200) when polled>0 but scored+live==0, so the cron's job_run_details flags the dead path instead of reporting success. Also re-run m3_autosync_test.sql / m_openfootball_sync_test.sql against fixtures seeded with WC26-* ids (the existing tests likely seed FD-*/OF-* ids, which is why this slipped through).


### 12. Edge Function openfootball fallback parses the wrong JSON shape — Zod schema rejects the real feed (rounds[] vs flat matches[], score1/2 vs score.ft)
*Subsystem:* `results-sync`  
*Location:* /root/personal-projects/foodball/supabase/functions/sync-results/index.ts:47-57 (ofMatch/ofResponse schema) and 127-145 (fromOpenFootball)

**Flaw:** The function expects `{ rounds: [{ matches: [{ score1, score2 }] }] }`. The real openfootball 2026 worldcup.json is `{ name, matches: [{ ..., score: { ft: [h,a] } }] }` — a FLAT top-level matches array with scores under score.ft, and NO rounds key and NO score1/score2 fields. `ofResponse.parse(...)` throws on the missing `rounds`, so fromOpenFootball() raises, and inside Deno.serve the outer try/catch returns 500. The in-DB 0014 function reads `p->'matches'` and `score->'ft'` correctly, confirming the two parsers disagree about the same feed (two sources of truth).

**Verified:** Confirmed against the live feed and the real code. I fetched https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json (104 matches): top-level keys are exactly ['name','matches'] — a FLAT matches[] array with NO 'rounds' key, scores under score.ft:[h,a], and zero occurrences of 'score1'/'score2'. The sync-results Edge Function disagrees: ofResponse = z.object({ rounds: z.array(...) }) (index.ts:55-57) makes 'rounds' a REQUIRED field, so ofResponse.parse(await res.json()) at index.ts:130 throws Zod 'Required' on the real feed. That throw is not caught by the inner try (index.ts:154-159 wraps only fromFootballData()), so it propagates to the outer try/catch (index.ts:180-182) and returns HTTP 500 — zero ingests. The secondary claim also holds: even if 'rounds' existed, ofMatch reads score1/score2 (index.ts:52-53) which are absent, so m.score1 == null at index.ts:134 would skip every match. This is a genuine two-sources-of-truth defect: the in-DB 0014 function fb_settle_from_openfootball_json reads p->'matches' and score->'ft' correctly (0014_openfootball_results_sync.sql:50,56-57), and the project's own working importer scripts/import-real-fixtures.mjs:40-41 reads data.matches flat with m.score.ft semantics — so both other consumers of the same feed parse it correctly while the two Edge Functions (sync-results AND the identical sync-fixtures:31-32) p …

**Fix:** Make the two Edge Functions parse the actual openfootball shape (the same one 0014 and import-real-fixtures.mjs already use). In sync-results/index.ts replace ofMatch/ofResponse with a flat schema and read score.ft: e.g. const ofMatch = z.object({ date: z.string(), team1: z.string(), team2: z.string(), group: z.string().nullable().optional(), score: z.object({ ft: z.tuple([z.number(), z.number()]).optional() }).nullable().optional() }); const ofResponse = z.object({ matches: z.array(ofMatch).default([]) }); then in fromOpenFootball() iterate parsed.matches, skip when m.score?.ft is missing, and use home = m.score.ft[0], away = m.score.ft[1] (optionally filter to group-stage via m.group?.startsWith('Group') to mirror 0014). Apply the same flat-shape fix to sync-fixtures/index.ts (it reads data.matches/round/date/time). To prevent regressions, add a Zod .safeParse-based test against a captured worldcup.json fixture and assert the fallback yields >0 ingests for finished matches.


### 13. A 'live' API poll silently reverts a finished match and is never re-scored; no status-transition legality guard
*Subsystem:* `results-sync`  
*Location:* /root/personal-projects/foodball/supabase/migrations/0003_m3_autosync_realtime.sql:150-174 (fb_ingest_result) + /root/personal-projects/foodball/supabase/functions/sync-results/index.ts:92-96 (liveOrFinished)

**Flaw:** fb_ingest_result's only guard is `if result_source='manual' and status='finished' then skip`. An API-settled match (result_source='api', status='finished') has no protection: a later call with p_status='live' runs the UPDATE setting status='live' and returns 'updated (live)' without re-scoring or clearing score_events. There is no check that a finished match cannot move back to live, i.e. no status-transition legality enforcement.

**Verified:** Confirmed from the code. fb_ingest_result (0003_m3_autosync_realtime.sql:146-174) skips only when result_source='manual' AND status='finished'. An API-finished match (result_source='api', status='finished') is unprotected: a later call with p_status='live' executes the UPDATE (line 162-167) setting status='live', returns 'updated (live)' (line 173), and because the p_status='finished' branch (169-172) is skipped, it never re-runs fb_score_match nor clears score_events. There is no check that a finished match may not transition back to live.

The trigger is reachable via the football-data.org path: liveOrFinished (sync-results/index.ts:92-96) returns 'live' for FD statuses IN_PLAY and PAUSED. FD is known to momentarily re-report a just-finished match as PAUSED/IN_PLAY (around FT / extra-time / corrections). When that poll arrives, fb_ingest_result flips the already-scored match back to 'live'.

Concrete wrong outcomes, all verified in code:
1) Frozen/stale points: match_picks.points_awarded and the score_events rows written by the earlier 'scored' call persist (the live branch never touches them). The leaderboard still shows the awarded points while the match UI shows the game as in-play — an internally inconsistent display.
2) Inconsistent completed round: fb_score_match (0002:226-231) sets rounds.completed=true when the round's last match finishes, and grep confirms 'completed …

**Fix:** Add a status-transition legality guard at the top of fb_ingest_result, after fetching m: never let a finished match move backward. For example, after the manual-skip check, add: `if m.status = 'finished' and p_status = 'live' then return 'skip: match already finished'; end if;` This makes a finished match (api OR manual) immune to a spurious live re-report; a corrected final score still arrives as p_status='finished' and re-scores idempotently. Optionally also re-run fb_score_match when an api-finished match receives a different finished score (already handled by the existing finished branch). As defense-in-depth, fb_advance_live_windows / a completed-round invariant could refuse to leave rounds.completed=true with a non-finished member match, but the single guard above prevents the whole revert chain.


### 14. A single stuck-live match blocks the entire round's prop settlement, rank snapshot, and tournament revision window — by design no auto-finish
*Subsystem:* `results-sync`  
*Location:* /root/personal-projects/foodball/supabase/migrations/0010_auto_live_window.sql:22-29 (never auto-finishes) + /root/personal-projects/foodball/supabase/migrations/0002_m2_markets_props_decay.sql:226-231 (round-complete cascade requires bool_and(status='finished')) + 0002:96-107 (fb_tourney_revision_open)

**Flaw:** foodball-auto-live flips matches to 'live' but never to 'finished'; finishing depends on openfootball publishing a final score or admin entry. fb_score_match only settles round props / snapshots ranks / marks the round completed when `bool_and(status='finished')` over all matches in the round. fb_tourney_revision_open() returns false while any round has first_kickoff passed and not completed. So one match that never gets a final score (openfootball lag, a team-name mismatch making it un-settleable, or admin oversight) leaves the round permanently 'in progress'.

**Verified:** Confirmed from the actual code. The match lifecycle has no automatic 'live'->'finished' transition: fb_advance_live_windows (0010_auto_live_window.sql:22-26) only flips scheduled->live, and its own header comment (line 10) explicitly states "We never auto-FINISH". No other migration transitions live->finished (0012 only reads live matches for atmosphere). Finishing therefore depends on either (a) openfootball publishing an exact-matching final score via fb_sync_openfootball_results/fb_settle_from_openfootball_json (0014), or (b) admin entry (fb_admin_set_result 0001:330-357 / fb_admin_settle_round 0002:463).

The round-complete cascade is gated on ALL matches being finished. In fb_score_match (0002_m2_markets_props_decay.sql:226-231): v_all_done := bool_and(status='finished') over the round; only when true does it set rounds.completed=true and call fb_score_round. fb_score_round (redefined in 0003:79-121) both settles the round props (top_chef/clean_plate/spice) AND calls fb_snapshot_ranks (0003:119) which records rank_history powering rank_delta. So a single match still in 'live' makes v_all_done false -> props never settle (everyone who picked top_chef/clean_plate/spice gets 0) and no rank snapshot is taken.

The tournament revision window is also blocked: fb_tourney_revision_open (0002:96-107) returns false if ANY round has first_kickoff<=now() AND not completed. A stuck-liv …

**Fix:** Add a safety net so one un-settleable match cannot silently freeze a round: (1) Add a token-free pg_cron watchdog that, for matches still 'live' well past a sane window (e.g. kickoff + 3.5h, the same horizon fb_advance_live_windows uses), flags them (e.g. status 'awaiting_result' / a needs_attention column) and surfaces them in the Admin "Launch tools" so the admin is prompted to enter the score — turning a silent freeze into a visible action item. (2) Decouple the tournament revision window from a single stuck match: in fb_tourney_revision_open, treat a round as effectively complete when its last kickoff is sufficiently in the past even if one match lacks a final score, OR open the window per-round-not-in-active-play rather than requiring rounds.completed for every prior round. (3) Optionally have fb_score_match settle the round props/snapshot for the matches that ARE finished once the round's last kickoff has passed, rather than requiring bool_and(status='finished') over every match, so a single laggy fixture does not zero out everyone's prop scoring. (4) Improve openfootball matching robustness (normalize/alias team names) so a rename does not make a match permanently un-settleable.


### 15. round_props read policy ignores the grace window, so honest players' specials are visible-and-still-copyable even outside the launch overlap whenever an admin extends grace
*Subsystem:* `rls-visibility`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql:523-529 (round_props_read) — the `now() >= r.first_kickoff` branch

**Flaw:** The read policy's lock predicate (`now() >= r.first_kickoff`) is not the same predicate the write trigger uses to decide lock (`now() >= first_kickoff AND NOT fb_round_props_grace_active()`). The two sources of truth for 'is this round-prop locked?' can disagree. Any time an admin sets/extends `round_props_grace_until` (e.g. a later round launching late), the write lock re-opens but the read policy still treats the prop as public from first_kickoff. This is a structural inconsistency: the visibility gate and the lock gate are derived from different conditions, so they will diverge for any future round whenever grace is used again, re-creating the copy window each time.

**Verified:** Confirmed from the code. There are two different "is this round-prop locked?" predicates and they diverge whenever the round-props grace is active for a round whose first_kickoff has passed:

- READ visibility (anti-copying gate): supabase/migrations/0002_m2_markets_props_decay.sql:523-529, policy `round_props_read`. A non-owner can SELECT another player's round_props as soon as `now() >= r.first_kickoff` for that round. It never consults `fb_round_props_grace_active()`.
- WRITE lock: `fb_enforce_round_prop_lock` (0008_round_props_grace.sql:59, re-defined identically in 0013_pick_lock_hardening.sql:108) blocks a pick change only when `now() >= first_kickoff AND NOT fb_round_props_grace_active()`. So while grace is active, a player can still set/revise their own round props after the round has kicked off.

The overlap defeats the spec's anti-copying rule (own picks before lock, public only after lock). No later migration (0016 only hardened match_picks; 0017/0018 untouched) closes this; 0016 in fact fixed the analogous match-pick divergence by making writes strict at kickoff, leaving round_props as the lone inconsistency.

Concrete, currently-live scenario (no unusual admin action needed): seed sets MD1 first_kickoff = 2026-06-11 16:00Z (seed.sql:24); the default round-props grace (0008:18-20) is until 2026-06-14 17:59Z; today is 2026-06-14. During June 11-14, for MD1: the read  …

**Fix:** Make the read policy use the same lock predicate as the write trigger so there is one source of truth. Change `round_props_read` to also require grace to be inactive before exposing others' picks, e.g. the non-owner branch becomes: `exists (select 1 from public.rounds r where r.key = round_key and r.first_kickoff is not null and now() >= r.first_kickoff) and not public.fb_round_props_grace_active()`. Better: extract a single SQL helper `fb_round_props_locked(round_key)` returning `now() >= first_kickoff AND NOT fb_round_props_grace_active()` and call it from both the read policy and `fb_enforce_round_prop_lock`, so they cannot drift. Add a regression case to m_grace_test.sql: with grace ON and a kicked-off round, a non-owner SELECT of another user's round_props returns zero rows.


### 16. Allowlist fails OPEN when empty, on a public internet URL — one admin removal/DB-reset opens signup to the entire internet
*Subsystem:* `auth-admin`  
*Location:* /root/personal-projects/foodball/supabase/migrations/0015_signup_domain_allowlist.sql: fb_enforce_signup_domain() lines 45-48; fb_admin_remove_signup_domain() lines 93-104

**Flaw:** The signup-domain trigger returns NEW unconditionally when `public.signup_allowed_domains` has zero rows ('No allowlist configured → no restriction'). There is no floor preventing the table from becoming empty: fb_admin_remove_signup_domain happily deletes the last/only domain, and a `supabase db reset` / re-seed-skipped redeploy can also leave it empty. The app is deliberately exposed at a public HTTPS URL (https://foodball.tawfiqulbari.work), so an empty allowlist means anyone on the internet can create an account.

**Verified:** Confirmed from the actual code. `public.fb_enforce_signup_domain()` (0015_signup_domain_allowlist.sql:45-48) returns NEW unconditionally when `public.signup_allowed_domains` has zero rows — an explicit fail-open. `public.fb_admin_remove_signup_domain()` (lines 99-104) issues an unguarded `delete ... where lower(domain)=...` with NO floor preventing the table from becoming empty, so an admin can delete the last/only domain. The candidate's other emptying path (a `db reset` / redeploy where the `insert ... 'infosonik.com'` seed on line 31 is skipped/rolled back) is also possible.

The exploit chain has no compensating control, which I verified end-to-end:
- The app is deliberately public (CLAUDE.md: live at https://foodball.tawfiqulbari.work) and `0015` is described as the sole signup gate.
- `supabase/config.toml`: `enable_signup = true` and `enable_confirmations = false` (config.toml:33) — signup is open and there is NO email-confirmation loop, so an attacker need not control the email address; they are "in immediately."
- The frontend (`src/screens/Login.tsx:40`) calls `supabase.auth.signUp()` directly with no domain check, and `src/lib/api.ts` exposes add/remove RPCs.
- `fb_handle_new_user()` (0001_init.sql:170-185) is an AFTER INSERT trigger on `auth.users` that auto-provisions a `public.profiles` row. Trigger ordering is fine for the attack: the BEFORE-INSERT enforce fail-o …

**Fix:** Block emptying the allowlist and/or fail closed to a hardcoded owner domain. Minimal: in `fb_admin_remove_signup_domain`, refuse the delete if it would remove the last row — e.g. `if (select count(*) from public.signup_allowed_domains) <= 1 then raise exception 'FoodBall: cannot remove the last signup domain — add a new one first' using errcode='check_violation'; end if;` before the delete. Stronger: change `fb_enforce_signup_domain` to fail CLOSED on an empty allowlist by falling back to a hardcoded owner domain (e.g. allow only the bootstrap admin's domain) instead of `return NEW`, so an empty table never opens the door publicly. Also add a UI confirm before removing the last chip in Admin.tsx, and consider gating the AFTER-INSERT provision so unconfirmed/disallowed accounts don't surface on the leaderboard.


### 17. Unbounded total_goals number input lets one user permanently break tournament scoring (int4 overflow)
*Subsystem:* `frontend-logic`  
*Location:* src/screens/MyPicks.tsx:235-242 (number <input> onChange) + src/lib/api.ts:196 setTourneyPick; server: supabase/migrations/0002_m2_markets_props_decay.sql:306-311 (fb_score_tournament) called from fb_admin_set_tournament_result (line 507)

**Flaw:** The total_goals input only strips non-digits (replace(/[^0-9]/g,'')); it imposes no magnitude cap. The selection is stored verbatim as text (tourney_picks.selection is `text`, 0001_init.sql:101) with no numeric validation in fb_set_tourney_pick (only a non-empty check, 0002:447-448). fb_score_tournament later does `abs(r.selection::int - a.selection::int) <= 5`, casting that text to int4.

**Verified:** CONFIRMED from the actual code. The total_goals tournament pick is a real, ordinary-user-pickable field of kind:'number' (src/screens/MyPicks.tsx:30). Its input only strips non-digits — replace(/[^0-9]/g,'') at src/screens/MyPicks.tsx:238 — with no maxLength/clamp/slice (verified absent). setTourneyPick (src/lib/api.ts:196) passes the raw string to fb_set_tourney_pick, which validates only non-emptiness (0002:447-448). tourney_picks.selection is text with no magnitude CHECK (0001_init.sql:101), and the fb_enforce_tourney_pick trigger (0002:343-385) stamps the bucket and blocks forged points but does NO numeric validation. So a non-admin can store selection='999999999999'.

The detonation: fb_score_tournament (0002:306-311) casts a.selection::int for total_goals inside abs(r.selection::int - a.selection::int) <= 5. By standard Postgres semantics, '999999999999'::int raises 22003 numeric_value_out_of_range (int4 max 2,147,483,647), and there is no per-row exception handling, so the whole statement and the enclosing SECURITY DEFINER function/transaction roll back. The poisoned row is stealthy: the CASE's leading 'not exists (...tournament_results...)' guard (line 304) short-circuits the cast until a total_goals result is entered, so the bad pick passes every write-time check and only blows up at settlement. When the admin calls fb_admin_set_tournament_result('total_goals','160') ( …

**Fix:** Clamp the input range on both tiers. Client (src/screens/MyPicks.tsx ~238): cap the digit string, e.g. value.replace(/[^0-9]/g,'').slice(0,3) plus a sanity max (a tournament cannot exceed a few hundred goals), and reject >~300 before submit. Authoritative fix server-side: in fb_set_tourney_pick (or the fb_enforce_tourney_pick trigger), when pick_type='total_goals' validate the selection is a non-negative integer within a sane range (e.g. 0..999) and raise check_violation otherwise — and/or add a column CHECK so total_goals selections must match '^[0-9]{1,3}$'. As defense in depth, make fb_score_tournament's total_goals branch overflow-safe, e.g. cast via numeric and bound-check (abs(r.selection::numeric - a.selection::numeric) <= 5) or guard with a try-cast so one malformed row scores 0 instead of aborting the whole settlement.


## 🟡 LOW

### 18. fb_admin_settle_round defaults to marking a round complete and settling props even when matches are still unfinished
*Subsystem:* `scoring-ledger`  
*Location:* supabase/migrations/0002_m2_markets_props_decay.sql fb_admin_settle_round (p_mark_complete boolean default true; `update public.rounds set completed = true where key = p_round_key` then `perform public.fb_score_round`, lines ~463-486)

**Flaw:** Unlike the fb_score_match cascade (which only marks completed when bool_and(status='finished') over the round), fb_admin_settle_round unconditionally sets completed=true (default arg) and runs fb_score_round regardless of whether the round's matches have all finished. Because completion is a one-way latch (see related finding) and it both opens the tourney revision window and snapshots ranks, calling this RPC just to record top scorers mid-round prematurely and irreversibly completes the round.

**Verified:** Confirmed from the code, with important corrections to the candidate's claimed harm.

CONFIRMED mechanics:
- supabase/migrations/0002_m2_markets_props_decay.sql, fb_admin_settle_round (lines 463-487): p_mark_complete defaults to true and, when true, runs `update public.rounds set completed = true where key = p_round_key` (line 483) with NO check that the round's matches are all finished. Contrast fb_score_match's auto-cascade (lines 226-229): it gates completion on `select bool_and(status='finished') ... if coalesce(v_all_done,false) then update ... set completed=true`. So the two paths to completion are inconsistent: the automatic one is guarded, the admin RPC is not.
- Irreversibility: no production code anywhere sets `completed=false` (grep shows only the test harness m2 test does so via raw SQL). There is no admin "reopen round" RPC. So a mistaken completion can only be undone with direct DB access.
- Premature-completion side effects are real: fb_tourney_revision_open() (lines 96-107) returns true once no round has `now()>=first_kickoff and not completed`; marking MD2 complete mid-round removes MD2 from the in-progress set, opening the tournament-pick revision window early, and fb_latest_completed_round() then returns MD2 -> decay bucket MD3 (used to stamp set_after_round on new tourney picks). This is NOT self-healing.
- Rank snapshot: fb_score_round (M3 redefinition, 000 …

**Fix:** Add a completeness guard to fb_admin_settle_round so it refuses (or warns) when asked to mark a round complete while matches remain unfinished, mirroring fb_score_match's cascade. E.g. inside the `if p_mark_complete then` block (0002 line 482), first check `if exists (select 1 from public.matches where round_key = p_round_key and status <> 'finished') then raise exception 'FoodBall: cannot mark % complete — matches still unfinished', p_round_key; end if;` (or downgrade to only completing when all are finished). Optionally add an admin "reopen round" RPC (set completed=false) so an accidental completion is recoverable without raw DB access, and consider defaulting the Admin.tsx checkbox to false so completion is an explicit opt-in.


### 19. profiles_update RLS forbids admins from promoting other users, contradicting fb_protect_profile's stated design
*Subsystem:* `auth-admin`  
*Location:* /root/personal-projects/foodball/supabase/migrations/0001_init.sql: profiles_update policy lines 403-404 vs fb_protect_profile() lines 187-206

**Flaw:** fb_protect_profile's comment and logic are built so that 'existing admins can promote others' — it only coerces is_admin back to OLD when the caller is NOT already an admin. But the profiles_update RLS policy is `using (id = auth.uid()) with check (id = auth.uid())` with no `or public.fb_is_admin()` branch. Through the normal PostgREST client an admin can only UPDATE their own row, so they can never set is_admin=true on a teammate's row. The two sources of truth disagree about whether admins can promote others.

**Verified:** Confirmed from the actual code. In /root/personal-projects/foodball/supabase/migrations/0001_init.sql:

- fb_protect_profile() (lines 187-206) carries the comment "an untrusted request role (authenticated/anon) may flip is_admin ONLY if it is already an admin (so existing admins can promote others)" and its logic (lines 199-203) only coerces NEW.is_admin back to OLD when `current_user in ('authenticated','anon') AND NOT fb_is_admin()`. So the trigger is deliberately written to ALLOW an authenticated admin to set is_admin on any row that reaches it.
- profiles_update RLS (lines 403-404) is `for update to authenticated using (id = auth.uid()) with check (id = auth.uid())` — no `or public.fb_is_admin()` branch. I confirmed this is the only UPDATE policy on public.profiles across all migrations (grep across supabase/migrations/*.sql shows just line 403). `force row level security` is set (line 390), so authenticated admins are fully subject to it.

Consequence: a UPDATE on a teammate's row (id != auth.uid()) never matches a visible row under the RLS `using` clause, so it affects 0 rows and the trigger's admin-promotion branch never fires for that row. The branch is effectively dead via the normal PostgREST/supabase-js client. I verified there is no promote/make_admin/set_admin RPC anywhere (grep over supabase/ and src/), and Admin.tsx exposes no promote-user action (src/screens/Adm …

**Fix:** Either (a) align the RLS to the trigger's stated intent by adding an admin branch to the update policy: `using (id = auth.uid() or public.fb_is_admin()) with check (id = auth.uid() or public.fb_is_admin())` (the fb_protect_profile trigger still prevents self/peer escalation by non-admins, so this is safe), or (b) if app-driven promotion is NOT desired, remove the now-misleading "so existing admins can promote others" wording from fb_protect_profile's comment and simplify the branch, keeping direct-DB bootstrap as the only documented path. Option (a) is preferable if a "promote teammate" admin action is ever wanted; pair it with a small SECURITY DEFINER RPC (e.g. fb_admin_set_admin(target uuid, value boolean)) so promotion goes through an auditable, admin-gated function rather than a raw row update.


### 20. red_cards has no uniqueness guard — the void INSERT is not idempotent if target picks still exist (e.g., backup-restore then re-run)
*Subsystem:* `redcards-void`  
*Location:* supabase/migrations/0018_red_cards.sql:18-31 (only an identity PK, no unique(user_id,match_id,market)); scripts/void-post-kickoff-picks.sql:36-51 (insert ... select from match_picks)

**Flaw:** The script's idempotency relies entirely on the fact that step 3 deletes the source match_picks, so a second full run JOINs an empty set and inserts 0 cards. But red_cards itself has NO unique constraint. If the documented reversible backup (docs/voided-picks-backup-2026-06-14.sql) is restored (re-inserting the picks + score_events) and the void script is then re-run — exactly the recovery path the script header advertises — step 1 will insert a SECOND identical red_cards row for every pick, doubling the displayed "points cut" and the carded-pick counts. The sanity NOTICE hardcodes "expect 23" and the only assert checks n_left=0, so a doubled red_cards table passes silently.

**Verified:** Confirmed from the actual code. (1) `public.red_cards` (0018_red_cards.sql:18-31) has only an identity PK — no `unique(user_id, match_id, market)` and no other uniqueness constraint; grep across all migrations 0001-0018 finds zero unique/constraint/ON CONFLICT references for red_cards, and there is no migration after 0018. (2) The void script (scripts/void-post-kickoff-picks.sql:36-58) inserts red_cards via a plain `insert ... select` from `match_picks` with no ON CONFLICT, then deletes the source picks. Its idempotency on a *plain* re-run is real and sound: step 1 joins `match_picks` by `_void_ids`, those rows were deleted in step 3, so a second straight run inserts 0 cards — not a bug.

The flaw is narrow but genuine and matches the candidate exactly. The script header (lines 11-12) advertises a reversible backup at docs/voided-picks-backup-2026-06-14.sql, and that backup file (verified: lines 1-3 header, lines 7-54 INSERTs) re-inserts the exact match_picks (ids 87,88,92,...) and their score_events under `session_replication_role=replica`. If an operator restores from that backup and then re-runs the void script — the recovery/verify-reversibility path the headers describe — step 1 finds the picks present again and inserts a SECOND identical red_cards row for each (no unique key to stop it). red_cards then holds 46 rows instead of 23.

The sanity block (lines 61-69) does NOT  …

**Fix:** Add `unique (user_id, match_id, market)` to public.red_cards in a new migration (after de-duping any existing rows), and use `insert ... on conflict (user_id, match_id, market) do nothing` in scripts/void-post-kickoff-picks.sql step 1. Additionally, harden the sanity block to assert on inserted-card count for the target set (e.g. assert exactly 23 distinct target cards) rather than only `n_left = 0`, so a duplicated table fails loudly instead of passing.


### 21. Match-pick optimistic state stores points_awarded:null and id:-1 and is never reconciled with server scoring while the tab stays open
*Subsystem:* `frontend-logic`  
*Location:* src/screens/Matches.tsx:96-110 (onPick setPicks) and the absence of a match_picks realtime subscription (only `matches` is subscribed, lines 77-88)

**Flaw:** onPick optimistically writes the pick into local state with points_awarded:null and id:(existing?.id ?? -1). The Matches screen subscribes to `matches` UPDATEs (re-fetching matches) but never re-fetches match_picks on a score event, so once the server scores a finished match (writing points_awarded), the Matches view keeps showing the stale optimistic pick with null points until a tab switch / remount.

**Verified:** Confirmed from the code. In src/screens/Matches.tsx the `picks` map (state, line 38) is populated by `fetchMyPicks()` ONLY inside the activeRound effect's initial Promise.all (line 71). The realtime channel handler (lines 77-84) subscribes to `matches` UPDATEs and on a change calls `loadMatches()` (line 70), which re-fetches ONLY `matches` — it never re-fetches `match_picks`. `onPick` (lines 96-110) optimistically writes the pick with `points_awarded: null` (and `id: existing?.id ?? -1`).

When a match finishes: fb_score_match (supabase/migrations/0001_init.sql:284-314) writes the real `points_awarded` into match_picks server-side, and the `matches` row UPDATE (status→finished, scores) is pushed via realtime (matches IS in the supabase_realtime publication per 0003_m3_autosync_realtime.sql:189-192). The matches channel handler fires, `match.status` flips to 'finished', and MatchCard renders the "Result summary" block (MatchCard.tsx:160-174) which reads `outcomePick.points_awarded` — still `null` in the in-memory map because match_picks is NOT in the realtime publication and is never re-fetched. So a pick that actually scored renders as "Burnt Toast. +0" (line 164) and "+0" chips (ResultChip, lines 285-294: `win = (pts ?? 0) > 0`, null→+0) until the user switches tabs and back (App.tsx:70 conditionally mounts Matches, so leaving the tab unmounts it and a return re-runs the effec …

**Fix:** In the activeRound effect in src/screens/Matches.tsx, also re-fetch picks (and round props) when the matches realtime channel fires, not just `loadMatches()`. E.g. define `const reload = () => { void loadMatches(); void fetchMyPicks().then((p) => alive && setPicks(p)); void fetchMyRoundProps(activeRound).then((rp) => alive && setProps(rp)) }` and call `reload` from the channel's `.on(...)` handler (lines 79-83) instead of `loadMatches`. Optionally also subscribe to `score_events` (already in the realtime publication) as the trigger, since match_picks itself is not published. This keeps the in-memory points in sync with server scoring while the tab stays open.


### 22. Exact-score stepper clamps each side to 0-9, making any 10+ goal real result unmatchable for everyone
*Subsystem:* `frontend-logic`  
*Location:* src/components/MatchCard.tsx:197-198 (step() clamps Math.max(0, Math.min(9, ...))); server compares against fb_score_match v_exact built from the true integer score, supabase/migrations/0002_m2_markets_props_decay.sql:186-187,202

**Flaw:** The exact-score selection is capped to single digits per side, but the server's v_exact is the literal `home::text||'-'||away::text` with no cap, so any score with a 10+ on one side (e.g. '10-0') can never equal a user selection.

**Verified:** Confirmed from the code. ExactScoreStepper in src/components/MatchCard.tsx (step() at lines 197-198) clamps each side with Math.max(0, Math.min(9, cur + d)), so the UI can only ever produce selections in the range '0-0'..'9-9'. This stepper is the sole UI path to set an exact_score pick (MatchCard.tsx:125-131 -> Matches.tsx onPick -> match_picks insert). The server scorer fb_score_match in supabase/migrations/0002_m2_markets_props_decay.sql builds v_exact from the true integer score with no cap (lines 186-187: coalesce(home_score_et, home_score)::text || '-' || coalesce(away_score_et, away_score)::text) and awards 25 only when mp.selection = v_exact (line 202). The selection column is plain `text not null` with no check constraint (0001_init.sql:77), so the server's value domain is unbounded while the client's is capped at 9.

Concrete scenario: a match ends 10-0. v_exact = '10-0'. No player could have entered '10-0' (UI max is '9-9'), so every Full Course / exact_score pick on that match scores +0 even for someone who would have predicted it correctly. Outcome, BTTS, and over_under still settle correctly (they don't depend on the literal score string).

This is a real internal inconsistency (two sources of truth — client input range vs. server scoring domain — disagree on valid values). However impact is genuinely low: (1) a 10+ goal tally for one side is extraordinarily rare  …


### 23. Golden Glove tournament picker offers all players (incl. outfielders) while the prop's keeper picker filters to GKs — and clean_plate SQL scorer never verifies the selection is a goalkeeper
*Subsystem:* `consistency-mirrors`  
*Location:* src/screens/MyPicks.tsx:24-31 (PICK_META marks golden_glove kind:'player' with no position filter; playerOpts at :182-186 lists every catalog player); contrast src/components/RoundPropsCard.tsx:32 (keepers = position starts with 'G') for clean_plate. SQL clean_plate scorer: 0002_m2_markets_props_decay.sql:256-262 / 0003_m3_autosync_realtime.sql:93-99 joins players_catalog by id only, with no position='GK' check.

**Flaw:** There are inconsistent rules for 'who counts as a goalkeeper' across sources. The round 'Clean Plate' UI restricts the dropdown to GK-position players (RoundPropsCard), but (a) the tournament 'Golden Glove' UI (MyPicks) lets the user pick any player including forwards, and (b) the SQL clean_plate scorer awards 10 pts to ANY selected player whose team kept a clean sheet, with no goalkeeper check. The catalog's 'position' field is the only definition of 'keeper' and it is enforced in one place and ignored in two others.

**Verified:** Confirmed from the actual code. The "who counts as a goalkeeper" rule is enforced in exactly one place (the UI) and ignored in the two that matter for authority.

clean_plate (real, exploitable):
- UI filter: src/components/RoundPropsCard.tsx:32 builds `keepers = players.filter(p => (p.position ?? '').toUpperCase().startsWith('G'))` and the Clean Plate dropdown (lines 100-103) only offers those. This is the ONLY GK check in the system.
- SQL scorer ignores position: fb_score_round in 0002_m2_markets_props_decay.sql:256-262 and again in 0003_m3_autosync_realtime.sql:93-99 joins `players_catalog pc ... where pc.id::text = rp.selection AND ((mt.home_team = pc.team and mt.away_score = 0) or (mt.away_team = pc.team and mt.home_score = 0))` — it matches on player id + the player's team keeping a clean sheet, with NO `position = 'GK'` check. Any player of that team scores the full 10.
- No server-side gate stops a forged selection: round_props RLS (0001_init.sql:435-436 `round_props_own`) only checks `user_id = auth.uid()`; the lock trigger fb_enforce_round_prop_lock (0002:392-426, re-defined 0013:81-115) validates only timing and points_awarded — never the selection's position. selection is free `text not null` (0001:90) with no FK or check constraint.
- The catalog is populated with outfielders (0017_seed_players_catalog.sql, e.g. 'seed:bra:vinicius-junior' FW on BRA, 'seed:bra:raph …

**Fix:** Mirror the GK rule server-side for clean_plate: in fb_score_round (both 0002 and the 0003 redefinition) add `and upper(coalesce(pc.position,'')) like 'G%'` to the players_catalog join so a non-keeper selection scores 0 even if forged. Optionally add a validation trigger/constraint on round_props that rejects a clean_plate selection whose catalog position is not a goalkeeper at insert time (defense in depth). For Golden Glove, filter MyPicks.tsx's player options for pick_type 'golden_glove' to GK-position players (reuse the same `position starts with G` predicate as RoundPropsCard) so the tournament picker and the round picker agree on the definition of a keeper. Add an SQL test asserting an outfielder selected for clean_plate yields 0.


## ⚪ INFO

### 24. The Menu rules page describes exact_score as a '+25 bonus' on the outcome, but the scorer pays a flat, independent 25
*Subsystem:* `scoring-ledger`  
*Location:* src/screens/More.tsx line 47 ('Exact final score — +{MARKET_POINTS.exact_score} pts bonus') and src/lib/scoring.ts line 9 ('exact_score: 25, // bonus on top of the outcome points') vs supabase/migrations/0002 fb_score_match exact branch (`when 'exact_score' then case when mp.selection = v_exact then 25 else 0 end`)

**Flaw:** The user-facing rules and the TS comment frame exact_score as an additive bonus on top of the 10-pt outcome (implying a correct exact pick is worth 35 and is contingent on a correct outcome). The authoritative SQL scorer treats exact_score as a fully independent market that pays a flat 25 with zero relationship to whether the user also placed/won an outcome pick. The two sources of truth disagree about the meaning of the same number.

**Verified:** Confirmed from the actual code. The authoritative scorer in supabase/migrations/0002_m2_markets_props_decay.sql fb_score_match (line 202) scores exact_score as a fully independent market: `when 'exact_score' then case when mp.selection = v_exact then 25 else 0 end`, with no dependency on the user having an outcome pick. The schema (0001_init.sql line 76/80) makes exact_score a separate market row with `unique (user_id, match_id, market)`, and Matches.tsx (line 144) lets each market be placed independently, so a user can place ONLY exact_score.

Meanwhile the documentation and spec frame it as a contingent bonus: src/screens/More.tsx line 47 renders "Exact final score — +25 pts bonus", src/lib/scoring.ts line 9 comments "exact_score: 25, // bonus on top of the outcome points", and the canonical spec (plans/worldcup-league-claude-code-prompt.md line 55: "+25 bonus on top of outcome points"; line 143: the exact-score overlay shows "FULL COURSE! +35" = 10 outcome + 25 bonus). The result overlay reinforces the +35 framing: src/lib/resultMoments.ts line 57 sums points_awarded across ALL of a match's picks, so the 35 only materializes when the player placed BOTH a winning outcome pick and a winning exact_score pick.

So the two sources of truth genuinely disagree about the meaning of the number 25: the docs/spec say it is a +25 bonus layered on the 10-pt outcome (implying it requires/ …

**Fix:** Pick one source of truth and make the rest match it. Easiest (no scoring change): reword the user-facing copy and the TS comment so "bonus" no longer implies contingency — e.g. More.tsx line 47 to "Exact final score — 25 pts (on top of your 10-pt correct outcome, for 35 total)" and drop the "// bonus on top of the outcome points" comment in scoring.ts in favor of "// independent market; pairs with a correct outcome for 35 total". If instead the spec's contingency is the desired behavior, change fb_score_match so exact_score pays only when the player also holds a correct outcome pick on the same match (e.g. join match_picks for that user's outcome row and require it equals v_outcome before awarding 25), and re-run m2_markets_props_decay_test.sql plus the decay Vitest. The documentation-only fix is recommended since it preserves the simpler, already-tested independent-market design.


### 25. Signup-domain trigger is INSERT-only — an already-allowed user can change their auth.users email to an off-allowlist domain
*Subsystem:* `auth-admin`  
*Location:* /root/personal-projects/foodball/supabase/migrations/0015_signup_domain_allowlist.sql: trigger trg_enforce_signup_domain lines 62-72 (BEFORE INSERT only)

**Flaw:** fb_enforce_signup_domain is bound only to BEFORE INSERT on auth.users. GoTrue email-change flows are UPDATEs to auth.users.email and are never re-validated against the allowlist. The allowlist therefore gates account *creation* but not the domain an account ultimately resolves to.

**Verified:** Confirmed from the actual code. In supabase/migrations/0015_signup_domain_allowlist.sql, fb_enforce_signup_domain() validates NEW.email against public.signup_allowed_domains, but the trigger trg_enforce_signup_domain is bound only `before insert on auth.users` (lines 66-68). There is no BEFORE UPDATE trigger, and no other migration references auth.users for email validation (grep shows only 0001_init.sql's profiles FK and the on-insert profile trigger). GoTrue's email-change flow (supabase.auth.updateUser({ email }), reachable by any authenticated user directly via the anon key independent of the app UI) is an UPDATE to auth.users.email and is therefore never re-checked against the allowlist.

Impact is real but narrow, and the candidate's own scoping is accurate:
- It does NOT permit an unauthorized NEW signup. The actor must already be an admitted user (must have passed the INSERT check) to issue the UPDATE. The allowlist's stated goal in the header comment — gate account creation so the URL can be shared safely — still holds.
- Admin grant persistence is confirmed: is_admin lives in public.profiles keyed by the auth.users UUID (0001_init.sql line 18/21), and changing email does not change the UUID, so any grant survives the domain change.
- The app itself surfaces no email-change UI (AuthProvider.tsx only does getSession/onAuthStateChange/signOut; Login.tsx is the only email …

**Fix:** Add a BEFORE UPDATE trigger on auth.users that runs the same domain check when the email column changes, e.g.: `create trigger trg_enforce_signup_domain_upd before update of email on auth.users for each row when (NEW.email is distinct from OLD.email) execute function public.fb_enforce_signup_domain();` The existing function already reads NEW.email and fails open on an empty allowlist, so it can be reused as-is. Guard it inside the same `to_regclass('auth.users') is not null` block so the test harness still skips it. (Optional: this is low priority for a 6-week office league where every admitted user is already trusted — acceptable to leave as a documented limitation.)


### 26. The 'created_at > kickoff' selection heuristic cannot catch in-place edits of pre-kickoff picks (under-voids), because the upsert never bumps created_at
*Subsystem:* `redcards-void`  
*Location:* src/lib/api.ts:58-64 (submitMatchPick upsert sends only selection on conflict); detection basis in docs/post-kickoff-picks-audit.md:28-34; void list is the manually-curated _void_ids in scripts/void-post-kickoff-picks.sql:22-30

**Flaw:** match_picks is written via upsert on (user_id,match_id,market) updating only `selection`; created_at is the row default and is never updated on conflict, and there is no trigger bumping it (updated_at exists but is unused by the audit). So a pick first placed BEFORE kickoff and silently re-edited AFTER kickoff during the 0011 grace window keeps its original pre-kickoff created_at and is invisible to the `created_at > kickoff` detection that produced the void list. This means the void is a lower bound: such tampering is neither carded nor reversed, while the players who happened to place a fresh post-kickoff pick are penalized — an asymmetric fairness gap.

**Verified:** Confirmed from the actual code. (1) match_picks (supabase/migrations/0001_init.sql:72-81) has only `created_at timestamptz not null default now()` and NO `updated_at`. (2) submitMatchPick (src/lib/api.ts:58-64) upserts {user_id,match_id,market,selection} with onConflict='user_id,match_id,market', which becomes INSERT ... ON CONFLICT DO UPDATE SET selection=... — `created_at` is never updated on conflict. (3) Neither the 0011 nor 0016 version of fb_enforce_match_pick_lock writes `created_at`; no audit/history trigger exists (grep found only unrelated rank_history/comment matches). (4) During the 0011 grace window, an UPDATE that changed `selection` on a non-finished match while grace was active fell through and was ALLOWED (0011 line 90), leaving the original pre-kickoff `created_at` intact. (5) The void list in scripts/void-post-kickoff-picks.sql:22-30 is a hardcoded `_void_ids` set derived solely from the audit's `where p.created_at > m.kickoff` query (docs/post-kickoff-picks-audit.md:122-138), and docs/voided-picks-backup-2026-06-14.sql confirms those exact rows.

Concrete scenario: during grace, player A places outcome='home' at 20:00 (kickoff 21:00), then at 21:30 (match live, 0-0) edits it to outcome='draw' via the same upsert. `created_at` stays 20:00, so created_at > kickoff is false and the pick is never flagged or voided — A keeps an after-the-fact prediction and its p …

**Fix:** Retrospective tampering of this kind is unrecoverable from match_picks alone (no per-edit timestamp was ever stored). For completeness/transparency the void doc/script could state that the curated list covers only first-placed-after-kickoff picks and that in-place edits during the grace window are unverifiable. To prevent any future recurrence of an undetectable edit (defense in depth beyond 0016's hard lock), add an `updated_at timestamptz not null default now()` column to match_picks with a BEFORE UPDATE trigger that sets it to now() whenever selection/market change, so any post-kickoff content change is timestamped and auditable even if a future grace-style window is reintroduced. No leaderboard impact today since 0016 already blocks all post-start writes.
