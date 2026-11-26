-- ============================================================
--  Testes da migração 17: premiações e dados do PJ no mês (metas, realizado, NF).
--  Rodados por tests/banco/rodar.sh depois de testes-16.sql, como usuário comum
--  (set role authenticated), igual ao app. Usam os comissionados criados na 16.
--  Usuários (de testes.sql): 1111 coordenador, 2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t17 cascade;
create schema t17;
grant usage on schema t17 to authenticated, anon, service_role;
create function t17.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t17.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t17.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t17 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id = '11111111-1111-1111-1111-111111111111';
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';
-- Um PJ e um CLT de referência (a 16 deixa a Seldiana PJ; garante um CLT ativo).
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik)
select 'Clt 17', 'CLT', 2.5, 1, array['CLT DEZESSETE'] where not exists (select 1 from comissionados where nome = 'Clt 17');
create temp table t17_ids as
  select (select id from comissionados where nome = 'Seldiana') pj, (select id from comissionados where nome = 'Clt 17') clt;
grant select on t17_ids to authenticated, anon;

set role authenticated;
select t17.logar('22222222-2222-2222-2222-222222222222');

-- ---------- 1. premiações ----------
insert into comissao_premiacoes (mes, comissionado_id, descricao, valor) select '2026-10', clt, '  Campanha   Ouro Fino ', 300 from t17_ids;
select t17.ok((select descricao = 'Campanha Ouro Fino' and criado_por = '22222222-2222-2222-2222-222222222222' and ativo
                 from comissao_premiacoes limit 1), 'premiação com descrição limpa e quem lançou');
select t17.falha($$insert into comissao_premiacoes (mes, comissionado_id, descricao, valor) select '2026-13', clt, 'X campanha', 10 from t17_ids$$,
  'comissao_premiacoes_mes', 'mês inválido é recusado');
select t17.falha($$insert into comissao_premiacoes (mes, comissionado_id, descricao, valor) select '2026-10', clt, 'Zero', 0 from t17_ids$$,
  'comissao_premiacoes_valor', 'premiação zerada é recusada');
update comissao_premiacoes set ativo = false, mes = '2025-01' where descricao = 'Campanha Ouro Fino';
select t17.ok((select not ativo and mes = '2026-10' and atualizado_em is not null from comissao_premiacoes where descricao = 'Campanha Ouro Fino'),
  'remover desativa; o mês não muda depois de lançado');
select t17.falha($$delete from comissao_premiacoes$$, 'permission denied', 'ninguém apaga premiação');

-- ---------- 2. dados do PJ no mês ----------
insert into comissao_mes_pj (mes, comissionado_id, meta_faturamento, meta_positivacao, nf_numero) select '2026-10', pj, 159704.82, 74, ' 18 ' from t17_ids;
select t17.ok((select nf_numero = '18' and atualizado_por = '22222222-2222-2222-2222-222222222222' from comissao_mes_pj), 'metas e NF gravadas');
select t17.falha($$insert into comissao_mes_pj (mes, comissionado_id, meta_faturamento) select '2026-10', pj, 1 from t17_ids$$,
  'comissao_mes_pj_unico', 'uma linha por PJ e mês');
select t17.falha($$insert into comissao_mes_pj (mes, comissionado_id, meta_faturamento) select '2026-10', clt, 1 from t17_ids$$,
  'só para representantes PJ', 'CLT não tem contrato nem NF');
select t17.falha($$update comissao_mes_pj set realizado_faturamento = 170000$$, 'comissao_mes_pj_realizado', 'realizado informado exige motivo');
update comissao_mes_pj set realizado_faturamento = 170987.71, realizado_motivo = 'Qlik sem a nota 123';
select t17.ok((select realizado_faturamento = 170987.71 from comissao_mes_pj), 'realizado informado com motivo');
update comissao_mes_pj set realizado_faturamento = null, realizado_positivacao = null, realizado_motivo = 'sobra';
select t17.ok((select realizado_motivo is null from comissao_mes_pj), 'sem realizado informado, o motivo sai');
select t17.falha($$update comissao_mes_pj set nf_numero = 'NF 18; drop'$$, 'comissao_mes_pj_nf', 'número da NF só com letras, números e . / -');
select t17.ok((select count(*) >= 4 from comissao_auditoria where tabela in ('comissao_premiacoes', 'comissao_mes_pj')), 'auditoria registra as mudanças');

-- ---------- 3. ajustes e valor da NF ----------
insert into comissao_ajustes (mes, comissionado_id, motivo, valor) select '2026-10', pj, '  Desconto   de adiantamento ', -150 from t17_ids;
select t17.ok((select motivo = 'Desconto de adiantamento' and valor = -150 from comissao_ajustes), 'ajuste negativo com motivo limpo');
select t17.falha($$insert into comissao_ajustes (mes, comissionado_id, motivo, valor) select '2026-10', pj, 'Zero', 0 from t17_ids$$,
  'comissao_ajustes_valor', 'ajuste zerado é recusado');
select t17.falha($$insert into comissao_ajustes (mes, comissionado_id, motivo, valor) select '2026-10', pj, 'x', 10 from t17_ids$$,
  'comissao_ajustes_motivo', 'ajuste sem motivo é recusado');
update comissao_mes_pj set nf_valor = 5658.89;
select t17.falha($$update comissao_mes_pj set nf_valor = 0$$, 'comissao_mes_pj_nf_valor', 'valor da NF acima de zero');

-- ---------- 4. histórico: fechar trava o mês; reabrir pede motivo ----------
insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj, fechado_em) values ('2026-10', '{"resultado": {}}', 26192.96, 11804.58, 14388.38, '2020-01-01');
select t17.ok((select status = 'fechado' and fechado_em > '2026-01-01' and fechado_por = '22222222-2222-2222-2222-222222222222' from comissao_fechamentos),
  'fechar grava quem e quando (pelo banco)');
select t17.falha($$insert into comissao_premiacoes (mes, comissionado_id, descricao, valor) select '2026-10', clt, 'Depois', 10 from t17_ids$$,
  'está fechado', 'mês fechado não aceita premiação nova');
select t17.falha($$update comissao_mes_pj set nf_numero = '19'$$, 'está fechado', 'mês fechado não muda a NF');
select t17.falha($$update comissao_ajustes set ativo = false$$, 'está fechado', 'mês fechado não remove ajuste');
insert into comissao_premiacoes (mes, comissionado_id, descricao, valor) select '2026-11', clt, 'Outro mês', 10 from t17_ids;
select t17.ok(true, 'outro mês continua aberto');
select t17.falha($$update comissao_fechamentos set total = 1$$, 'já está fechado', 'fechado não fecha de novo sem reabrir');
select t17.falha($$update comissao_fechamentos set status = 'reaberto'$$, 'comissao_fechamentos_motivo', 'reabrir exige motivo');
update comissao_fechamentos set status = 'reaberto', motivo_reabertura = 'NF do Alex errada', dados = '{}', total = 1;
select t17.ok((select status = 'reaberto' and total = 26192.96 and dados ? 'resultado' and reaberto_por is not null from comissao_fechamentos),
  'reabrir mantém a cópia e grava quem reabriu');
update comissao_mes_pj set nf_numero = '19';
update comissao_fechamentos set status = 'fechado', dados = '{"resultado": {"novo": true}}', total = 26000;
select t17.ok((select status = 'fechado' and total = 26000 and dados->'resultado' ? 'novo' and motivo_reabertura = 'NF do Alex errada' from comissao_fechamentos),
  'fechar de novo troca a cópia e guarda o motivo da última reabertura');
select t17.ok((select count(*) = 3 from comissao_auditoria where tabela = 'comissao_fechamentos'), 'fechar, reabrir e fechar ficam na auditoria');
select t17.falha($$delete from comissao_fechamentos$$, 'permission denied', 'ninguém apaga o histórico');

-- ---------- 5. usuário comum não vê nem grava ----------
select t17.logar('11111111-1111-1111-1111-111111111111');
select t17.ok((select count(*) = 0 from comissao_premiacoes) and (select count(*) = 0 from comissao_mes_pj)
  and (select count(*) = 0 from comissao_ajustes) and (select count(*) = 0 from comissao_fechamentos), 'usuário comum não vê nada');
select t17.falha($$insert into comissao_premiacoes (mes, comissionado_id, descricao, valor) select '2026-10', clt, 'Hack x', 999 from t17_ids$$,
  'row-level security', 'usuário comum não lança premiação');
update comissao_mes_pj set realizado_motivo = 'hack';
reset role;
select t17.ok((select nf_numero = '19' from comissao_mes_pj), 'update do usuário comum não altera nada');

set role anon;
select t17.falha($$select * from comissao_mes_pj$$, 'permission denied', 'visitante não lê os dados do PJ');
reset role;

drop schema t17 cascade;
\echo 'TESTES DA 17 PASSARAM'
