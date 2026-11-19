# V3 stock from the POS (mPOS)

Status: **implemented, not yet run against the real mPOS API** (needs `MPOS_API_KEY` in Vercel).
Tests use a stand-in that returns rows in the shape published in the mPOS swagger
(`https://api_jack.mpos-web.com/swagger/v1/swagger.json`, *JACKSTUDIO API v1*).

Shopify's inventory is not accurate, so website stock comes from the shop POS. The website only
**reads** mPOS; nothing is written to it.

## Where staff use it

Admin → Products → **Inventory** → card **Sync from POS** (editors and owners; viewers do not see it).

1. **Check POS stock** reads mPOS page by page (progress shown) and shows what would change. Nothing
   changes yet.
2. Review the lists:
   - *Will change*: website stock now → after.
   - *On the website, not in mPOS*: selling variants whose SKU is not in the mPOS in-stock list (sold out
     in mPOS, or the SKU is written differently).
   - *In mPOS, not on the website*: in-stock POS items with no website variant.
   - *Matched ignoring spaces and dashes* and *Skipped: could match more than one item*.
3. **Apply to website stock** writes exactly the mPOS stock that was checked (it does not read mPOS
   again). Optional tick box: also set the "not in mPOS" variants to 0.

## How it works

`POST /api/v3/inventory/pos-sync` (`src/pos-stock.mjs`), in two kinds of request:

1. `{"step":"read","page":N,"page_size":500}` reads **one** mPOS page:
   `GET {MPOS_API_URL}/api/stock-warehouse?inStockOnly=true&isActive=true&pageSize=500&page=N` with header
   `X-API-Key: $MPOS_API_KEY` (up to 24 s), and returns the rows in a compact form. The admin page calls it
   page after page until `totalCount` rows are read, so a slow mPOS never meets Vercel's 30-second limit.
   If any 500-row page fails (timeout, cut-off or non-JSON reply), the page reads everything again at
   `page_size` 100. If the pages do not add up to `totalCount`, nothing is changed.
2. `{"dry_run":true,"rows":[…]}` checks, `{"rows":[…]}` applies, `{"zero_missing":true,…}` also zeroes the
   missing SKUs. Up to 4 MB / 100,000 rows. Rows are validated; an editor sending made-up rows can do no more
   than with Adjust stock, and every change is in the inventory history.

- Every mPOS page is logged in the Vercel function log with its status, time and size
  (`pos-sync: mPOS page`). Failures say the HTTP status, content type, length, time and the start of the
  reply (never the key), in the error and in the log.
- Rows are per item **per warehouse**. `qtyAvailable` is summed per `stockCode` over all warehouses
  (or only `MPOS_WAREHOUSE_ID`), rounded down, never below 0.
- `stockCode` = website variant SKU, ignoring case and repeated spaces. If that finds nothing, spaces,
  dashes, dots and slashes are ignored too (`BAD 40107-F` = `BAD 40107 F`), only when exactly one item on
  each side matches.
- Website stock = mPOS available − units held by unpaid website orders (checkout already took those off and
  gives them back if the order expires).
- One SQL statement updates the variants and writes one inventory-history row each (reason *Stocktake*,
  note `POS sync: mPOS available N…`, staff member recorded). Product totals are refreshed. Running it again
  with the same mPOS data changes nothing.
- mPOS is called with no database transaction open.
- No database migration is needed.

## Configuration (Vercel, server-only)

| Variable | Value |
| --- | --- |
| `MPOS_API_KEY` | The mPOS API key (`SalesApi:ApiKey`). Server-only; never in the browser, chat or screenshots. |
| `MPOS_API_URL` | Optional. Default `https://api_jack.mpos-web.com`. |
| `MPOS_WAREHOUSE_ID` | Optional. Only count this warehouse. Empty = all warehouses added together. |

Redeploy after adding them. Without `MPOS_API_KEY` the card shows "POS sync is not set up".

## Known limits

- **Website sales are not sent to mPOS.** A paid website order lowers website stock, but mPOS still has the
  unit until staff record the sale in the POS. A sync before that would add the unit back on the website.
  Record website sales in the POS before syncing, or decide whether paid-but-unshipped website orders should
  also be subtracted.
- `inStockOnly=true` means sold-out POS items are not returned, so "not in mPOS" mixes sold-out items with
  SKUs written differently. Check the list before using the "set to 0" option.
- Manual only. A scheduled sync (for example with the maintenance scheduler) is not set up.
- First page is assumed to be `page=1`. If mPOS counts from 0, the row-count check stops the sync with an
  error instead of syncing part of the stock.
