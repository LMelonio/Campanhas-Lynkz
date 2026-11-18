-- ============================================================
--  02 — ROLLBACK DA PARTE B
--  Devolve a leitura de todas as colunas da tabela campanhas e remove a
--  view e as funções. Não altera nenhuma linha de dados.
--  O app 1.3.1 percebe que a view sumiu e volta a ler a tabela sozinho.
-- ============================================================
begin;
-- Se alguém estiver usando a tabela e ela não liberar em 5 s, desiste sem
-- aplicar nada (em vez de ficar na fila travando o app de todo mundo).
set local lock_timeout = '5s';

drop view if exists public.campanhas_app;
drop function if exists public.swile_da_campanha(bigint);
drop function if exists public.pode_ver_swile(uuid);

-- Tira as permissões de coluna e devolve a de tabela inteira.
revoke select on public.campanhas from authenticated;
grant  select on public.campanhas to   authenticated;

commit;
