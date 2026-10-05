# Preserve Manifest's current lab report in label imports

## Confirmed mismatch

Manifest PR #220 is deployed and its live `/api/retail-labels/label-data/:tag` response was verified on 2026-10-05 for RoseWater parent `1A4120300001A94000000352` and splits `1A4120300001AFD000007660` / `1A4120300001AFD000007917`:

- `thcPercent: 31.7874`, `thcMgG: 317.87`.
- `tacPercent: 36.6422`, `tacMgG: 366.42`; all total-cannabinoid percentage/mg-g aliases agree.
- `batchNumber` and `lotNumber`: `HVRW-0426`, from COA 103618, test date 2026-06-01.

Label Wrangler's main-branch search handler receives this payload, but then calls `rowWithMetrcLabFallback` on its rows. Exact-tag searches enable `preferLabThc`; the independent raw Metrc parser takes the first matching result, not the current released report. This can reintroduce April's THC after a successful, corrected Manifest response. It can also mix different report measurements and issue redundant requests per retail label row.

## Narrow fix

When Manifest label-data succeeds and returns rows, preserve those rows after existing normalization, quantity caps and retail-ID deduplication. Do not re-run raw Metrc lab fallback on them or on the stale search-list row that they replace. This applies to both database-backed searches and direct exact-tag imports without a database hit.

Existing Label Wrangler formatting is unchanged: RoseWater becomes `31.79` THC percent and `36.64` TAC percent, with `317.87` / `366.42` mg/g; date `6/1/26`; lot `HVRW-0426`. Manifest remains full precision. Unknown TAC/lot stays blank instead of being filled from an older source; no THC-as-TAC or new zero default.

The fallback when the authoritative endpoint is unavailable is intentionally unchanged. That fallback has not been made a current-report authority by this patch. Likewise, this patch does not change saved historical print-run snapshots, regenerate labels, or print anything. New Manifest freshness metadata is a separate integration concern; no stale-data UI claim is made here.

## Verification

`node scripts/test-manifest-label-authority.cjs` runs six hermetic cases through the actual transpiled search handler, stubbing only framework/auth/DB/network boundaries:

- Exact-tag DB-backed lookup with stale list/raw results and current Manifest response.
- Product-name DB lookup with the same competing sources.
- Exact-tag direct label-data path without a configured search DB.
- Intentionally missing TAC and lot remain blank.
- Retail-ID rows remain capped to package quantity.
- Existing unavailable-Manifest fallback compatibility.

The pre-fix handler reproduces `28.19` THC instead of `31.79`; the corrected handler passes all six cases and makes only the no-store Manifest lookup for successful imports. All external requests are intercepted, with fixture-only credentials. No live search/Metrc sweep or print job is issued by these tests.

Production Next.js build passed with fixture-only database configuration and no production credentials. Live Label Wrangler deployment and rendered labels are not verified during preparation. After deployment, refresh an import (not a saved historical re-run) and verify the API/preview with the current RoseWater values.
