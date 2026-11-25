-- The scheduler half of §6.3 C — run this ONCE against the *hosted* Supabase
-- project (SQL editor or psql), after filling in the two placeholders.
--
-- This is a script, not a migration, on purpose: it embeds the deployment URL
-- and the CRON_SECRET, which are environment-specific and must never be
-- committed. Everything the schedule calls is code (migration …0011 plus
-- /api/push/send), so this file is the only piece that differs per
-- environment.
--
-- Cadence: every 20 seconds, matching ESCALATION_INTERVAL_S. pg_cron supports
-- sub-minute schedules since 1.5 (hosted Supabase ships newer). If the
-- schedule ever has to fall back to per-minute (an external cron service,
-- say), nothing breaks — the endpoint is idempotent per (alarm, minute,
-- attempt) — the nag just chimes once a minute instead of three times.
--
-- The 8s timeout is generous: the endpoint does one read and a handful of
-- pushes, no sleeping. A timed-out request is not retried by pg_net; the next
-- tick, 20 seconds later, is the retry.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'meos-send-alarms',
  '20 seconds',
  $$
  select net.http_post(
    url := 'https://YOUR-DEPLOYMENT.vercel.app/api/push/send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR-CRON-SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);

-- To pause delivery:   select cron.unschedule('meos-send-alarms');
-- To inspect runs:     select * from cron.job_run_details order by start_time desc limit 20;
-- To watch requests:   select * from net._http_response order by created desc limit 20;
