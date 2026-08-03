# FENN Deeds — production QA checklist

Run after migration `20260803190000_45_deed_submission_wall_link.sql` is applied and Desk access is available.

Verify SQL: `supabase/verify_deed_submission_wall_link.sql`

## Desk author — definitions

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Open `/desk/deeds` | **Definitions** is default. Submissions tab reachable. |
| 2 | WRITE A DEED → Road, Fixed LEAF (e.g. 10), text evidence allowed | Draft saves; status `draft`; not on public `/deeds` |
| 3 | Preview before and after save | PREVIEW — NOT YET IN THE WORLD; local form data shown |
| 4 | Set starts/ends in local time (UK summer and winter windows if possible) | Saved ISO instant; reopening form shows same local wall-clock |
| 5 | RELEASE INTO THE WORLD | Confirm; status ACTIVE; `published_at` set |
| 6 | Public listing on | Appears on `/deeds` and `/deeds/{slug}` |
| 7 | Create Greenwood range-reward deed (min ≤ max), publish, public listing on | Only Greenwood members can submit; range shown on public page |
| 8 | Create no-LEAF deed, publish | Public shows no LEAF reward |
| 9 | Publish with no allowed evidence | Blocked with validation message |
| 10 | Publish with `common` scope (API only) | Rejected (`common_not_available`) |

## Public outlaw

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Registered outlaw, Road deed | Can open and submit text / URL / image as allowed |
| 2 | Required field missing | Client/server validation blocks submit |
| 3 | Non-member on Greenwood deed | Denied |
| 4 | Member on Greenwood deed | Accepted into pending |
| 5 | Closed deed | New submissions blocked |

## Desk moderation — submissions

| Step | Action | Expected |
| --- | --- | --- |
| 1 | `/desk/deeds?view=submissions` | Queue loads; filters work |
| 2 | Open pending; view evidence (image via Desk image route only) | Evidence visible to Desk only |
| 3 | Approve fixed-reward submission | Exact fixed LEAF; ledger row; completion count +1 once |
| 4 | Approve range with valid chosen amount | Award = chosen amount |
| 5 | Approve range invalid amount | Rejected |
| 6 | Approve no-LEAF | Approved; leaf_awarded 0/null; no fake award |
| 7 | Reject | Status rejected; no LEAF |
| 8 | Re-approve same submission | Idempotent; no second LEAF |
| 9 | Close parent deed; pending remains | Still reviewable and approvable |
| 10 | Actor fields | Browser never supplies actor; server uses Desk identity |

## Wall inscription

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Approved + unshared | INSCRIBE ON THE WALL available |
| 2 | Pending / rejected | No Wall action |
| 3 | Open composer; edit default body | Default has no wallets, emails, evidence, UUIDs, notes |
| 4 | Empty / HTML body | Rejected |
| 5 | Inscribe | Wall entry via `writeFennWallEntry`; submission `wall_entry_id` set; list shows WALL |
| 6 | Inscribe again | Idempotent; no second entry; no LEAF change; still approved |
| 7 | View inscription | `/wall` shows the body |
| 8 | Concurrent double-click | Single shared link (busy disables; server provenance unique) |

## Lifecycle

| Step | Action | Expected |
| --- | --- | --- |
| 1 | CLOSE THE DEED (active) | Active → closed; gone from public board; completions preserved |
| 2 | ARCHIVE (closed) | Closed → archived; read-only |
| 3 | Attempt edit active/closed/archived | Form disabled; PATCH refused |
| 4 | DUPLICATE any status | New draft; title ends `(Copy)`; dates cleared; published_at null; counters 0; no submissions/Wall copied |
| 5 | Delete unused draft | Removed; returns to definitions |
| 6 | Delete draft with submissions | Refused with product message |

## Failure states

| Case | Expected UI |
| --- | --- |
| 401 / 403 | Sign-in or access denied; no success flash |
| 404 deleted deed tab | Not found; back link |
| Slug conflict | Clear slug conflict message |
| Stale publish/close | invalid transition / refresh message |
| Network drop mid-save / publish / wall | Network failure message; no false success |
| Migration not applied | Share returns schema_not_ready; submissions queue still loads |

## Security spot-check

- No public insert/update on `deeds` or `wall_entries` from browser client.
- Desk routes call `requireFennDeskAccess`.
- Private evidence never appears in default Wall inscription or public DTOs.
