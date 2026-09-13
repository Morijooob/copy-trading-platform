-- Production hardening: execution-intent integrity, FK coverage, duplicate-index cleanup, and RLS initplan optimization.

-- Keep the in-flight state used by the deployed execution engine valid until the
-- next engine revision switches the external-call state to `pending`.
alter table public.execution_intents drop constraint if exists execution_intents_status_check;
alter table public.execution_intents add constraint execution_intents_status_check
  check (status = any (array['pending','submitting','submitted','partial','filled','failed','cancelled']::text[]));

-- Cover high-value foreign keys used by execution/wallet paths.
create index if not exists audit_log_user_id_idx on public.audit_log (user_id);
create index if not exists copy_engine_dry_runs_master_id_idx on public.copy_engine_dry_runs (master_id);
create index if not exists deposit_attributions_deposit_address_id_idx on public.deposit_attributions (deposit_address_id);
create index if not exists execution_intents_follower_trade_id_idx on public.execution_intents (follower_trade_id);
create index if not exists execution_intents_master_trade_id_idx on public.execution_intents (master_trade_id);
create index if not exists follower_trades_user_id_idx on public.follower_trades (user_id);
create index if not exists follows_user_id_idx on public.follows (user_id);
create index if not exists platform_controls_updated_by_idx on public.platform_controls (updated_by);
create index if not exists platform_wallet_withdrawal_requests_processed_by_idx on public.platform_wallet_withdrawal_requests (processed_by);

-- Remove exact duplicate wallet-deposit indexes; keep the stricter trimmed-hash uniqueness.
drop index if exists public.wallet_deposit_requests_tx_hash_unique;
drop index if exists public.wallet_deposit_requests_tx_hash_uq;

-- RLS initplan hardening: evaluate auth.uid() once per statement instead of once per row.
drop policy if exists audit_self_select on public.audit_log;
create policy audit_self_select on public.audit_log for select using ((select auth.uid()) = user_id);

drop policy if exists copy_engine_dry_runs_owner_select on public.copy_engine_dry_runs;
create policy copy_engine_dry_runs_owner_select on public.copy_engine_dry_runs for select using (user_id = (select auth.uid()));

drop policy if exists follower_trades_self_select on public.follower_trades;
create policy follower_trades_self_select on public.follower_trades for select using ((select auth.uid()) = user_id);

drop policy if exists follows_self_insert on public.follows;
create policy follows_self_insert on public.follows for insert with check ((select auth.uid()) = user_id);

drop policy if exists follows_self_select on public.follows;
create policy follows_self_select on public.follows for select using ((select auth.uid()) = user_id);

drop policy if exists ledger_self_select on public.ledger_entries;
create policy ledger_self_select on public.ledger_entries for select using ((select auth.uid()) = user_id);

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select using ((select auth.uid()) = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists trades_self_select on public.trades;
create policy trades_self_select on public.trades for select using (exists (select 1 from public.follows f where f.master_id = trades.master_id and f.user_id = (select auth.uid())));

drop policy if exists user_deposit_addresses_select_own on public.user_deposit_addresses;
create policy user_deposit_addresses_select_own on public.user_deposit_addresses for select using (user_id = (select auth.uid()) and status = 'active');

drop policy if exists wallet_accounts_self_select on public.wallet_accounts;
create policy wallet_accounts_self_select on public.wallet_accounts for select using ((select auth.uid()) = user_id);
