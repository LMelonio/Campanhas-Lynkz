-- ============================================================
--  Testes da migração 18: excluir balconista (só administrador), com registro.
--  Rodados por tests/banco/rodar.sh depois de testes-17.sql, como o app
--  (set role authenticated). Usuários (de testes.sql): 1111 coordenador,
--  2222 aprovador.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists t18 cascade;
create schema t18;
grant usage on schema t18 to authenticated, anon, service_role;
create function t18.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t18.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t18.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t18 to authenticated, anon, service_role;

update perfis set papel = 'coordenador', ativo = true where id = '11111111-1111-1111-1111-111111111111';
update perfis set papel = 'aprovador', ativo = true where id = '22222222-2222-2222-2222-222222222222';

-- ---------- preparo (como o SQL Editor, sem usuário logado) ----------
select t18.logar('');
insert into empresas (nome) values ('Empresa 18 cheia'), ('Empresa 18 pendente');
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone, ativo)
  select id, 'Antiga Pessoa Dezoito', '86288366757', '1990-01-01', 'antiga18@exemplo.com', '98999991801', false from empresas where nome = 'Empresa 18 cheia';
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Atual Pessoa Dezoito', '48261573982', '1990-01-02', 'atual18@exemplo.com', '98999991802' from empresas where nome = 'Empresa 18 cheia';
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Pendente Pessoa Dezoito', '73195826437', '1990-01-03', 'pend18@exemplo.com', '98999991803' from empresas where nome = 'Empresa 18 pendente';

create function t18.bal(nome text) returns bigint language sql stable as $$ select id from public.balconistas where nome_completo = nome $$;

-- Campanha Swile aprovada sem os dados de quem recebe: só existe porque a
-- constraint campanhas_swile_valido é "not valid". Tira a regra, grava e põe de volta igual.
do $$
declare d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'campanhas_swile_valido';
  alter table campanhas drop constraint if exists campanhas_swile_valido;
  insert into campanhas (cliente, empresa_id, balconista_id, laboratorio, campanha, status, forma_pagamento, investimento_lynkz)
    select 'x', b.empresa_id, b.id, 'Avert', '18 Swile sem dados', 'Aprovada', 'Swile', 100 from balconistas b where b.nome_completo = 'Antiga Pessoa Dezoito';
  if d is not null then execute 'alter table campanhas add constraint campanhas_swile_valido ' || d; end if;
end $$;
insert into campanhas (cliente, empresa_id, balconista_id, laboratorio, campanha, status, forma_pagamento, investimento_lynkz,
                       swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone)
  select 'x', b.empresa_id, b.id, 'Avert', '18 Swile com dados', 'Aprovada', 'Swile', 100,
         'Outra Pessoa Silva', '52998224725', '1985-05-05', 'outra@exemplo.com', '98999991899'
  from balconistas b where b.nome_completo = 'Antiga Pessoa Dezoito';
insert into campanhas (cliente, empresa_id, balconista_id, laboratorio, campanha, status, motivo, forma_pagamento)
  select 'x', b.empresa_id, b.id, 'Avert', '18 Reprovada', 'Reprovada', 'Fora do padrão', 'Desconto em nota' from balconistas b where b.nome_completo = 'Antiga Pessoa Dezoito';
insert into campanhas (cliente, empresa_id, balconista_id, laboratorio, campanha, status, forma_pagamento)
  select 'x', b.empresa_id, b.id, 'Avert', '18 Pendente', 'Pendente', 'Desconto em nota' from balconistas b where b.nome_completo = 'Pendente Pessoa Dezoito';
select t18.ok((select count(*) = 3 from campanhas where balconista_id = t18.bal('Antiga Pessoa Dezoito')), 'preparo: 3 campanhas decididas com o balconista antigo');

set role authenticated;

-- ---------- 1. quem não é administrador não exclui ----------
select t18.logar('11111111-1111-1111-1111-111111111111');
select t18.falha($$select public.excluir_balconista(t18.bal('Antiga Pessoa Dezoito'), 'saiu da loja')$$,
  'Só um administrador', 'coordenador não exclui balconista');
select t18.falha($$delete from balconistas where nome_completo = 'Antiga Pessoa Dezoito'$$, 'permission denied', 'DELETE direto na tabela continua proibido');
select t18.falha($$insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Nova Pessoa Dezoito', '11144477735', '1990-01-04', 'nova18@exemplo.com', '98999991804' from empresas where nome = 'Empresa 18 cheia'$$,
  'administrador exclui um deles', 'com a empresa cheia, a mensagem do limite aponta para a exclusão');
select t18.logar('');
select t18.falha($$select public.excluir_balconista(1, 'sem login')$$, 'Só um administrador', 'sem login não exclui');

-- ---------- 2. administrador: motivo, inexistente e pendente ----------
select t18.logar('22222222-2222-2222-2222-222222222222');
select t18.falha($$select public.excluir_balconista(t18.bal('Antiga Pessoa Dezoito'), '  ab ')$$, 'motivo', 'motivo curto é recusado');
select t18.falha($$select public.excluir_balconista(t18.bal('Antiga Pessoa Dezoito'), repeat('x', 501))$$, 'motivo', 'motivo longo demais é recusado');
select t18.falha($$select public.excluir_balconista(-1, 'não existe')$$, 'não encontrado', 'balconista inexistente dá mensagem clara');
select t18.falha($$select public.excluir_balconista(t18.bal('Pendente Pessoa Dezoito'), 'saiu da loja')$$,
  '1 campanha(s) pendente(s)', 'balconista com campanha pendente é barrado');
select t18.falha($$delete from balconistas where nome_completo = 'Antiga Pessoa Dezoito'$$, 'permission denied', 'nem o administrador apaga direto na tabela');

-- ---------- 3. administrador exclui: histórico preservado ----------
select t18.ok((select (public.excluir_balconista(t18.bal('Antiga Pessoa Dezoito'), '  Saiu   da loja ')->>'campanhas')::int = 3),
  'administrador exclui e recebe quantas campanhas mudaram');
select t18.ok(t18.bal('Antiga Pessoa Dezoito') is null, 'o cadastro sumiu');
select t18.ok((select balconista_id is null and status = 'Aprovada' and swile_nome_completo = 'Antiga Pessoa Dezoito' and swile_cpf = '86288366757'
                      and swile_data_nascimento = '1990-01-01' and swile_email = 'antiga18@exemplo.com' and swile_telefone = '98999991801'
               from campanhas_app where campanha = '18 Swile sem dados'), 'aprovada Swile sem dados recebe os dados do cadastro');
select t18.ok((select balconista_id is null and swile_nome_completo = 'Outra Pessoa Silva' and swile_cpf = '52998224725'
               from campanhas_app where campanha = '18 Swile com dados'), 'aprovada Swile com dados mantém quem recebeu');
select t18.ok((select balconista_id is null and status = 'Reprovada' and motivo = 'Fora do padrão' and swile_nome_completo is null
               from campanhas_app where campanha = '18 Reprovada'), 'reprovada fica sem balconista, com a decisão igual');
select t18.ok((select motivo = 'Saiu da loja' and excluido_por = '22222222-2222-2222-2222-222222222222' and nome_completo = 'Antiga Pessoa Dezoito'
                      and dados->'balconista'->>'cpf' = '86288366757' and jsonb_array_length(dados->'campanhas') = 3
                      and empresa_id = (select id from empresas where nome = 'Empresa 18 cheia')
               from balconistas_excluidos where nome_completo = 'Antiga Pessoa Dezoito'), 'cópia guarda cadastro, campanhas, motivo e quem excluiu');
select t18.falha($$select public.excluir_balconista((select balconista_id from balconistas_excluidos where nome_completo = 'Antiga Pessoa Dezoito'), 'de novo')$$,
  'não encontrado', 'excluir de novo dá mensagem clara');
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Nova Pessoa Dezoito', '11144477735', '1990-01-04', 'nova18@exemplo.com', '98999991804' from empresas where nome = 'Empresa 18 cheia';
select t18.ok(t18.bal('Nova Pessoa Dezoito') is not null, 'depois de excluir, cabe um balconista novo na empresa');
select t18.ok(t18.bal('Pendente Pessoa Dezoito') is not null, 'o barrado continua cadastrado');
select t18.falha($$update balconistas_excluidos set motivo = 'outro'$$, 'permission denied', 'registro não pode ser alterado');
select t18.falha($$delete from balconistas_excluidos$$, 'permission denied', 'registro não pode ser apagado');
select t18.falha($$insert into balconistas_excluidos (balconista_id, dados, motivo) values (1, '{}', 'forjado')$$, 'permission denied', 'registro não pode ser forjado');

-- ---------- 4. coordenador não vê o registro ----------
select t18.logar('11111111-1111-1111-1111-111111111111');
select t18.ok((select count(*) = 0 from balconistas_excluidos), 'coordenador não vê o registro de exclusões');
reset role;

-- ---------- 5. administrador desativado não exclui ----------
update perfis set ativo = false where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select t18.logar('22222222-2222-2222-2222-222222222222');
select t18.falha($$select public.excluir_balconista(t18.bal('Atual Pessoa Dezoito'), 'desativado')$$,
  'Só um administrador', 'administrador desativado não exclui');
reset role;
update perfis set ativo = true where id = '22222222-2222-2222-2222-222222222222';

-- ---------- 6. visitante sem login ----------
set role anon;
select t18.falha($$select public.excluir_balconista(1, 'visitante')$$, 'permission denied', 'visitante não chama a função');
select t18.falha($$select * from balconistas_excluidos$$, 'permission denied', 'visitante não lê o registro');
reset role;

select t18.logar('');
drop schema t18 cascade;
\echo 'TESTES DA 18 PASSARAM'
