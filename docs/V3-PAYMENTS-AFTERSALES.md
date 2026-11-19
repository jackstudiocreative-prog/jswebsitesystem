# V3 payments, fulfilment and after-sales (batch 5)

Status: **implemented, pending external acceptance** (eGHL Sandbox, scheduler). Nothing here has run
against real eGHL or moved real money.

## eGHL protocol check

Checked against *eGHL Internet Payment Gateway Merchant Integration Guide 2.8n* (public copy; sections
2.2–2.4, 2.9, 2.13.1.1–2.13.1.3, 3.2–3.4). Confirm with this merchant's current document in Sandbox.

| Message | Hash (SHA-256, hex) | In code |
| --- | --- | --- |
| Payment request | Password + ServiceID + PaymentID + MerchantReturnURL + MerchantApprovalURL + MerchantUnApprovalURL + MerchantCallBackURL + Amount + CurrencyCode + CustIP + PageTimeout + CardNo + Token (unsent fields empty) | `requestHash` — we do not send ApprovalURL/UnApprovalURL/CardNo/Token, so they are empty and the result is identical |
| Payment response | HashValue2 = Password + TxnID + ServiceID + PaymentID + TxnStatus + Amount + CurrencyCode + AuthCode + OrderNumber + Param6 + Param7 (HashValue without the last three) | `responseHash2` / `responseHash`, HashValue2 preferred |
| QUERY / REFUND request | Password + ServiceID + PaymentID + Amount + CurrencyCode | `queryHash` |

- Callback must answer `OK`; eGHL resends up to 3 times otherwise. Rejected messages answer `REJECTED`.
- PaymentID is unique per attempt (`<order>P<n>`, max 20 chars); OrderNumber repeats across attempts.
- PageTimeout 900 s, shorter than the 30-minute stock hold.
- TxnStatus: 0 success, 1 failed, 2 pending. QUERY also: 10 refunded, 9 reversed, 15/16 auth/captured,
  31 reversal pending, -1 not found, -2 system error. Only 0/1/2 change a payment; others are logged.

## Payment outcomes (all tested with signed messages)

| Case | Result |
| --- | --- |
| Success callback / return / QUERY | Payment succeeded, order paid once, one email, stock taken once at checkout |
| Repeated success | Logged `duplicate`; nothing changes |
| Failure (incl. customer cancel) then success | Failed, then paid |
| Failure after success | Ignored (`duplicate`) — a success is never undone |
| Pending (FPX) | Order kept up to 24 h; QUERY asked again every 15 min |
| Amount/currency/order mismatch | Rejected, order flagged "Needs attention" |
| Bad or missing signature, unknown PaymentID | Rejected, logged |
| Paid after expiry/cancel | Stock taken again if available, otherwise flagged; discount use counted again (capped at its limit) |
| Second successful attempt for a paid order | Flagged: refund one payment |
| Missed callback | Maintenance asks eGHL (QUERY) **before** releasing the stock; paid if eGHL confirms |

## Refunds: two separate actions

1. **Record a refund made in the eGHL portal** — staff refund in the merchant portal, then record amount
   and reference here. No money moves from this system. Ledger method `recorded`.
2. **Refund through eGHL** — this system sends REFUND to eGHL. Off for real eGHL unless
   `EGHL_REFUND_API_ENABLED=true`; always on for the staging mock (no money). The request is saved and
   committed *before* eGHL is called; the money enters the ledger (method `gateway`) only when eGHL
   confirms. Timeout or unverifiable answer → "unclear": the amount is blocked, nothing is retried
   automatically, and staff settle it after checking the portal ("eGHL refunded it" with reference /
   "eGHL did not refund"). eGHL's REFUND usually covers card payments only; FPX refunds are made in the
   portal and recorded (option 1).

Both: never more than the amount paid minus refunds (including unclear ones); restock at most once
(only the units the order still holds); refund email only for refunds that happened.

## Fulfilment and returns

- Fulfil with carrier (list or free text), tracking number and optional https tracking link; shipping
  email includes them; the customer's order page shows them. Tracking can be corrected later (no new
  email).
- Return: Start return → Items received (optionally back to stock) → Close. Money is a separate refund.
- Unpaid orders can be cancelled (stock and discount use released). Paid orders are refunded, not
  cancelled.

## Records and permissions

- `order_activity` (append-only): every staff action and system event (paid, expired, payment checks,
  refunds, returns, tracking changes), shown on the order. `audit_events` stays write-only for the API.
- `payment_events` keeps only allow-listed gateway fields (no card data, tokens or customer PII).
- Viewers can read orders but every action is refused by the server (403).
- No eGHL password, API key or secret is logged or returned; the order screen gets only
  `{provider, can_query, refunds_enabled, refunds_disabled_reason}`.

## Shipping (server-side, unchanged rules, now with boundary tests)

General profile RM5, free from RM49.00 (RM48.99 pays); luggage RM26.90 for 1–50 kg (50 kg included);
mixed bags pay each profile on its own items. The free-shipping threshold uses the bag subtotal
**before** discount codes. Shopify uses the subtotal *after* discounts — open decision for Jack Studio.

## Scheduler (needed for automatic expiry, payment checks and email)

`POST https://<staging-host>/api/v3/maintenance/expire-orders` with header
`Authorization: Bearer <MAINTENANCE_SECRET>`, every 5 minutes (each run: up to 3 QUERY checks, 50
expiries, 20 emails; `more: true` means run again soon). Use a managed scheduler with retries
(e.g. cron-job.org, EasyCron, Upstash QStash); keep the secret only in the scheduler and Vercel. If
Vercel Deployment Protection covers the staging URL, add a Protection Bypass for Automation secret as
the `x-vercel-protection-bypass` header. Monitor: alert if the response is not 200 or `due` keeps
growing.

## Configuration

| Variable | Purpose |
| --- | --- |
| `EGHL_SERVICE_ID`, `EGHL_PASSWORD`, `EGHL_PAYMENT_URL` | Existing; Sandbox first |
| `EGHL_API_URL` (optional) | Server-to-server QUERY/REFUND URL if eGHL gives a different one; defaults to `EGHL_PAYMENT_URL` |
| `EGHL_REFUND_API_ENABLED=true` (optional) | Allow "Refund through eGHL" for real eGHL. Leave unset until Sandbox refunds are accepted |
| `MAINTENANCE_SECRET` | Scheduler token (≥32 random characters) |

## Acceptance checklist (Sandbox)

1. Card success, card decline, customer cancel on the eGHL page, FPX pending → success.
2. Close the browser after paying (callback only); block the callback once (QUERY recovers it).
3. Amount tampering rejected; duplicate callbacks harmless.
4. QUERY for an unpaid, a paid and an unknown PaymentID.
5. REFUND partial and full (card) with `EGHL_REFUND_API_ENABLED=true`; compare with the portal.
6. Scheduler: unpaid order released after 30 min; outage and recovery.

Migration: `v3/migrations/013_payments_aftersales.sql` (additive; rollback in its header). Code works
before 013: payments and recorded refunds as before; payment checks, gateway refunds, tracking edits
and returns ask for the migration.
