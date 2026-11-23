-- ============================================================
--  Testes da migração 07: clientes do Qlik e histórico das planilhas.
--  Rodados por tests/banco/rodar.sh depois de testes.sql.
-- ============================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t7;
grant usage on schema t7 to authenticated, anon, service_role;
create function t7.falha(cmd text, trecho text, nome text) returns void language plpgsql as $$
begin
  begin execute cmd;
  exception when others then
    if trecho = '' or position(lower(trecho) in lower(sqlerrm)) > 0 then raise notice 'ok  %', nome; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', nome, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter dado erro', nome;
end $$;
create function t7.ok(cond boolean, nome text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', nome; end if;
  raise notice 'ok  %', nome;
end $$;
create function t7.logar(uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', uid, false) $$;
grant execute on all functions in schema t7 to authenticated, anon, service_role;

insert into auth.users values ('77777777-7777-7777-7777-777777777777', 'ana.leticia@lynkz.com.br') on conflict do nothing;
update perfis set nome = 'Ana Letícia' where id = '77777777-7777-7777-7777-777777777777';

-- ---------- funções de apoio ----------
select t7.ok(cnpj_valido('11.222.333/0001-81') and not cnpj_valido('11111111111111') and not cnpj_valido('123'), 'cnpj_valido confere dígitos');
select t7.ok(normalizar_nome('Agropecuária São Luís Ltda.') = 'AGROPECUARIA SAO LUIS', 'normalizar_nome tira acento, ponto e LTDA');

-- ---------- cadastro pelo app depois da 07 ----------
set role authenticated;
select t7.logar('11111111-1111-1111-1111-111111111111');
select t7.falha($$insert into empresas (nome, cnpj) values ('CNPJ Errado', '11222333000182')$$, 'cnpj_dv', 'CNPJ com dígito errado é recusado no banco');
select t7.falha($$insert into empresas (nome, codigo_cliente) values ('Forjada', '999')$$, 'permission denied', 'app não grava código do cliente');
select t7.falha($$insert into empresas (nome, origem) values ('Forjada', 'qlik')$$, 'permission denied', 'app não grava origem');
insert into empresas (nome, cidade) values ('L Lazzarotti Reis LTDA', 'Araguaína');
insert into empresas (nome, cnpj, cidade) values ('Loja do CNPJ', '11444777000161', 'Caxias');
reset role;

-- ---------- carga do Qlik ----------
select t7.ok(not has_function_privilege('authenticated', 'public.importar_clientes_qlik(jsonb)', 'execute'), 'app não executa importar_clientes_qlik');
set role service_role;
select t7.logar('');
create temp table r1 as select importar_clientes_qlik($$[
  {"codigo":"1001","nome":"L LAZZAROTTI REIS LTDA","fantasia":"Pet Lazzarotti","documento":"","cidade":"ARAGUAINA","uf":"to","vendedor":"Leandra Almeida"},
  {"codigo":"1002","nome":"LOJA DO CNPJ COMERCIO","documento":"11.444.777/0001-61","cidade":"CAXIAS","uf":"MA"},
  {"codigo":"1003","nome":"CLIENTE NOVO DO QLIK","documento":"11222333000181","cidade":"SAO LUIS","uf":"MA","vendedor":"João Neto"},
  {"codigo":"1004","nome":"PESSOA FISICA","documento":"52998224725","cidade":"BACABAL","uf":"MA"},
  {"codigo":"","nome":"SEM CODIGO"}
]$$::jsonb) as r;
reset role;
select t7.ok((select r->>'novas' = '2' and r->>'vinculadas_por_nome' = '1' and r->>'vinculadas_por_cnpj' = '1'
                and r->>'atualizadas' = '2' and r->>'sem_codigo_ou_nome' = '1' from r1), 'Qlik: 2 novas, 1 por nome, 1 por CNPJ, 1 sem código');
select t7.ok((select codigo_cliente = '1001' and origem = 'qlik' and uf = 'TO' and nome = 'L LAZZAROTTI REIS LTDA' and nome_fantasia = 'Pet Lazzarotti'
                from empresas where cidade = 'ARAGUAINA'), 'empresa da planilha ganha o código pelo nome');
select t7.ok((select count(*) = 1 from empresas where cnpj = '11444777000161' and codigo_cliente = '1002'), 'empresa com o mesmo CNPJ é vinculada, sem duplicar');
select t7.ok((select cnpj is null from empresas where codigo_cliente = '1004'), 'CPF de pessoa física não entra como CNPJ');

-- rodar de novo não duplica
set role service_role;
create temp table r2 as select importar_clientes_qlik($$[{"codigo":"1003","nome":"CLIENTE NOVO DO QLIK ME","documento":"11222333000181","cidade":"PACO DO LUMIAR","uf":"MA"}]$$::jsonb) as r;
reset role;
select t7.ok((select r->>'novas' = '0' and r->>'atualizadas' = '1' from r2) and (select cidade = 'PACO DO LUMIAR' from empresas where codigo_cliente = '1003'),
  'segunda carga atualiza pelo código, sem duplicar');

-- app não altera nome/CNPJ/cidade de empresa do Qlik, mas altera telefone
set role authenticated;
select t7.logar('11111111-1111-1111-1111-111111111111');
select t7.falha($$update empresas set nome = 'Outro nome' where codigo_cliente = '1003'$$, 'vêm do qlik', 'app não troca o nome de empresa do Qlik');
update empresas set telefone = '9832221111', observacoes = 'Compra no começo do mês' where codigo_cliente = '1003';
select t7.ok((select telefone = '9832221111' from empresas where codigo_cliente = '1003'), 'app altera telefone e observações de empresa do Qlik');
reset role;

-- ---------- histórico das planilhas ----------
select t7.ok(not has_function_privilege('authenticated', 'public.importar_historico_planilha(jsonb)', 'execute'), 'app não executa importar_historico_planilha');
set role service_role;
create temp table h1 as select importar_historico_planilha($$[
  {"codigo":"H2610001","empresa":"L LAZZAROTTI REIS LTDA","solicitante":"Ana Letícia","laboratorio":"Avert","campanha":"Campanha de balconista Avert",
   "tipo":"Campanha de balconista","mecanica":"R$ 10,00 por produto","forma_pagamento":"Swile","meta":0,"valor":200,"observacoes":"NF 10879",
   "data_decisao":"2026-10-26","criado_em":"2026-10-26T12:00:00-03:00",
   "recebedor":{"nome":"Maria  das Graças","cpf":"529.982.247-25","nascimento":"1989-11-22","email":"Maria@X.com","telefone":"(63) 9810-8253"}},
  {"codigo":"H2609001","empresa":"Pets Village","solicitante":"Leandra Almeida","laboratorio":"Recurso próprio","campanha":"Hotel Pets Village",
   "tipo":"Combo de produtos","forma_pagamento":"Bonificação em produto","data_inicio":"2026-09-23","data_fim":"2026-09-24","meta":2,"valor":256.47,
   "aprovador":"Charles Machado","data_decisao":"2026-09-30","recebedor":null},
  {"codigo":"H2609002","empresa":"l lazzarotti reis ltda.","solicitante":"Leandra Almeida","laboratorio":"Avert","campanha":"Outra",
   "forma_pagamento":"Swile","valor":100,"data_decisao":"2026-09-30",
   "recebedor":{"nome":"Maria das Graças Outra","cpf":"52998224725","nascimento":"1990-01-01","email":"outra@x.com","telefone":"63981008253"}}
]$$::jsonb) as r;
reset role;
select t7.ok((select r->>'campanhas' = '3' and r->>'empresas_novas' = '1' and r->>'balconistas_novos' = '1' from h1), 'histórico: 3 campanhas, 1 empresa nova, 1 balconista');
select t7.ok((select count(*) = 3 from campanhas where importada and status = 'Aprovada'), 'campanhas entram Aprovadas e marcadas como importadas');
select t7.ok((select b.nome_completo = 'Maria das Graças' and b.email = 'maria@x.com' from balconistas b where cpf = '52998224725'
                and empresa_id = (select id from empresas where codigo_cliente = '1001')), 'balconista: vale o primeiro da lista (mais recente) e não é sobrescrito');
select t7.ok((select empresa_id is not null and balconista_id is not null and cliente = 'L LAZZAROTTI REIS LTDA'
                and solicitante_id = '77777777-7777-7777-7777-777777777777' from campanhas where codigo = 'H2610001'),
  'campanha ligada à empresa, ao balconista e ao perfil do solicitante');
select t7.ok((select swile_nome_completo = 'Maria das Graças Outra' and swile_data_nascimento = '1990-01-01' from campanhas where codigo = 'H2609002'),
  'campanha guarda o recebedor como estava na planilha');
select t7.ok((select origem = 'planilha' from empresas where nome = 'Pets Village'), 'empresa nova da planilha fica com origem planilha');
select t7.ok((select aprovador_nome = 'Charles Machado' and data_decisao = '2026-09-30' from campanhas where codigo = 'H2609001'), 'aprovador e data da decisão vêm da planilha');

set role service_role;
create temp table h2 as select importar_historico_planilha($$[{"codigo":"H2609001","empresa":"Pets Village","laboratorio":"x","campanha":"x"}]$$::jsonb) as r;
reset role;
select t7.ok((select r->>'ja_existiam' = '1' and r->>'campanhas' = '0' from h2), 'rodar o histórico de novo não duplica');

set role service_role;
select t7.falha($$select importar_historico_planilha('[{"codigo":"H2609099","empresa":"Pets Village","laboratorio":"Avert","campanha":"Ruim","forma_pagamento":"Swile","valor":10,"recebedor":{"nome":"Fulano","cpf":"11111111111","nascimento":"1990-01-01","email":"f@x.com","telefone":"98988887777"}}]'::jsonb)$$,
  'H2609099', 'linha com CPF inválido para a carga e diz qual linha');
reset role;
select t7.ok((select count(*) = 0 from campanhas where codigo = 'H2609099'), 'linha com erro não grava nada');

-- ---------- unir empresas duplicadas ----------
-- "Pets Village" (planilha) e um cadastro do Qlik para a mesma loja.
set role service_role;
select importar_clientes_qlik('[{"codigo":"2001","nome":"PETS VILLAGE HOTEL LTDA","cidade":"SAO LUIS","uf":"MA"}]'::jsonb);
reset role;
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Joana Hotel', '39053344705', '1990-01-01', 'j@x.com', '98988887777' from empresas where codigo_cliente = '2001';
insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
  select id, 'Joana Hotel Antiga', '39053344705', '1990-01-01', 'j2@x.com', '98988887777' from empresas where nome = 'Pets Village';
update campanhas set balconista_id = (select b.id from balconistas b join empresas e on e.id = b.empresa_id where e.nome = 'Pets Village')
  where codigo = 'H2609001';
select t7.ok(not has_function_privilege('authenticated', 'public.unir_empresas(bigint, bigint)', 'execute'), 'app não executa unir_empresas');
create temp table u1 as select unir_empresas((select id from empresas where nome = 'Pets Village'), (select id from empresas where codigo_cliente = '2001')) as r;
select t7.ok((select r->>'campanhas_movidas' = '1' and r->>'balconistas_movidos' = '1' from u1), 'unir: 1 campanha e 1 balconista');
select t7.ok((select e.codigo_cliente = '2001' and b.nome_completo = 'Joana Hotel' from campanhas c join empresas e on e.id = c.empresa_id
                join balconistas b on b.id = c.balconista_id where c.codigo = 'H2609001'), 'campanha passa para a empresa do Qlik e para o balconista dela');
select t7.ok((select not ativo and observacoes like '%Unida à empresa #%' from empresas where nome = 'Pets Village'), 'empresa que sai fica desativada, sem apagar');
select t7.falha($$select unir_empresas(1, 1)$$, 'diferentes', 'unir a mesma empresa é recusado');

-- coordenador vê as importadas pela view, com o selo
set role authenticated;
select t7.logar('11111111-1111-1111-1111-111111111111');
select t7.ok((select count(*) = 3 from campanhas_app where importada), 'app lê "importada" pela view');
select t7.falha($$insert into campanhas (cliente, laboratorio, campanha, solicitante_id, status, importada)
  values ('X','Avert','Y', auth.uid(), 'Pendente', true)$$, 'permission denied', 'app não marca campanha como importada');
reset role;
select t7.logar('');

drop schema t7 cascade;
\echo 'TESTES DA 07 PASSARAM'
