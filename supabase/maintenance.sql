-- Enable the Supabase Cron extension first, then run once in the SQL Editor.
-- Avoid duplicate schedules when this setup is repeated.
select cron.unschedule(jobid) from cron.job where jobname='rumbo-clear-stale-games';
select cron.schedule('rumbo-clear-stale-games','0 * * * *','select public.cleanup_stale_games()');
