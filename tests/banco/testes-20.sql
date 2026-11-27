-- ============================================================
--  Testes da migração 20: o banco confere o total do fechamento.
--  Rodados por tests/banco/rodar.sh depois de testes-19.sql, como o app
--  (set role authenticated). Usuário (de testes.sql): 2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t20 cascade;
create schema t20;
grant usage on schema t20 to authenticated, anon, service_role;
create function t20.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t20.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t20.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
-- dados com as linhas da apuração: CLT 100,10 + 0,01 e PJ 50,05.
create function t20.dados(extra numeric default 0) returns jsonb language sql as $$
  select jsonb_build_object('resultado', jsonb_build_object('linhas', jsonb_build_array(
    jsonb_build_object('regime', 'CLT', 'valor_pagar', 100.10 + extra),
    jsonb_build_object('regime', 'TELEVENDAS', 'valor_pagar', 0.01),
    jsonb_build_object('regime', 'PJ', 'valor_pagar', 50.05))))
$$;
grant execute on all functions in schema t20 to authenticated, anon, service_role;

update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t20.logar('22222222-2222-2222-2222-222222222222');

select t20.falha($$insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj) values ('2031-01', t20.dados(), 150.17, 100.12, 50.05)$$,
  'não confere', 'total CLT um centavo acima é recusado');
select t20.falha($$insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj) values ('2031-01', t20.dados(), 150.16, 100.11, 50.04)$$,
  'não confere', 'total PJ diferente é recusado');
select t20.falha($$insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj) values ('2031-01', t20.dados(), 999, 100.11, 50.05)$$,
  'não confere', 'total geral que não é CLT + PJ é recusado');
select t20.falha($$insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj) values ('2031-01', '{"resultado":{}}', 1, 1, 0)$$,
  'não confere', 'sem linhas, total tem de ser zero');
insert into comissao_fechamentos (mes, dados, total, total_clt, total_pj) values ('2031-01', t20.dados(), 150.16, 100.11, 50.05);
select t20.ok(exists (select 1 from comissao_fechamentos where mes = '2031-01' and status = 'fechado'), 'total que confere fecha (Televendas conta no CLT)');

update comissao_fechamentos set status = 'reaberto', motivo_reabertura = 'Teste da 20' where mes = '2031-01';
select t20.ok(exists (select 1 from comissao_fechamentos where mes = '2031-01' and status = 'reaberto'), 'reabrir não confere nada');
select t20.falha($$update comissao_fechamentos set status = 'fechado', dados = t20.dados(10), total = 150.16, total_clt = 100.11 where mes = '2031-01'$$,
  'não confere', 'fechar de novo com o total velho é recusado');
update comissao_fechamentos set status = 'fechado', dados = t20.dados(10), total = 160.16, total_clt = 110.11 where mes = '2031-01';
select t20.ok(exists (select 1 from comissao_fechamentos where mes = '2031-01' and status = 'fechado' and total = 160.16), 'fechar de novo com o total certo passa');
reset role;

select t20.logar('');
drop schema t20 cascade;
\echo 'TESTES DA 20 PASSARAM'
