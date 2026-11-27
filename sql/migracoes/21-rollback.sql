-- ============================================================
--  21 — ROLLBACK: volta ao Farelo fixo dos Parâmetros.
--  Tira os fornecedores e as exceções (as regras ficam na auditoria) e as
--  colunas do principal. cod_farelo, pct_*_farelo e comissionados.pct_farelo
--  nunca saíram: o app antigo volta a ler deles.
--  Os meses fechados guardam a cópia com as regras usadas (não mudam).
--  Antes de apagar, os % do Farelo (o secundário com o código cod_farelo)
--  voltam para os Parâmetros: o app antigo usa os % de hoje, não os de antes
--  da 21. (O % de cada pessoa já está em comissionados.pct_farelo.)
-- ============================================================
do $$
begin
  if to_regclass('public.comissao_fornecedores') is not null then
    update public.comissao_parametros p set
      pct_clt_farelo        = f.pct_clt,
      pct_televendas_farelo = f.pct_televendas,
      pct_pj_farelo         = f.pct_pj
    from public.comissao_fornecedores f
    where f.codigo = p.cod_farelo and f.grupo = 'secundario';
  end if;
end $$;

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
