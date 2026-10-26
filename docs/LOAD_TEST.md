# Load test: the demo at 15,000 applications

Run with `npm --workspace api run load:test` (script: `api/scripts/load-test.ts`). It resets the demo database, copies the seeded applications with their deadline items and assignments until there are 15,000 applications (due dates spread ±20 days around today), times two full deadline-engine cycles, then times the main read screens under 20 concurrent requests. It resets the demo database again at the end.

Results from 26 Oct 2026, on 4 vCPU (Intel Xeon 2.8 GHz), 16 GB RAM, PostgreSQL 16 and Node 22 on the same machine.

## Data

| | Count |
|---|---|
| Applications | 15,000 (192 seeded, the rest copied) |
| Deadline items | 27,349 (13,979 open) |
| Assignments | 17,264 |
| Bulk load time | 4.5 s |

## Deadline engine

| Cycle | Time | New alerts | Notifications | Flags raised |
|---|---|---|---|---|
| First (all 13,979 open items checked) | 140 s | 9,277 (1,703 reminders, 1,617 late reminders, 1,560 at risk, 2,423 overdue, 3,574 escalations) | 9,756 | 9,050 |
| Second, straight after | 74 s | **0** | 0 | 0 |

The second cycle added no alerts: the unique key on alerts keeps a re-run from sending anything twice, at this scale too.

## Read screens (20 concurrent requests, 400 per screen)

| Screen | p50 | p95 | Max | Requests/s | Errors |
|---|---|---|---|---|---|
| Action Center (officer) | 471 ms | 624 ms | 782 ms | 42 | 0 |
| Action Center summary (senior) | 298 ms | 417 ms | 463 ms | 66 | 0 |
| Applications list (officer) | 1,347 ms | 1,602 ms | 1,999 ms | 15 | 0 |
| Team report (senior) | 2,976 ms | 3,466 ms | 3,683 ms | 7 | 0 |
| Authority queue | 598 ms | 733 ms | 746 ms | 33 | 0 |

## What this shows and what it does not

- The prototype handles the deck's assumed scale (15,000 applications in a cycle) with no errors and no duplicate alerts.
- A full engine cycle takes longer than the demo's one-minute schedule at this scale. Alerts are date-based, so production needs one full cycle a day, plus the advisory lock already stops cycles overlapping. Batching the item queries is the planned fix.
- The team report and the applications list are the slowest screens. They are the reads the production plan moves to the read replica, with paging.
- This is a single-machine test on synthetic data, not a production benchmark.
