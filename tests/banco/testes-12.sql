-- ============================================================
--  Testes da migração 12: usuários pelo app (definir_perfil) e limite de
--  2 balconistas por empresa. Rodados por tests/banco/rodar.sh depois de testes-11.sql.
--  Usuários: 1111 coordenador, 2222 aprovador, 3333 desativado (de testes.sql).
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t12 cascade;
create schema t12;
grant usage on schema t12 to authenticated, anon, service_role;
create function t12.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t12.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t12.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t12 to authenticated, anon, service_role;

-- conta nova, como chega pelo cadastro (entra desativada a partir da 10)
insert into auth.users values ('99999999-9999-9999-9999-999999999999', 'novo.usuario@lynkz.com.br') on conflict do nothing;
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';
update perfis set papel = 'coordenador', ativo = true where id = '11111111-1111-1111-1111-111111111111';
update perfis set ativo = false where id = '99999999-9999-9999-9999-999999999999';
-- No Supabase, authenticated já tem SELECT em perfis (o app lê os perfis); o stub local não.
grant select on public.perfis to authenticated;

set role authenticated;

-- ---------- 1. usuários ----------
select t12.logar('11111111-1111-1111-1111-111111111111');
select t12.falha($$select public.definir_perfil('99999999-9999-9999-9999-999999999999', null, true)$$, 'administrador', 'usuário comum não libera contas');
select t12.falha($$select public.definir_perfil('11111111-1111-1111-1111-111111111111', 'aprovador')$$, 'administrador', 'usuário comum não se promove');
select t12.falha($$update perfis set papel = 'aprovador' where id = '11111111-1111-1111-1111-111111111111'$$, 'permission denied', 'ninguém edita perfis direto pela API');

select t12.logar('22222222-2222-2222-2222-222222222222');
select public.definir_perfil('99999999-9999-9999-9999-999999999999', null, true);
select t12.ok((select ativo from perfis where id = '99999999-9999-9999-9999-999999999999'), 'administrador libera conta nova');
select public.definir_perfil('99999999-9999-9999-9999-999999999999', 'aprovador');
select t12.ok((select papel = 'aprovador' from perfis where id = '99999999-9999-9999-9999-999999999999'), 'administrador promove a administrador');
select public.definir_perfil('99999999-9999-9999-9999-999999999999', 'coordenador', null, '  Novo   Usuário  ');
select t12.ok((select papel = 'coordenador' and nome = 'Novo Usuário' from perfis where id = '99999999-9999-9999-9999-999999999999'), 'volta a usuário e o nome é ajustado');
select t12.falha($$select public.definir_perfil('22222222-2222-2222-2222-222222222222', 'coordenador')$$, 'próprio', 'administrador não tira o próprio papel');
select t12.falha($$select public.definir_perfil('22222222-2222-2222-2222-222222222222', null, false)$$, 'próprio', 'administrador não se desativa');
select public.definir_perfil('22222222-2222-2222-2222-222222222222', null, null, 'Ana Aprovadora');
select t12.ok((select nome = 'Ana Aprovadora' from perfis where id = '22222222-2222-2222-2222-222222222222'), 'administrador troca o próprio nome');
select t12.falha($$select public.definir_perfil('99999999-9999-9999-9999-999999999999', 'gerente')$$, 'papel inválido', 'papel fora da lista é recusado');
select t12.falha($$select public.definir_perfil('99999999-9999-9999-9999-999999999999', null, null, 'x')$$, '2 a 80', 'nome de 1 letra é recusado');
select t12.falha($$select public.definir_perfil('00000000-0000-0000-0000-000000000000', null, true)$$, 'não encontrado', 'usuário inexistente avisa');
select public.definir_perfil('99999999-9999-9999-9999-999999999999', null, false);
reset role;
select t12.ok((select count(*) >= 3 from auditoria_perfis where perfil_id = '99999999-9999-9999-9999-999999999999' and feito_por = '22222222-2222-2222-2222-222222222222'),
  'trocas feitas pelo app ficam na auditoria com quem fez');
set role authenticated;

select t12.logar('33333333-3333-3333-3333-333333333333');
select t12.falha($$select public.definir_perfil('33333333-3333-3333-3333-333333333333', null, true)$$, 'administrador', 'desativado não se reativa pela função');
reset role;
set role anon;
select t12.falha($$select public.definir_perfil('99999999-9999-9999-9999-999999999999', null, true)$$, 'permission denied', 'visitante não executa definir_perfil');
reset role;

-- ---------- 2. até 2 balconistas por empresa ----------
set role authenticated;
select t12.logar('11111111-1111-1111-1111-111111111111');
insert into empresas (nome) values ('Empresa do limite');
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Primeira Pessoa Lima', '86288366757', '1990-01-01', 'p1@exemplo.com', '98999991001' from empresas where nome = 'Empresa do limite';
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Segunda Pessoa Lima', '48261573982', '1990-01-02', 'p2@exemplo.com', '98999991002' from empresas where nome = 'Empresa do limite';
select t12.falha($$insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Terceira Pessoa Lima', '73195826437', '1990-01-03', 'p3@exemplo.com', '98999991003' from empresas where nome = 'Empresa do limite'$$,
  'limite', 'terceiro balconista na mesma empresa é recusado');
update balconistas set ativo = false where cpf = '86288366757';
select t12.falha($$insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Terceira Pessoa Lima', '73195826437', '1990-01-03', 'p3@exemplo.com', '98999991003' from empresas where nome = 'Empresa do limite'$$,
  'limite', 'desativado continua contando no limite');
update balconistas set nome_completo = 'Segunda Pessoa Souza' where cpf = '48261573982';
select t12.ok((select nome_completo = 'Segunda Pessoa Souza' from balconistas where cpf = '48261573982'), 'com o limite cheio, editar continua liberado');
select t12.falha($$select public.enviar_campanha(
  (select jsonb_build_object('cliente','x','empresa_id', id,'laboratorio','Avert','campanha','Terceiro pelo envio') from empresas where nome = 'Empresa do limite'),
  (select jsonb_build_object('empresa_id', id,'nome_completo','Terceira Pessoa Lima','cpf','73195826437','data_nascimento','1990-01-03','email','p3@exemplo.com','telefone','98999991003') from empresas where nome = 'Empresa do limite'))$$,
  'limite', 'enviar_campanha também respeita o limite');
select t12.ok((select count(*) = 0 from campanhas_app where campanha = 'Terceiro pelo envio'), 'e a campanha não fica gravada sem o balconista');
reset role;

-- carga pelo SQL Editor / service_role não é barrada
select t12.logar('');
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Carga Planilha Lima', '73195826437', '1990-01-03', 'p3@exemplo.com', '98999991003' from empresas where nome = 'Empresa do limite';
select t12.ok((select count(*) = 3 from balconistas b join empresas e on e.id = b.empresa_id where e.nome = 'Empresa do limite'), 'carga do SQL Editor não é barrada pelo limite');

drop schema t12 cascade;
\echo 'TESTES DA 12 PASSARAM'
