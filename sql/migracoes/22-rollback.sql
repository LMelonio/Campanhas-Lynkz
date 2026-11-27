-- ============================================================
--  22 — ROLLBACK: o banco volta a aceitar PJ sem os dados de pagamento.
--  Os cadastros não mudam.
-- ============================================================
drop trigger if exists ao_validar_pj_completo on public.comissionados;
drop function if exists public.validar_pj_completo();
