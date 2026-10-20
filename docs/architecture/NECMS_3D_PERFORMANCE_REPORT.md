# NECMS 3D performance report

2026-10-19. Synthetic local measurements only; no production capacity or hospital outcome claim.

## Method and environment

Portable PostgreSQL 17.11 on Windows, verified temporary loopback target, 16 connections and 64 MB shared buffers. Fresh synthetic database with all twelve migrations, two fictional hospitals, Auth identity stub and actual SQL/RLS/functions. No hosted connection. Laptop CPU/RAM details could not be read through CIM (access denied); hardware capacity is not assumed. Other development processes were running; results vary.

`scripts/benchmark-bounded-postgres.py --confirm-local-synthetic` runs the real security/concurrency setup first, then loads exact active-encounter totals and one fictional task per additional encounter. It compares the retained 3C combined RPC with the new 25-row queue RPC on the same engine/data. Different response contracts are intentional: this measures bounded projection versus full bundle, not identical result sets.

SQL execution comes from `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Python timings include local database round trip and JSON decoding. JSON byte sizes use compact UTF-8 serialization. No network HTTP transfer or real Supabase transport was measured. Three elapsed samples are reported; the explain sample is separate, so do not subtract them to infer transfer cost.

## Board results

| Active encounters | Legacy SQL ms | Paged SQL ms | Legacy JSON bytes | Paged JSON bytes | Paged round-trip/decode ms (3 samples) | Returned rows |
| ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 100 | 6.382 | 7.413 | 113,848 | 23,174 | 30.73, 9.65, 8.71 | 25 |
| 1,000 | 42.572 | 27.139 | 1,552,699 | 23,178 | 36.37, 29.54, 29.19 | 25 |
| 5,000 | 556.605 | 357.640 | 7,947,870 | 23,180 | 368.05, 327.28, 347.16 | 25 |
| 10,000 | 1016.066 | 576.230 | 15,931,838 | 23,182 | 611.72, 623.58, 623.99 | 25 |

The 5,000-row run reduced the transferred JSON representation from approximately 7.9 MB to 23 KB. Scope totals and revision scans still depend on hospital size. The SQL time at 100 records can be slightly higher because consistent cursors/counts have overhead; no universal speedup is asserted.

## Search and filter results

Search uses the literal identifier query `SYN-LOAD-`; the filter uses triage state plus a verified service ID. These are particular distributions, not exhaustive query coverage. Substring search is parameterised but not a full-text/trigram search engine.

| Active encounters | Patient search SQL ms / bytes | Service + triage filter SQL ms / bytes |
| ---: | --- | --- |
| 100 | 3.708 / 1,616 | 5.501 / 15,956 |
| 1,000 | 6.857 / 7,461 | 28.850 / 38,623 |
| 5,000 | 66.081 / 7,462 | 303.087 / 38,626 |
| 10,000 | 107.144 / 7,462 | 617.616 / 38,627 |

## API, browser and concurrency boundaries

Django TestClient executed real request validation, hospital-context permission checks and actual PostgreSQL RPCs through a local adapter. Supabase Auth/HTTP were stubbed. At 10,000 active encounters the three in-process request samples were 655.73 ms, 611.33 ms, 597.2 ms. Each returned 23182 bytes. This is not network HTTP latency or throughput.

Four independent local readers at 10,000 encounters returned 25 rows each in 439.45 ms, 400.21 ms, 434.09 ms, 412.31 ms. This is a four-request probe, not a sustained concurrent-user load test. The separate real concurrency suite passed writer/bed/retry/revocation/deadlock/timeout checks and a page read while a clinical writer held a lock; after commit the old continuation failed with 40001.

The real React/Edge browser probe showed the first 25-row coordination view in 1507.70 ms at 1440x1000. This measures click-to-visible rows, including lazy module loading, mocked response handling, React/layout and local tooling; it is not isolated React CPU commit time, LCP, network HTTP or device certification. Other runs varied substantially with cache/tooling. Tablet bounds, page navigation and history-not-refetched-on-poll checks passed.

## Query plans

The bounded RPC explain is a Result/function plan; its top-level execution time includes internal work but does not expose every dynamic SQL subplan. A separate authorised scoped work lookup selected the existing `coordination_encounter` index with RLS predicates. The full plan is emitted to the ignored performance artifact.
Lookup execution time: 1.299 ms. Plan details:

```json
{
  "Node Type": "Result",
  "Parallel Aware": false,
  "Async Capable": false,
  "Startup Cost": 0.29,
  "Total Cost": 11.58,
  "Plan Rows": 1,
  "Plan Width": 16,
  "Actual Startup Time": 0.925,
  "Actual Total Time": 1.268,
  "Actual Rows": 2,
  "Actual Loops": 1,
  "One-Time Filter": "((necms_context()).hospital_id = 'a0000000-0000-0000-0000-000000000001'::uuid)",
  "Shared Hit Blocks": 63,
  "Shared Read Blocks": 0,
  "Shared Dirtied Blocks": 0,
  "Shared Written Blocks": 0,
  "Local Hit Blocks": 0,
  "Local Read Blocks": 0,
  "Local Dirtied Blocks": 0,
  "Local Written Blocks": 0,
  "Temp Read Blocks": 0,
  "Temp Written Blocks": 0,
  "Plans": [
    {
      "Node Type": "Index Only Scan",
      "Parent Relationship": "Outer",
      "Parallel Aware": false,
      "Async Capable": false,
      "Scan Direction": "Forward",
      "Index Name": "coordination_encounter",
      "Relation Name": "coordination_work_items",
      "Alias": "coordination_work_items",
      "Startup Cost": 0.29,
      "Total Cost": 11.58,
      "Plan Rows": 1,
      "Plan Width": 16,
      "Actual Startup Time": 0.724,
      "Actual Total Time": 1.066,
      "Actual Rows": 2,
      "Actual Loops": 1,
      "Index Cond": "((hospital_id = 'a0000000-0000-0000-0000-000000000001'::uuid) AND (encounter_id = '81c4a5b8-3d74-42bb-9454-bfa9825b8910'::uuid))",
      "Rows Removed by Index Recheck": 0,
      "Filter": "(necms_has('queue.read'::text) AND necms_has('encounter.read'::text) AND necms_has('patient.identity.read'::text))",
      "Rows Removed by Filter": 0,
      "Heap Fetches": 2,
      "Shared Hit Blocks": 57,
      "Shared Read Blocks": 0,
      "Shared Dirtied Blocks": 0,
      "Shared Written Blocks": 0,
      "Local Hit Blocks": 0,
      "Local Read Blocks": 0,
      "Local Dirtied Blocks": 0,
      "Local Written Blocks": 0,
      "Temp Read Blocks": 0,
      "Temp Written Blocks": 0
    }
  ]
}
```

## Comparison with 3C and remaining work

The historical 3C embedded timings (~27/216/2,679 ms and ~7.8 MB at 5,005 encounters) used PGlite and slightly different fixtures. Do not calculate latency improvement against those figures as if the engine/hardware/sample were identical. The same-engine table above is the defensible comparison. Payload reduction is expected because the new path returns one bounded page instead of every patient/work/history object.

Five public indexes and one private cursor-expiry index were added. No clinical row lock was introduced by read pagination. Revision fingerprints and exact summary counts still scan scoped data; offset continuation may scan/sort preceding rows. Large immutable evidence is paged independently. Existing compatibility read routes remain unbounded and must be reviewed/limited before hosted operation.

Blocked/not executed: real Supabase Auth/REST and managed query planner, WAN transfer/TLS/proxy latency, production-sized history retention, sustained HTTP/concurrent-user load, exhaustive lock graphs, actual hospital devices and isolated React profiler measurements. No production capacity or reduced waiting times can be inferred.

Artifacts: `test-results/necms-3d-performance.json` and `test-results/necms-3d-browser.json` (ignored, synthetic only). The repository script reproduces measurements against a verified local test cluster; it never reads a hosted connection string.
