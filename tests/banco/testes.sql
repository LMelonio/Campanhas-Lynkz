-- ============================================================
--  Testes de comportamento do banco (RLS, triggers, permissões).
--  Rodados por tests/banco/rodar.sh depois do schema/migrações.
--  Cada teste imprime "ok  ..." ; qualquer falha interrompe com erro.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema teste;
grant usage on schema teste to authenticated, anon;

-- Executa cmd e exige que ele FALHE com uma mensagem que contenha "trecho".
create function teste.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
-- Exige que a condição seja verdadeira.
create function teste.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
-- Troca o "usuário logado" (auth.uid()).
create function teste.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema teste to authenticated, anon;

-- ---------- usuários ----------
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'coord@lynkz.com.br'),
  ('22222222-2222-2222-2222-222222222222', 'aprov@lynkz.com.br'),
  ('33333333-3333-3333-3333-333333333333', 'saiu@lynkz.com.br'),
  ('44444444-4444-4444-4444-444444444444', 'coord2@lynkz.com.br');
select teste.ok((select count(*) = 4 from perfis), 'perfil criado automaticamente para cada usuário');
update perfis set papel = 'aprovador' where email = 'aprov@lynkz.com.br';
update perfis set ativo = false where email = 'saiu@lynkz.com.br';
grant usage, select on all sequences in schema public to authenticated;

\set COORD '\'11111111-1111-1111-1111-111111111111\''
\set APROV '\'22222222-2222-2222-2222-222222222222\''
\set SAIU  '\'33333333-3333-3333-3333-333333333333\''
\set COORD2 '\'44444444-4444-4444-4444-444444444444\''

-- ---------- visitante sem login ----------
set role anon;
select teste.falha('select * from empresas', 'permission denied', 'anon não lê empresas');
select teste.falha('select * from campanhas_app', 'permission denied', 'anon não lê campanhas');
reset role;

-- ---------- coordenador: gestão ----------
set role authenticated;
select teste.logar(:COORD);
insert into empresas (nome, cnpj, cidade, telefone) values ('Pet Shop Cohama', '12345678000195', 'São Luís', '9832221111');
insert into empresas (nome, cidade) values ('Agro Turu', 'São Luís');
select teste.ok((select criado_por = auth.uid() from empresas where nome = 'Agro Turu'), 'criado_por carimbado pelo banco');
select teste.falha($$insert into empresas (nome) values ('X')$$, 'check', 'nome de empresa com 1 letra é recusado');
select teste.falha($$insert into empresas (nome, cnpj) values ('Outra', '12345678000195')$$, 'unique', 'CNPJ duplicado é recusado');
select teste.falha($$insert into empresas (nome, cnpj) values ('Outra', '123')$$, 'check', 'CNPJ com tamanho errado é recusado');
select teste.falha($$insert into empresas (nome, criado_por) values ('Forjada', '22222222-2222-2222-2222-222222222222')$$, 'permission denied', 'não dá para forjar criado_por');

insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Maria das Graças', '52998224725', '1990-05-12', 'maria@x.com', '98988887777' from empresas where nome = 'Pet Shop Cohama';
select teste.falha($$insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'João Silva', '11111111111', '1990-05-12', 'j@x.com', '98988887777' from empresas where nome = 'Pet Shop Cohama'$$, 'check', 'CPF inválido é recusado');
select teste.falha($$insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Maria Repetida', '52998224725', '1990-05-12', 'm2@x.com', '98988887777' from empresas where nome = 'Pet Shop Cohama'$$, 'unique', 'mesmo CPF duas vezes na empresa é recusado');
select teste.falha($$insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Maria', '39053344705', '1990-05-12', 'm@x.com', '98988887777' from empresas where nome = 'Pet Shop Cohama'$$, 'check', 'nome sem sobrenome é recusado');
update balconistas set email = 'maria.gracas@x.com' where cpf = '52998224725';
select teste.ok((select atualizado_por = auth.uid() and atualizado_em is not null from balconistas where cpf = '52998224725'), 'edição carimba atualizado_por/atualizado_em');
select teste.falha($$delete from balconistas$$, 'permission denied', 'ninguém apaga balconista');
select teste.falha($$delete from empresas$$, 'permission denied', 'ninguém apaga empresa');
update empresas set ativo = false where nome = 'Agro Turu';
select teste.ok((select not ativo from empresas where nome = 'Agro Turu'), 'coordenador desativa empresa');
update empresas set ativo = true where nome = 'Agro Turu';

-- ---------- coordenador: campanhas ----------
select teste.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status)
  values ('X','Avert','Y', auth.uid(), 'Aprovada')$$, 'row-level security', 'campanha não nasce aprovada');
select teste.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status)
  values ('X','Avert','Y', '22222222-2222-2222-2222-222222222222', 'Pendente')$$, 'row-level security', 'não cria campanha em nome de outro');
select teste.falha($$insert into campanhas (cliente, laboratorio, campanha, empresa_id, balconista_id, solicitante_id, status)
  select 'Agro Turu','Avert','Y', (select id from empresas where nome='Agro Turu'), (select id from balconistas limit 1), auth.uid(), 'Pendente'$$,
  'não pertence', 'balconista de outra empresa é recusado');
select teste.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status, forma_pagamento, swile_nome_completo)
  values ('X','Avert','Y', auth.uid(), 'Pendente', 'Swile', 'Fulano')$$, 'swile_valido', 'Swile sem dados completos é recusado');
insert into campanhas (cliente, laboratorio, campanha, empresa_id, balconista_id, solicitante_id, solicitante_nome, status, forma_pagamento,
  investimento_lynkz, meta, swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone)
  select 'Pet Shop Cohama','Premier','Black Friday', e.id, b.id, auth.uid(), 'NOME FORJADO', 'Pendente', 'Swile', 2400, 15000,
         'Maria das Graças', '52998224725', '1990-05-12', 'maria@x.com', '98988887777'
  from empresas e join balconistas b on b.empresa_id = e.id where e.nome = 'Pet Shop Cohama';
select teste.ok((select solicitante_nome = 'coord' from campanhas_app where campanha = 'Black Friday'), 'solicitante_nome carimbado pelo banco (ignora o enviado)');
select teste.ok((select swile_visivel and swile_cpf = '52998224725' from campanhas_app where campanha = 'Black Friday'), 'solicitante vê os próprios dados Swile');
select teste.falha($$select swile_cpf from campanhas$$, 'permission denied', 'swile_cpf não é lido direto da tabela');
update campanhas set status = 'Aprovada' where campanha = 'Black Friday';
select teste.ok((select status = 'Pendente' from campanhas_app where campanha = 'Black Friday'), 'coordenador não consegue aprovar (nenhuma linha muda)');
select teste.falha($$update campanhas set investimento_lynkz = 1 where campanha = 'Black Friday'$$, 'permission denied', 'ninguém altera valores da campanha');
select teste.falha($$delete from campanhas$$, 'permission denied', 'ninguém apaga campanha');

-- ---------- outro coordenador ----------
select teste.logar(:COORD2);
select teste.ok((select not swile_visivel and swile_cpf is null from campanhas_app where campanha = 'Black Friday'), 'outro coordenador NÃO vê os dados Swile da campanha');
select teste.ok((select count(*) = 1 from balconistas where cpf = '52998224725'), 'outro coordenador vê o cadastro do balconista (decisão de 18/11/2026)');

-- ---------- desativado ----------
select teste.logar(:SAIU);
select teste.ok((select count(*) = 0 from empresas), 'desativado não vê empresas');
select teste.ok((select count(*) = 0 from campanhas_app), 'desativado não vê campanhas');
select teste.falha($$insert into empresas (nome) values ('Hacker Pet')$$, 'row-level security', 'desativado não cadastra empresa');
select teste.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status)
  values ('X','Avert','Y', auth.uid(), 'Pendente')$$, 'row-level security', 'desativado não cria campanha');
select teste.falha($$update perfis set ativo = true where id = auth.uid()$$, 'permission denied', 'desativado não se reativa');

-- ---------- aprovador ----------
select teste.logar(:APROV);
select teste.ok((select swile_visivel and swile_cpf is not null from campanhas_app where campanha = 'Black Friday'), 'aprovador vê os dados Swile');
select teste.falha($$update campanhas set status = 'Reprovada' where campanha = 'Black Friday'$$, 'motivo', 'reprova sem motivo é recusada');
select teste.falha($$update campanhas set status = 'Aprovada', aprovador_nome = 'Forjado' where campanha = 'Black Friday'$$, 'permission denied', 'aprovador não forja aprovador_nome');
update campanhas set status = 'Aprovada' where campanha = 'Black Friday';
select teste.ok((select status = 'Aprovada' and aprovador_nome = 'aprov'
                 and data_decisao = (now() at time zone 'America/Fortaleza')::date from campanhas_app where campanha = 'Black Friday'),
  'aprovação carimba aprovador e data no fuso local');
select teste.falha($$update campanhas set status = 'Reprovada', motivo = 'x' where campanha = 'Black Friday'$$, 'já foi', 'decisão não pode ser trocada');
select teste.falha($$update campanhas set motivo = 'x' where campanha = 'Black Friday'$$, 'já foi', 'motivo não muda depois da decisão');
reset role;

-- ---------- utilitário de permissões ----------
alter table campanhas add column if not exists coluna_teste text;
select public.reaplicar_permissoes_campanhas();
select teste.ok((select count(*) = 1 from information_schema.columns where table_name = 'campanhas_app' and column_name = 'coluna_teste'),
  'reaplicar_permissoes_campanhas() inclui coluna nova na view');
select teste.ok(not has_column_privilege('authenticated', 'public.campanhas', 'swile_cpf', 'select'), 'swile_cpf continua protegido depois de reaplicar');
select teste.ok(not has_function_privilege('authenticated', 'public.reaplicar_permissoes_campanhas()', 'execute'), 'app não executa reaplicar_permissoes_campanhas()');
alter table campanhas drop column coluna_teste cascade;
select public.reaplicar_permissoes_campanhas();

drop schema teste cascade;
\echo 'TODOS OS TESTES DO BANCO PASSARAM'
