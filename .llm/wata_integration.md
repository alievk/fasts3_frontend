## WATA Integration Q&A
- Q1: Separate prod/sandbox endpoints based on route (`/payment/wata` prod, `/payment/wata_test` sandbox)? **A:** Yes.
- Q2: Provider name `"wata"` and reuse pending orders per user/plan/provider? **A:** Yes.
- Q3: Use plan price with currency RUB? **A:** Yes (hardcode RUB).
- Q4: Use existing return URL builder for success/fail? **A:** Yes.
- Q5: Include description/orderId in create-link request (plan label + order.id)? **A:** Yes.
- Q6: Read `WATA_ACCESS_TOKEN` from env and send as Bearer? **A:** Yes.
- Q7: Expose payment link via bot same as Yookassa (Telegram message/button)? **A:** Yes.
- Q8: Extra webhook validation (amount/currency/orderId match)? **A:** No extra checks now.

## Plan
1) Add WATA as payment provider in config/types; read `WATA_ACCESS_TOKEN`; default prod base `https://api.wata.pro/api/h2h` (sandbox for test route).
2) Implement `WataClient.createPayment` POST `/links` with amount=plan.price, currency=RUB, description, orderId, success/fail redirects; auth Bearer token; return link id/url.
3) Wire provider switch in `paymentClient`/`telegramBot` to support `"wata"`, reuse pending orders, set `externalId` from link id, send link via Telegram same as Yookassa.
4) Keep existing webhook flow; no extra validation; ensure signature validator already in place.
5) Tests covering WATA client/bot flow; run `npm test`.
## WATA Integration Q&A
- Q1: Separate prod/sandbox endpoints based on route (`/payment/wata` prod, `/payment/wata_test` sandbox)? **A:** Yes.
- Q2: Provider name `"wata"` and reuse pending orders per user/plan/provider? **A:** Yes.
- Q3: Use plan price with currency RUB? **A:** Yes (hardcode RUB).
- Q4: Use existing return URL builder for success/fail? **A:** Yes.
- Q5: Include description/orderId in create-link request (plan label + order.id)? **A:** Yes.
- Q6: Read `WATA_ACCESS_TOKEN` from env and send as Bearer? **A:** Yes.
- Q7: Expose payment link via bot same as Yookassa (Telegram message/button)? **A:** Yes.
- Q8: Extra webhook validation (amount/currency/orderId match)? **A:** No extra checks now.

## Plan
1) Add WATA as payment provider in config/types; read `WATA_ACCESS_TOKEN`; default prod base `https://api.wata.pro/api/h2h` (sandbox for test route).
2) Implement `WataClient.createPayment` POST `/links` with amount=plan.price, currency=RUB, description, orderId, success/fail redirects; auth Bearer token; return link id/url.
3) Wire provider switch in `paymentClient`/`telegramBot` to support `"wata"`, reuse pending orders, set `externalId` from link id, send link via Telegram same as Yookassa.
4) Keep existing webhook flow; no extra validation; ensure signature validator already in place.
5) Tests covering WATA client/bot flow; run `npm test`.
