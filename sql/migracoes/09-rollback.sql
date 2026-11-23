-- ============================================================
--  09 — ROLLBACK: remove campanhas.compras_marca (a marca escolhida na consulta).
--  As campanhas e as notas continuam; só some a informação de qual marca foi consultada.
-- ============================================================
begin;
set local lock_timeout = '5s';
drop view if exists public.campanhas_app;
alter table public.campanhas drop column if exists compras_marca;
select public.reaplicar_permissoes_campanhas();
commit;
