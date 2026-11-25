-- ============================================================
--  15 — ROLLBACK: tira a função de excluir campanha.
--  A tabela campanhas_excluidas FICA (é o registro do que já foi excluído).
--  Para apagá-la de vez, depois de salvar o conteúdo:
--    drop table public.campanhas_excluidas;
-- ============================================================
drop function if exists public.excluir_campanha(bigint, text);
