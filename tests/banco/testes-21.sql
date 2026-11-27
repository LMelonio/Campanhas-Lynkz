-- ============================================================
--  Testes da migração 21: fornecedores da comissão (principal e secundários).
--  Rodados por tests/banco/rodar.sh depois de testes-20.sql, como o app
--  (set role authenticated). Usuários (de testes.sql): 1111 coordenador,
--  2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t21 cascade;
create schema t21;
grant usage on schema t21 to authenticated, anon, service_role;
create function t21.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t21.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t21.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t21 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id = '11111111-1111-1111-1111-111111111111';
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

-- ---------- 1. semente: Farelo com os % dos Parâmetros; exceção só para quem difere ----------
select t21.logar('');
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik)
  values ('Padrão Vinte Um', 'CLT', 2.5, (select pct_clt_farelo from comissao_parametros), '{PADRAO VINTE UM}');
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, pj_razao_social, pj_documento, pj_pix, pj_banco)
  values ('Diferente Vinte Um', 'PJ', 5, 3.5, '{DIFERENTE VINTE UM}', 'Diferente Ltda', '11222333000181', 'pix', 'Banco');
\ir ../../sql/migracoes/21-fornecedores-da-comissao.sql
select t21.ok((select count(*) = 1 from comissao_fornecedores f join comissao_parametros p on f.codigo = p.cod_farelo
               where f.nome = 'Farelo' and f.grupo = 'secundario' and f.pct_clt = p.pct_clt_farelo and f.pct_pj = p.pct_pj_farelo and f.vale_de = '2000-01'),
  'semente: Farelo é o 1º secundário, com os % de hoje (rodar de novo não duplica)');
select t21.ok((select count(*) = 1 from comissao_excecoes e join comissionados c on c.id = e.comissionado_id where c.nome = 'Diferente Vinte Um' and e.pct = 3.5),
  'semente: exceção para quem tinha % diferente do padrão');
select t21.ok(not exists (select 1 from comissao_excecoes e join comissionados c on c.id = e.comissionado_id where c.nome = 'Padrão Vinte Um'),
  'semente: sem exceção para quem tinha o % padrão');

set role authenticated;

-- ---------- 2. só administrador ----------
select t21.logar('11111111-1111-1111-1111-111111111111');
select t21.ok((select count(*) = 0 from comissao_fornecedores) and (select count(*) = 0 from comissao_excecoes), 'coordenador não lê');
select t21.falha($$insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj) values ('7064', 'Ouro Fino', 'secundario', 1, 1, 1)$$,
  'row-level security', 'coordenador não grava');

-- ---------- 3. regras ----------
select t21.logar('22222222-2222-2222-2222-222222222222');
select t21.falha($$insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj) values ('70a4', 'X', 'secundario', 1, 1, 1)$$,
  'comissao_fornecedores_codigo', 'código com letra é recusado');
select t21.falha($$insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas) values ('7064', 'Ouro Fino', 'secundario', 1, 1)$$,
  'comissao_fornecedores_pct', 'secundário sem os 3 % é recusado');
select t21.falha($$insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj) values ('7064', 'Ouro Fino', 'secundario', 1, 25, 1)$$,
  'comissao_fornecedores_pct', '% acima de 20 é recusado');
select t21.falha($$insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj, vale_de) values ('7064', 'Ouro Fino', 'secundario', 1, 1, 1, '2026-13')$$,
  'comissao_fornecedores_vale', 'mês de início inválido é recusado');
insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj, vale_de) values ('7064', '  Ouro   Fino ', 'secundario', 1, 0.5, 2, '2026-12');
select t21.ok((select nome = 'Ouro Fino' and atualizado_por = '22222222-2222-2222-2222-222222222222' from comissao_fornecedores where codigo = '7064'),
  'secundário novo gravado, nome limpo e carimbado');
select t21.falha($$insert into comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj) values ('7064', 'Outro', 'secundario', 1, 1, 1)$$,
  'comissao_fornecedores_codigo_unico', 'código repetido é recusado');
select t21.falha($$update comissao_fornecedores set codigo = '9999' where codigo = '7064'$$, 'permission denied', 'o código não muda pela API (as exceções apontam para ele)');
update comissao_fornecedores set nome = 'Ouro Fino Pet' where codigo = '7064';
select t21.ok((select count(*) = 1 from comissao_fornecedores where codigo = '7064' and nome = 'Ouro Fino Pet'), 'nome do secundário muda');
insert into comissao_fornecedores (codigo, nome, grupo, pct_clt) values ('21610', 'DBM', 'principal', 9);
select t21.ok((select pct_clt is null from comissao_fornecedores where codigo = '21610'), 'principal não guarda %');
select t21.falha($$delete from comissao_fornecedores where codigo = '7064'$$, 'permission denied', 'ninguém apaga fornecedor');

-- ---------- 4. exceções ----------
select t21.falha($$insert into comissao_excecoes (comissionado_id, fornecedor_id, pct)
  select c.id, f.id, 1 from comissionados c, comissao_fornecedores f where c.nome = 'Padrão Vinte Um' and f.codigo = '21610'$$,
  'só vale para fornecedor secundário', 'exceção em fornecedor principal é recusada');
insert into comissao_excecoes (comissionado_id, fornecedor_id, pct)
  select c.id, f.id, 1.5 from comissionados c, comissao_fornecedores f where c.nome = 'Padrão Vinte Um' and f.codigo = '7064';
select t21.falha($$insert into comissao_excecoes (comissionado_id, fornecedor_id, pct)
  select c.id, f.id, 2 from comissionados c, comissao_fornecedores f where c.nome = 'Padrão Vinte Um' and f.codigo = '7064'$$,
  'comissao_excecoes_unica', 'uma exceção por pessoa e fornecedor');
select t21.falha($$update comissao_excecoes set pct = 21$$, 'comissao_excecoes_pct', 'exceção acima de 20% é recusada');
select t21.falha($$delete from comissao_excecoes$$, 'permission denied', 'ninguém apaga exceção');

-- ---------- 5. principal em lista exige os % de "Outros" ----------
select t21.falha($$update comissao_parametros set principal_modo = 'lista'$$, 'comissao_parametros_principal', 'lista sem os % de Outros é recusada');
select t21.falha($$update comissao_parametros set principal_modo = 'alguns'$$, 'comissao_parametros_principal', 'modo desconhecido é recusado');
update comissao_parametros set principal_modo = 'lista', pct_outros_clt = 0.5, pct_outros_televendas = 0.5, pct_outros_pj = 1;
select t21.ok((select principal_modo = 'lista' from comissao_parametros), 'lista com os 3 % de Outros passa');
update comissao_parametros set principal_modo = 'todos', pct_outros_clt = null, pct_outros_televendas = null, pct_outros_pj = null;

-- ---------- 6. auditoria ----------
select t21.ok((select count(*) >= 2 from comissao_auditoria where tabela = 'comissao_fornecedores')
          and (select count(*) >= 1 from comissao_auditoria where tabela = 'comissao_excecoes'), 'fornecedores e exceções na auditoria');
reset role;

set role anon;
select t21.falha($$select * from comissao_fornecedores$$, 'permission denied', 'visitante não lê');
reset role;

-- ---------- 7. rollback leva o % de hoje do Farelo para os Parâmetros ----------
select t21.logar('');
update comissao_fornecedores f set pct_clt = 1.75, pct_televendas = 0.8, pct_pj = 2.25
  from comissao_parametros p where f.codigo = p.cod_farelo;
\ir ../../sql/migracoes/21-rollback.sql
select t21.ok((select pct_clt_farelo = 1.75 and pct_televendas_farelo = 0.8 and pct_pj_farelo = 2.25 from comissao_parametros),
  'rollback copia os % do Farelo de depois da 21 para os Parâmetros');
select t21.ok(to_regclass('public.comissao_fornecedores') is null, 'rollback tira a tabela de fornecedores');
\ir ../../sql/migracoes/21-rollback.sql
select t21.ok(true, 'rollback roda duas vezes');
-- Volta a 21 (a semente parte dos % de agora) para os testes seguintes.
\ir ../../sql/migracoes/21-fornecedores-da-comissao.sql
select t21.ok((select f.pct_clt = 1.75 from comissao_fornecedores f join comissao_parametros p on f.codigo = p.cod_farelo),
  'reaplicar a 21 semeia o Farelo com os % de agora');

drop schema t21 cascade;
\echo 'TESTES DA 21 PASSARAM'
