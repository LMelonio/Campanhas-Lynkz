-- ============================================================
--  Testes da migração 22: PJ com os dados de pagamento obrigatórios.
--  Rodados por tests/banco/rodar.sh depois de testes-21.sql, como o app
--  (set role authenticated). Usuário (de testes.sql): 2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t22 cascade;
create schema t22;
grant usage on schema t22 to authenticated, anon, service_role;
create function t22.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t22.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t22.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t22 to authenticated, anon, service_role;

-- Um PJ incompleto de antes da 22 (carga pelo SQL Editor, sem o gatilho).
alter table comissionados disable trigger ao_validar_pj_completo;
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('PJ Antigo Vinte Dois', 'PJ', 5, 2, '{PJ ANTIGO VINTE DOIS}');
alter table comissionados enable trigger ao_validar_pj_completo;

update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t22.logar('22222222-2222-2222-2222-222222222222');

-- ---------- criar ----------
select t22.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('PJ Vazio', 'PJ', 5, 2, '{PJ VAZIO 22}')$$,
  'Informe a razão social', 'PJ sem dados é recusado');
select t22.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, pj_razao_social, pj_documento, pj_pix, pj_banco)
  values ('PJ Doc', 'PJ', 5, 2, '{PJ DOC 22}', 'Doc Ltda', '11.222.333/0001-82', 'pix', 'Banco')$$, 'CNPJ ou CPF inválido', 'CNPJ com dígito errado é recusado');
select t22.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, pj_razao_social, pj_documento, pj_banco)
  values ('PJ Pix', 'PJ', 5, 2, '{PJ PIX 22}', 'Pix Ltda', '11222333000181', 'Banco')$$, 'Informe a chave PIX', 'sem PIX é recusado');
select t22.falha($$insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, pj_razao_social, pj_documento, pj_pix, pj_banco)
  values ('PJ Banco', 'PJ', 5, 2, '{PJ BANCO 22}', 'Banco Ltda', '11222333000181', 'pix', '   ')$$, 'Informe o banco', 'banco em branco é recusado');
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, pj_razao_social, pj_documento, pj_pix, pj_banco)
  values ('PJ Completo', 'PJ', 5, 2, '{PJ COMPLETO 22}', 'Completo Ltda', '11.222.333/0001-81', '11222333000181', 'Nubank');
select t22.ok(exists (select 1 from comissionados where nome = 'PJ Completo' and pj_documento = '11222333000181'), 'PJ completo grava (CNPJ com pontos vira só dígitos)');
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik, pj_razao_social, pj_documento, pj_pix, pj_banco)
  values ('PJ Cpf', 'PJ', 5, 2, '{PJ CPF 22}', 'Pessoa Física', '529.982.247-25', 'pix', 'Caixa');
select t22.ok(exists (select 1 from comissionados where nome = 'PJ Cpf'), 'CPF válido também serve');
insert into comissionados (nome, regime, pct_principal, pct_farelo, nomes_qlik) values ('Clt Vinte Dois', 'CLT', 2.5, 1, '{CLT VINTE DOIS}');
select t22.ok(exists (select 1 from comissionados where nome = 'Clt Vinte Dois'), 'CLT não é afetado');

-- ---------- editar ----------
select t22.falha($$update comissionados set pj_pix = '' where nome = 'PJ Completo'$$, 'Informe a chave PIX', 'tirar o PIX de um PJ é recusado');
select t22.falha($$update comissionados set equipe = 'Equipe 22' where nome = 'PJ Antigo Vinte Dois'$$, 'Informe a razão social', 'PJ antigo incompleto: editar pede os dados');
update comissionados set ativo = false where nome = 'PJ Antigo Vinte Dois';
select t22.ok((select not ativo from comissionados where nome = 'PJ Antigo Vinte Dois'), 'desativar um PJ incompleto passa');
select t22.falha($$update comissionados set ativo = true where nome = 'PJ Antigo Vinte Dois'$$, 'Informe a razão social', 'reativar incompleto pede os dados');
select t22.falha($$update comissionados set regime = 'PJ' where nome = 'Clt Vinte Dois'$$, 'Informe a razão social', 'virar PJ pede os dados');
reset role;

select t22.logar('');
drop schema t22 cascade;
\echo 'TESTES DA 22 PASSARAM'
