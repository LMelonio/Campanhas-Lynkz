-- ============================================================
--  09 — MARCA DA CONSULTA NO QLIK (v2.5.0)
--
--  Na Nova campanha, depois de escolher o laboratório, o solicitante pode
--  escolher uma marca dele (ex.: WELLPET dentro da Ouro Fino). O total e as
--  notas passam a ser só daquela marca. campanhas.compras_marca guarda qual
--  foi, para o aprovador saber a que se refere o "comprou no período".
--
--  Só acrescenta uma coluna. Pode rodar duas vezes. Desfazer: 09-rollback.sql.
--  Pré-requisito: a 08. Depois: 09-validacao.sql.
-- ============================================================
alter table public.campanhas add column if not exists compras_marca text;

-- A coluna nova entra no select da view e nos grants do app.
select public.reaplicar_permissoes_campanhas();
