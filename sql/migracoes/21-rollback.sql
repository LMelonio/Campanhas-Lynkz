-- ============================================================
--  21 — ROLLBACK: volta ao Farelo fixo dos Parâmetros.
--  Tira os fornecedores e as exceções (as regras ficam na auditoria) e as
--  colunas do principal. cod_farelo, pct_*_farelo e comissionados.pct_farelo
--  nunca saíram: o app antigo volta a ler deles.
--  Os meses fechados guardam a cópia com as regras usadas (não mudam).
-- ============================================================
drop table if exists public.comissao_excecoes;
drop table if exists public.comissao_fornecedores;
drop function if exists public.preparar_comissao_excecao();
drop function if exists public.preparar_comissao_fornecedor();
alter table public.comissao_parametros drop constraint if exists comissao_parametros_principal;
alter table public.comissao_parametros drop column if exists principal_modo;
alter table public.comissao_parametros drop column if exists pct_outros_clt;
alter table public.comissao_parametros drop column if exists pct_outros_televendas;
alter table public.comissao_parametros drop column if exists pct_outros_pj;
comment on column public.comissionados.pct_farelo is null;
comment on column public.comissao_parametros.cod_farelo is null;
