-- ============================================================
--  16 — ROLLBACK: remove o cadastro de comissionados, os parâmetros e a auditoria.
--  ATENÇÃO: apaga os cadastros e as metas lançadas. Volte antes o app para a v3.1
--  (o menu Comissões da v3.2 mostra "Sistema em atualização" sem estas tabelas).
-- ============================================================
drop trigger  if exists ao_auditar_comissionado on public.comissionados;
drop trigger  if exists ao_auditar_comissao_parametros on public.comissao_parametros;
drop trigger  if exists ao_preparar_comissionado on public.comissionados;
drop trigger  if exists ao_preparar_comissao_parametros on public.comissao_parametros;
drop table    if exists public.comissao_auditoria;
drop table    if exists public.comissionados;
drop table    if exists public.comissao_parametros;
drop function if exists public.auditar_comissao();
drop function if exists public.preparar_comissionado();
drop function if exists public.preparar_comissao_parametros();
drop function if exists public.nome_qlik(text);
