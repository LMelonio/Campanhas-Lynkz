-- ============================================================
--  20 — ROLLBACK: o banco volta a aceitar os totais do fechamento como vêm do app.
--  O histórico não muda.
-- ============================================================
drop trigger if exists ao_validar_total_fechamento on public.comissao_fechamentos;
drop function if exists public.validar_total_fechamento();
