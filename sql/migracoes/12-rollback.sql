-- ============================================================
--  12 — ROLLBACK: remove definir_perfil e o limite de balconistas.
--  Nenhum dado é apagado. Volte antes o app para a v2.7 (a tela Usuários
--  da v2.8 deixa de salvar sem a função).
-- ============================================================
drop trigger  if exists ao_limitar_balconistas_empresa on public.balconistas;
drop function if exists public.limitar_balconistas_empresa();
drop function if exists public.definir_perfil(uuid, text, boolean, text);
