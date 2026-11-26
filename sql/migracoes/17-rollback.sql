-- ============================================================
--  17 — ROLLBACK: remove premiações, ajustes, dados do PJ por mês (metas, realizado, NF)
--  e o histórico das comissões. ATENÇÃO: apaga o que foi lançado e os meses fechados.
--  Volte antes o app para a v3.2.
-- ============================================================
drop table    if exists public.comissao_fechamentos;
drop table    if exists public.comissao_premiacoes;
drop table    if exists public.comissao_ajustes;
drop table    if exists public.comissao_mes_pj;
drop function if exists public.preparar_comissao_mes();
drop function if exists public.preparar_comissao_fechamento();
drop function if exists public.auditar_comissao_fechamento();
