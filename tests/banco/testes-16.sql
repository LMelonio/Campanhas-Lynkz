-- ============================================================
--  Testes da migração 16: comissionados, parâmetros e auditoria.
--  Rodados por tests/banco/rodar.sh depois de testes-15.sql, como usuário comum
--  (set role authenticated), igual ao app.
--  Usuários (de testes.sql): 1111 coordenador, 2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t16 cascade;
create schema t16;
grant usage on schema t16 to authenticated, anon, service_role;
create function t16.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t16.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t16.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t16 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id = '11111111-1111-1111-1111-111111111111';
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

set role authenticated;

-- ---------- 1. administrador cadastra ----------
select t16.logar('22222222-2222-2222-2222-222222222222');
insert into comissionados (nome, regime, equipe, pct_principal, pct_farelo, nomes_qlik, acordo_minimo, acordo_inicio, acordo_fim)
values ('  Ivaldo   Machado ', 'CLT', 'Equipe 03', 2.5, 1, array[' ivaldo  aquino dos santos machado ', 'IVALDO AQUINO DOS SANTOS MACHADO'], 3500, '2026-10-01', '2027-03-31');
select t16.ok((select nome = 'Ivaldo Machado' and nomes_qlik = array['IVALDO AQUINO DOS SANTOS MACHADO'] and criado_por = '22222222-2222-2222-2222-222222222222'
               and meta_atualizada_em is null from comissionados where regime = 'CLT'),
  'nome limpo, nomes do Qlik em maiúsculas e sem repetir, criado_por do banco');
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, meta_faturamento, meta_positivacao, pj_razao_social, pj_documento, pj_pix, pj_banco)
values ('Seldiana', 'PJ', 3, 2, array['SELDIANA ARAUJO BARROS'], 159704.82, 74, 'DOMINGOS DAS MERCES ARAUJO JUNIOR', '60.736.160/0001-25', '60.736.160/0001-25', 'CEF');
select t16.ok((select pj_documento = '60736160000125' and meta_atualizada_em is not null from comissionados where nome = 'Seldiana'),
  'documento só com números e data da meta gravada no cadastro');

-- ---------- 2. regras ----------
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Outro', 'CLT', 2.5, 1, array['seldiana araujo  barros'])$$,
  'já está ligado a Seldiana', 'nome do Qlik repetido em outro ativo é recusado');
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, acordo_minimo, acordo_inicio) values ('Pj', 'PJ', 5, 2, array['PJ X'], 1000, '2026-10-01')$$,
  'comissionados_acordo_valido', 'acordo mínimo em PJ é recusado');
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, acordo_minimo) values ('Clt', 'CLT', 2.5, 1, array['CLT X'], 1000)$$,
  'comissionados_acordo_valido', 'acordo sem início da vigência é recusado');
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Sem nome', 'CLT', 2.5, 1, array['  '])$$,
  'comissionados_nomes_qlik_valido', 'sem nome do Qlik é recusado');
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Pct', 'CLT', 25, 1, array['PCT'])$$,
  'comissionados_pct_valido', 'percentual acima de 20 é recusado');
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Reg', 'ESTAGIO', 2, 1, array['REG'])$$,
  'comissionados_regime_valido', 'regime desconhecido é recusado');
select t16.falha($$delete from comissionados where nome = 'Seldiana'$$, 'permission denied', 'ninguém apaga comissionado (desativa)');

-- ---------- 3. data da meta só muda quando a meta muda ----------
update comissionados set meta_atualizada_em = '2026-01-01' where nome = 'Seldiana';
select t16.ok((select meta_atualizada_em > '2026-01-02' from comissionados where nome = 'Seldiana'), 'data da meta não é gravada pela API');
create temp table t16_antes as select meta_atualizada_em from comissionados where nome = 'Seldiana';
select pg_sleep(0.01);
update comissionados set pj_banco = 'CAIXA' where nome = 'Seldiana';
select t16.ok((select c.meta_atualizada_em = a.meta_atualizada_em and c.atualizado_em is not null from comissionados c, t16_antes a where c.nome = 'Seldiana'),
  'mudar outro campo não mexe na data da meta');
update comissionados set meta_positivacao = 75 where nome = 'Seldiana';
select t16.ok((select c.meta_atualizada_em > a.meta_atualizada_em from comissionados c, t16_antes a where c.nome = 'Seldiana'),
  'mudar a meta atualiza a data da meta');

-- ---------- 4. desativado libera o nome do Qlik ----------
update comissionados set ativo = false where nome = 'Ivaldo Machado';
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Ivaldo novo', 'CLT', 2.5, 1, array['IVALDO AQUINO DOS SANTOS MACHADO']);
select t16.ok(true, 'nome do Qlik de quem foi desativado pode ir para outro cadastro');
select t16.falha($$update comissionados set ativo = true where nome = 'Ivaldo Machado'$$, 'já está ligado', 'reativar com nome já usado é recusado');
select t16.ok((select acordo_inicio is null from comissionados where nome = 'Ivaldo novo'), 'sem acordo, vigência fica vazia');

-- ---------- 5. parâmetros ----------
select t16.ok((select cod_farelo = '6610' and dia_corte = 25 and pct_pj_principal = 5 and contrato_pct_faixa2 = 1.2 from comissao_parametros),
  'parâmetros de fábrica');
update comissao_parametros set nomes_ignorados = array['terrazoo', ' TERRAZOO ', ''];
select t16.ok((select nomes_ignorados = array['TERRAZOO'] and atualizado_por = '22222222-2222-2222-2222-222222222222' from comissao_parametros),
  'nomes ignorados limpos e quem alterou gravado');
select t16.falha($$insert into comissao_parametros (id) values (2)$$, 'permission denied', 'não cria segunda linha de parâmetros');
select t16.falha($$update comissao_parametros set cod_farelo = '66a'$$, 'comissao_parametros_farelo', 'código do Farelo só com números');
select t16.falha($$update comissao_parametros set dia_corte = 31$$, 'comissao_parametros_corte', 'dia de corte até 28');

-- ---------- 6. auditoria ----------
select t16.ok((select count(*) >= 3 from comissao_auditoria where tabela = 'comissionados'
                and registro_id = (select id from comissionados where nome = 'Seldiana')), 'cada alteração do cadastro fica na auditoria');
select t16.ok((select mudou ? 'pj_banco' and not (mudou ? 'atualizado_em') from comissao_auditoria
                where tabela = 'comissionados' and acao = 'update' and mudou ? 'pj_banco' limit 1), 'auditoria guarda só o que mudou');
select t16.falha($$insert into comissao_auditoria (tabela, registro_id, acao, mudou) values ('x', 1, 'x', '{}')$$, 'permission denied', 'ninguém escreve na auditoria pela API');

-- ---------- 7. usuário comum e desativado não veem nada ----------
select t16.logar('11111111-1111-1111-1111-111111111111');
select t16.ok((select count(*) = 0 from comissionados), 'usuário comum não vê comissionados');
select t16.ok((select count(*) = 0 from comissao_parametros), 'usuário comum não vê parâmetros');
select t16.ok((select count(*) = 0 from comissao_auditoria), 'usuário comum não vê a auditoria');
select t16.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Hack', 'CLT', 20, 20, array['HACK'])$$,
  'row-level security', 'usuário comum não cadastra');
update comissionados set pct_principal = 20;
update comissao_parametros set pct_clt_principal = 20;
reset role;
select t16.ok((select max(pct_principal) < 20 from comissionados) and (select pct_clt_principal = 2.5 from comissao_parametros),
  'update do usuário comum não altera nada');
update perfis set ativo = false where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t16.logar('22222222-2222-2222-2222-222222222222');
select t16.ok((select count(*) = 0 from comissionados), 'administrador desativado não vê comissionados');
reset role;
update perfis set ativo = true where id = '22222222-2222-2222-2222-222222222222';

set role anon;
select t16.falha($$select * from comissionados$$, 'permission denied', 'visitante não lê comissionados');
select t16.falha($$select * from comissao_parametros$$, 'permission denied', 'visitante não lê parâmetros');
reset role;

drop schema t16 cascade;
\echo 'TESTES DA 16 PASSARAM'
