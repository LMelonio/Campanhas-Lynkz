-- ============================================================
--  Testes da migração 15: excluir campanha (só administrador), com registro.
--  Rodados por tests/banco/rodar.sh depois de testes-14.sql, como o app
--  (set role authenticated). Usuários (de testes.sql): 1111 coordenador,
--  2222 aprovador, 4444 outro coordenador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t15 cascade;
create schema t15;
grant usage on schema t15 to authenticated, anon, service_role;
create function t15.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t15.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t15.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t15 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id in ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

set role authenticated;
select t15.logar('11111111-1111-1111-1111-111111111111');
insert into empresas (nome) values ('Empresa da exclusão');
select public.enviar_campanha(
  jsonb_build_object('cliente', 'x', 'empresa_id', (select id from public.empresas where nome = 'Empresa da exclusão'),
    'laboratorio', 'Avert', 'campanha', 'Para excluir', 'meta', 1000, 'investimento_lynkz', 50),
  null, '[{"numero":"123","serie":"1","data":"2026-11-01","valor":10}]'::jsonb);
select public.enviar_campanha(
  jsonb_build_object('cliente', 'x', 'empresa_id', (select id from public.empresas where nome = 'Empresa da exclusão'),
    'laboratorio', 'Avert', 'campanha', 'Fica', 'meta', 1000), null, '[]'::jsonb);
select t15.ok((select count(*) = 1 from campanha_notas n join campanhas_app c on c.id = n.campanha_id where c.campanha = 'Para excluir'),
  'campanha de teste com 1 nota');

-- ---------- 1. quem não é administrador não exclui ----------
select t15.falha($$select public.excluir_campanha((select id from campanhas_app where campanha = 'Para excluir'), 'teste de exclusão')$$,
  'Só um administrador', 'solicitante (coordenador) não exclui nem a própria campanha');
select t15.logar('44444444-4444-4444-4444-444444444444');
select t15.falha($$select public.excluir_campanha((select id from campanhas_app where campanha = 'Para excluir'), 'teste de exclusão')$$,
  'Só um administrador', 'outro coordenador não exclui');
select t15.falha($$delete from campanhas where campanha = 'Para excluir'$$, 'permission denied', 'DELETE direto na tabela continua proibido');
select t15.logar('');
select t15.falha($$select public.excluir_campanha(1, 'sem login')$$, 'Só um administrador', 'sem login não exclui');

-- ---------- 2. administrador: motivo obrigatório ----------
select t15.logar('22222222-2222-2222-2222-222222222222');
select t15.falha($$select public.excluir_campanha((select id from campanhas_app where campanha = 'Para excluir'), '  ')$$,
  'motivo', 'sem motivo não exclui');
select t15.falha($$select public.excluir_campanha((select id from campanhas_app where campanha = 'Para excluir'), repeat('x', 501))$$,
  'motivo', 'motivo longo demais não exclui');
select t15.falha($$select public.excluir_campanha(-1, 'não existe')$$, 'não encontrada', 'campanha inexistente dá mensagem clara');
select t15.falha($$delete from campanhas where campanha = 'Para excluir'$$, 'permission denied', 'nem o administrador apaga direto na tabela');

-- ---------- 3. administrador exclui, com registro ----------
select t15.ok((select (public.excluir_campanha(id, '  Enviada   em duplicidade ')->>'id')::bigint = id from campanhas_app where campanha = 'Para excluir'),
  'administrador exclui e recebe o id');
select t15.ok(not exists (select 1 from campanhas_app where campanha = 'Para excluir'), 'campanha sumiu da lista');
select t15.ok(exists (select 1 from campanhas_app where campanha = 'Fica'), 'as outras campanhas ficam');
reset role;
select t15.ok(not exists (select 1 from campanha_notas n where not exists (select 1 from campanhas c where c.id = n.campanha_id)),
  'as notas da campanha excluída saem junto');
set role authenticated;
select t15.logar('22222222-2222-2222-2222-222222222222');
select t15.ok((select motivo = 'Enviada em duplicidade' and excluida_por = '22222222-2222-2222-2222-222222222222' and campanha = 'Para excluir'
                      and dados->'campanha'->>'campanha' = 'Para excluir' and jsonb_array_length(dados->'notas') = 1
               from campanhas_excluidas), 'registro guarda campanha, notas, motivo e quem excluiu');
select t15.falha($$update campanhas_excluidas set motivo = 'outro'$$, 'permission denied', 'registro não pode ser alterado');
select t15.falha($$delete from campanhas_excluidas$$, 'permission denied', 'registro não pode ser apagado');
select t15.falha($$insert into campanhas_excluidas (campanha_id, dados, motivo) values (1, '{}', 'forjado')$$, 'permission denied', 'registro não pode ser forjado');

-- ---------- 4. coordenador não vê o registro ----------
select t15.logar('11111111-1111-1111-1111-111111111111');
select t15.ok((select count(*) = 0 from campanhas_excluidas), 'coordenador não vê o registro de exclusões');
reset role;

-- ---------- 5. administrador desativado não exclui ----------
update perfis set ativo = false where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t15.logar('22222222-2222-2222-2222-222222222222');
select t15.falha($$select public.excluir_campanha((select id from campanhas where campanha = 'Fica'), 'desativado')$$,
  'Só um administrador', 'administrador desativado não exclui');
reset role;
update perfis set ativo = true where id = '22222222-2222-2222-2222-222222222222';

-- ---------- 6. visitante sem login ----------
set role anon;
select t15.falha($$select public.excluir_campanha(1, 'visitante')$$, 'permission denied', 'visitante não chama a função');
select t15.falha($$select * from campanhas_excluidas$$, 'permission denied', 'visitante não lê o registro');
reset role;

drop schema t15 cascade;
\echo 'TESTES DA 15 PASSARAM'
