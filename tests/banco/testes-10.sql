-- ============================================================
--  Testes da migração 10: segurança.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t10;
grant usage on schema t10 to authenticated, anon;
create function t10.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t10.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t10.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t10 to authenticated, anon;

-- ---------- 1. conta nova entra desativada ----------
insert into auth.users values ('a0a0a0a0-0000-0000-0000-000000000001', 'intruso@gmail.com');
select t10.ok((select not ativo from perfis where email = 'intruso@gmail.com'), 'conta criada pela API entra desativada');
set role authenticated;
select t10.logar('a0a0a0a0-0000-0000-0000-000000000001');
select t10.ok((select count(*) = 0 from balconistas), 'conta nova não lê balconistas (CPFs)');
select t10.ok((select count(*) = 0 from empresas), 'conta nova não lê empresas');
select t10.ok((select count(*) = 0 from campanhas_app), 'conta nova não lê campanhas');
select t10.falha($$insert into empresas (nome) values ('Intrusa')$$, 'row-level security', 'conta nova não cadastra');
select t10.falha($$update perfis set ativo = true where id = auth.uid()$$, 'permission denied', 'conta nova não se ativa');
reset role;

-- ---------- 4. auditoria ----------
select t10.logar('');   -- como no SQL Editor: sem usuário logado
update perfis set ativo = true, papel = 'aprovador' where email = 'intruso@gmail.com';
select t10.ok((select count(*) = 2 from auditoria_perfis where email = 'intruso@gmail.com' and feito_por is null), 'mudança de papel e ativo fica na auditoria');
set role authenticated;
select t10.logar('11111111-1111-1111-1111-111111111111');   -- coordenador
select t10.ok((select count(*) = 0 from auditoria_perfis), 'coordenador não lê a auditoria');
select t10.falha($$insert into auditoria_perfis (perfil_id, campo) values (auth.uid(), 'x')$$, 'permission denied', 'ninguém grava na auditoria');
select t10.logar('22222222-2222-2222-2222-222222222222');   -- aprovador
select t10.ok((select count(*) >= 2 from auditoria_perfis), 'aprovador lê a auditoria');
reset role;
update perfis set ativo = false, papel = 'coordenador' where email = 'intruso@gmail.com';

-- ---------- 2. limites de tamanho e de faixa ----------
set role authenticated;
select t10.logar('11111111-1111-1111-1111-111111111111');
select t10.falha($$insert into empresas (nome) values (repeat('x', 201))$$, 'empresas_textos_tamanho', 'nome de empresa gigante é recusado');
select t10.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status, observacoes)
  values ('X','Avert','Y', auth.uid(), 'Pendente', repeat('x', 2001))$$, 'campanhas_textos_tamanho', 'observação gigante é recusada');
select t10.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status, investimento_lynkz)
  values ('X','Avert','Y', auth.uid(), 'Pendente', 99000000)$$, 'campanhas_valores_faixa', 'investimento absurdo é recusado');
select t10.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status, rebate_pct)
  values ('X','Avert','Y', auth.uid(), 'Pendente', 150)$$, 'campanhas_valores_faixa', 'rebate acima de 100% é recusado');

-- ---------- 3. limite por hora ----------
select t10.falha($c$do $x$ begin for i in 1..61 loop insert into empresas (nome) values ('Robo ' || i); end loop; end $x$$c$,
  'muitos registros', 'mais de 60 empresas na mesma hora é barrado');
reset role;
select t10.logar('');
insert into empresas (nome) select 'Carga ' || g from generate_series(1, 80) g;
select t10.ok((select count(*) = 80 from empresas where nome like 'Carga %'), 'SQL Editor / carga sem limite');

-- ---------- 5. funções ----------
select t10.ok(not has_function_privilege('anon', 'public.eh_aprovador()', 'execute'), 'anon não executa eh_aprovador');

drop schema t10 cascade;
\echo 'TESTES DA 10 PASSARAM'
