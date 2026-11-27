-- ============================================================
--  Testes da migração 19: consulta do Qlik do mês gravada.
--  Rodados por tests/banco/rodar.sh depois de testes-18.sql, como o app
--  (set role authenticated). Usuários (de testes.sql): 1111 coordenador,
--  2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t19 cascade;
create schema t19;
grant usage on schema t19 to authenticated, anon, service_role;
create function t19.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t19.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t19.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t19 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id = '11111111-1111-1111-1111-111111111111';
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

set role authenticated;

-- ---------- 1. só administrador ----------
select t19.logar('11111111-1111-1111-1111-111111111111');
select t19.falha($$insert into comissao_consultas (mes, dados) values ('2030-01', '{"apuracao":{}}')$$, 'row-level security', 'coordenador não grava consulta');

-- ---------- 2. administrador grava; o banco carimba ----------
select t19.logar('22222222-2222-2222-2222-222222222222');
insert into comissao_consultas (mes, dados) values ('2030-01', '{"apuracao":{"vendas":[]},"contrato":{"linhas":[]},"cod_farelo":"6610","dia_corte":25}');
select t19.ok((select consultado_por = '22222222-2222-2222-2222-222222222222' and consultado_em is not null and conferido_em is null
               from comissao_consultas where mes = '2030-01'), 'administrador grava e o banco carimba quem consultou');
select t19.falha($$insert into comissao_consultas (mes, dados) values ('2030-01', '{}')$$, 'comissao_consultas_mes_unico', 'uma consulta por mês');
select t19.falha($$insert into comissao_consultas (mes, dados) values ('2030-13', '{}')$$, 'comissao_consultas_mes', 'mês inválido é recusado');
select t19.falha($$insert into comissao_consultas (mes, dados) values ('2030-03', '[]')$$, 'comissao_consultas_dados', 'dados precisam ser um objeto');
select t19.falha($$update comissao_consultas set consultado_por = '11111111-1111-1111-1111-111111111111' where mes = '2030-01'$$,
  'permission denied', 'quem consultou não se troca pela API');

-- ---------- 3. conferir e consultar de novo ----------
update comissao_consultas set conferido_em = '2000-01-01' where mes = '2030-01';
select t19.ok((select conferido_por = '22222222-2222-2222-2222-222222222222' and conferido_em > '2020-01-01'
               from comissao_consultas where mes = '2030-01'), 'conferir carimba quem e quando (a data vem do banco)');
update comissao_consultas set dados = '{"apuracao":{"vendas":[{"vendedor":"X","total":1}]},"contrato":{"linhas":[]},"cod_farelo":"6610","dia_corte":25}' where mes = '2030-01';
select t19.ok((select conferido_em is null and conferido_por is null and dados->'apuracao'->'vendas'->0->>'vendedor' = 'X'
               from comissao_consultas where mes = '2030-01'), 'consulta nova zera a conferência');
select t19.falha($$delete from comissao_consultas where mes = '2030-01'$$, 'permission denied', 'ninguém apaga a consulta');

-- ---------- 4. mês fechado trava a consulta ----------
insert into comissao_consultas (mes, dados) values ('2030-02', '{"apuracao":{}}');
insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj)
  values ('2030-02', '{"resultado":{"linhas":[],"totais":{"clt":{"valor_pagar":0},"pj":{"valor_pagar":0},"geral":{"valor_pagar":0}}}}', 0, 0, 0);
select t19.falha($$update comissao_consultas set dados = '{"apuracao":{"novo":1}}' where mes = '2030-02'$$, 'está fechado', 'mês fechado não aceita consulta nova');
select t19.falha($$insert into comissao_consultas (mes, dados) values ('2030-02', '{}')$$, 'está fechado', 'nem cria consulta no mês fechado');
update comissao_fechamentos set status = 'reaberto', motivo_reabertura = 'Teste da 19' where mes = '2030-02';
update comissao_consultas set dados = '{"apuracao":{"novo":1}}' where mes = '2030-02';
select t19.ok((select dados->'apuracao'->>'novo' = '1' from comissao_consultas where mes = '2030-02'), 'mês reaberto aceita consulta nova');

-- ---------- 5. leitura ----------
select t19.logar('11111111-1111-1111-1111-111111111111');
select t19.ok((select count(*) = 0 from comissao_consultas), 'coordenador não lê as consultas');
reset role;
set role anon;
select t19.falha($$select * from comissao_consultas$$, 'permission denied', 'visitante não lê');
reset role;

select t19.logar('');
drop schema t19 cascade;
\echo 'TESTES DA 19 PASSARAM'
