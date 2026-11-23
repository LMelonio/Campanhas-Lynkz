-- ============================================================
--  08 — ROLLBACK: remove as notas fiscais das campanhas.
--  APAGA a tabela campanha_notas e as colunas compras_*. Exporte antes
--  (Table Editor → campanha_notas → Export CSV) se quiser guardar.
-- ============================================================
begin;
set local lock_timeout = '5s';
drop table if exists public.campanha_notas;
drop view if exists public.campanhas_app;
alter table public.campanhas
  drop column if exists compras_consultado_em,
  drop column if exists compras_periodo;
select public.reaplicar_permissoes_campanhas();
commit;
