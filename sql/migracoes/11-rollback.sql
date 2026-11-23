-- ============================================================
--  11 — ROLLBACK: remove a função enviar_campanha.
--  Nenhum dado é apagado. O app da v2.7 deixa de enviar campanhas;
--  volte antes para a v2.6 (que grava em três chamadas).
-- ============================================================
drop function if exists public.enviar_campanha(jsonb, jsonb, jsonb);
