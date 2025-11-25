# Payments Schema and Flow

## Tables
```sql
CREATE TABLE users (
  telegram_id TEXT PRIMARY KEY,
  locale TEXT,
  subscription_expires_at TEXT, -- ISO date; null means no subscription
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,           -- e.g. "3 months"
  price REAL NOT NULL,          -- e.g. 990.00
  duration_days INTEGER NOT NULL,
  display INTEGER NOT NULL DEFAULT 1 -- 1=visible in bot, 0=hidden/test
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(telegram_id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  amount REAL NOT NULL,         -- captured price at purchase time
  provider TEXT NOT NULL,       -- e.g. 'yookassa'
  external_id TEXT,             -- provider payment id
  status TEXT NOT NULL,         -- 'pending' | 'paid' | 'canceled'
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX orders_user_id_idx ON orders(user_id);
CREATE INDEX orders_status_idx ON orders(status);
```

## Happy Path (Yookassa)
1. Bot shows visible plans (`display=1`), user taps a “buy …” button.
2. Bot creates an `orders` row with `status='pending'`, fills `plan_id`, `user_id`, `amount`, sets `provider='yookassa'`.
3. Bot creates a Yookassa payment request with `metadata.internal_order_id = orders.id`; stores the Yookassa `payment.id` into `orders.external_id`.
4. User pays on Yookassa.
5. Webhook `/payment/yookassa` receives `payment.succeeded`:
   - Reads `metadata.internal_order_id`, loads the order and its plan.
   - If already `paid`, no-op.
   - Marks the order `paid`, sets `paid_at`.
   - Extends `users.subscription_expires_at` by `plan.duration_days`; if the current value is in the past/null, start from now.
   - Sends a Telegram message: “Payment received, your subscription expires at …”.

## Test Flow
Endpoint `/payment/yookassa_test` behaves the same as above. The message prefix is `[test] payment received, your subscription expires at ...`.

## Assumptions
- Plans are managed externally; this service only reads them (uses `display` for bot visibility).
- Orders are created by the Telegram bot when the user presses a buy button.
- Only Yookassa is handled here; only `payment.succeeded` events are processed.
- Subscription length comes solely from `plans.duration_days`; no proration or partial-day handling.
- Telegram notifications are fire-and-forget (failure does not block DB updates).
