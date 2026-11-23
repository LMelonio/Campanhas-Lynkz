-- ============================================================
--  Testes da migração 08: notas fiscais da campanha.
--  Rodados por tests/banco/rodar.sh depois de testes-07.sql.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t8;
grant usage on schema t8 to authenticated, anon, service_role;
create function t8.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t8.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t8.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t8 to authenticated, anon, service_role;

-- um segundo usuário ativo, para provar que ninguém mexe na campanha dos outros
insert into auth.users values ('88888888-8888-8888-8888-888888888888', 'outro.coordenador@lynkz.com.br') on conflict do nothing;

set role authenticated;
select t8.logar('11111111-1111-1111-1111-111111111111');

insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status, compras_periodo, compras_consultado_em)
values ('Cliente das notas', 'Avert', 'Campanha com notas', auth.uid(), 'Pendente', 1600.49, now());

insert into campanha_notas (campanha_id, numero, serie, data_emissao, valor)
select id, n, s, d::date, v from campanhas,
  (values ('209001','1','2026-10-02',300), ('210818','1','2026-10-05',1200.5)) t(n, s, d, v)
 where campanha = 'Campanha com notas';

select t8.ok((select count(*) = 2 from campanha_notas), 'solicitante grava as notas da própria campanha');
select t8.ok((select compras_periodo = 1600.49 and compras_consultado_em is not null from campanhas_app where campanha = 'Campanha com notas'),
  'view campanhas_app entrega o total consultado');
select t8.falha($$insert into campanha_notas (campanha_id, numero, serie, valor)
  select id, '209001', '1', 1 from campanhas where campanha = 'Campanha com notas'$$, 'campanha_notas_unica', 'mesma nota não entra duas vezes');
select t8.falha($$insert into campanha_notas (campanha_id, numero, valor)
  select id, '   ', 1 from campanhas where campanha = 'Campanha com notas'$$, 'campanha_notas_numero_valido', 'nota sem número é recusada');
select t8.falha($$update campanha_notas set valor = 1$$, 'permission denied', 'ninguém altera nota depois de gravada');
select t8.falha($$delete from campanha_notas$$, 'permission denied', 'ninguém apaga nota');

-- outra pessoa não coloca nota na campanha alheia
select t8.logar('88888888-8888-8888-8888-888888888888');
select t8.falha($$insert into campanha_notas (campanha_id, numero, serie, valor)
  select id, '999', '1', 1 from campanhas where campanha = 'Campanha com notas'$$, 'row-level security', 'não grava nota em campanha de outra pessoa');
select t8.ok((select count(*) = 2 from campanha_notas), 'mas qualquer usuário ativo lê as notas (o extrato é compartilhado)');
reset role;

-- visitante sem login não lê
set role anon;
select t8.falha($$select * from campanha_notas$$, 'permission denied', 'visitante não lê notas');
reset role;

-- apagar a campanha leva as notas junto (só pelo SQL Editor)
select t8.ok((select count(*) = 2 from campanha_notas where campanha_id = (select id from campanhas where campanha = 'Campanha com notas')), 'notas ligadas à campanha');

select t8.logar('');
drop schema t8 cascade;
\echo 'TESTES DA 08 PASSARAM'
