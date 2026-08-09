# Athlete Visual Defect Inventory

Reviewed using the model-shot and swing-shot captures at close and field
distance. The inventory is deliberately honest: these are presentation defects,
not simulation or collision defects.

| Rank | Area | Observation | Action/status |
|---:|---|---|---|
| 1 | Batter contact | Contact frame is authoritative and readable, but the low-poly forearm/bat join can look angular in the tightest crop. | Preserved exact `SWING_CONTACT_FRAME`; bat taper and grip rings improved. Remaining stylization is intentional. |
| 2 | Pitch release | Pitch set → release is smooth, with a short bounded transition. | Covered by native pose buffer and swing/replay captures. |
| 3 | Throw release | Field-ready → throw uses a short release blend; root position remains simulation-owned. | Covered; no outcome code reads pose state. |
| 4 | Glove close | Standard/first-base/catcher glove silhouettes read clearly; close animation remains intentionally simple. | Native glove geometry shipped; no detached glove observed. |
| 5 | Catcher crouch | Mask cage, chest protector, shin guards, and catcher mitt read at field distance. | Shipped and captured. |
| 6 | Dive/landing | Dive uses a short cut-like transition to avoid smearing through impact. | Shipped; grass fragments are presentation-only. |
| 7 | Slide/recovery | Slide uses a short transition and dirt spray. | Shipped; dirt pool bounded. |
| 8 | Run start/stop | Run transition is smooth enough at broadcast distance; foot plant remains stylized. | No simulation change justified. |
| 9 | Cleat/foot plant | Studs are visible in closeups but intentionally simplified at field distance. | Shipped with shared cached geometry. |
| 10 | Gear clipping | No high-impact catcher gear clipping found in reviewed poses; single-view prototype limitations remain. | Native geometry is shipping authority. |

Evidence: `docs/screenshots/model-catcher-full-kit.png`,
`model-first-base-mitt.png`, `model-batter-back.png`, and the swing sequence
captures. Exact contact timing is covered by `src/tests/actors.test.ts` and
`npm run swing`.
