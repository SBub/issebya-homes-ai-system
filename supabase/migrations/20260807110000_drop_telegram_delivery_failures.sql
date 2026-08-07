-- telegram_delivery_failures (created by
-- 20260720130000_create_telegram_delivery_failures.sql) is dropped —
-- delivery-failure monitoring moves to OTel instead of a DB table. Its sole
-- reader/writer, apps/telegram-router/src/lib/telegram/delivery-failures.ts,
-- has been deleted.
drop table public.telegram_delivery_failures;
