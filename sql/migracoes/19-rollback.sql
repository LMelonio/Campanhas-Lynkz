-- ============================================================
--  19 — ROLLBACK: tira a consulta do Qlik gravada.
--  A tabela só guarda a última resposta do Qlik de cada mês (dá para buscar
--  de novo a qualquer momento), por isso sai inteira. Nada mais muda.
-- ============================================================
drop table if exists public.comissao_consultas;
drop function if exists public.preparar_comissao_consulta();
