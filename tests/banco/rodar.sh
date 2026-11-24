#!/usr/bin/env bash
# Testes do banco num PostgreSQL local (15+). Cria bancos descartáveis.
#   uso:  tests/banco/rodar.sh            (usa "psql" com o usuário atual)
#         PSQL="sudo -u postgres psql" tests/banco/rodar.sh
set -euo pipefail
cd "$(dirname "$0")"
SQL=../../sql
PSQL=${PSQL:-psql}
rodar(){ $PSQL -v ON_ERROR_STOP=1 -q -X "$@"; }
banco(){ rodar -d postgres -c "drop database if exists $1" -c "create database $1"; }

echo "== 1. Instalação nova (sql/schema.sql)"
banco campanhas_teste_novo
rodar -d campanhas_teste_novo -f supabase-stub.sql 2>/dev/null
rodar -d campanhas_teste_novo -f $SQL/schema.sql >/dev/null 2>&1
rodar -d campanhas_teste_novo -f $SQL/migracoes/06-validacao-v2.sql -t -A -F' ' | tee /tmp/val1.txt
# Cada linha sai como "12 f Nome do teste": o f/t é a 2ª coluna. Um "! grep" não
# para o script com set -e (o bash ignora comandos com !), por isso o if explícito.
if grep -q '^[0-9]* f ' /tmp/val1.txt; then echo "FALHOU: validação 06 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_novo -f $SQL/migracoes/07-validacao.sql -t -A -F' ' | tee /tmp/val7a.txt
if grep -q '^[0-9]* f ' /tmp/val7a.txt; then echo "FALHOU: validação 07 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes-07.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_novo -f $SQL/migracoes/08-validacao.sql -t -A -F' ' | tee /tmp/val8a.txt
if grep -q '^[0-9]* f ' /tmp/val8a.txt; then echo "FALHOU: validação 08 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes-08.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_novo -f $SQL/migracoes/10-validacao.sql -t -A -F' ' | tee /tmp/val10a.txt
if grep -q '^[0-9]* f ' /tmp/val10a.txt; then echo "FALHOU: validação 10 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes-10.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_novo -f $SQL/migracoes/11-validacao.sql -t -A -F' ' | tee /tmp/val11a.txt
if grep -q '^[0-9]* f ' /tmp/val11a.txt; then echo "FALHOU: validação 11 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes-11.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_novo -f $SQL/migracoes/12-validacao.sql -t -A -F' ' | tee /tmp/val12a.txt
if grep -q '^[0-9]* f ' /tmp/val12a.txt; then echo "FALHOU: validação 12 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes-12.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_novo -f $SQL/migracoes/13-validacao.sql -t -A -F' ' | tee /tmp/val13a.txt
if grep -q '^[0-9]* f ' /tmp/val13a.txt; then echo "FALHOU: validação 13 com linha false"; exit 1; fi
rodar -d campanhas_teste_novo -f testes-13.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'

echo "== 2. Migração v1.3.1 → v2 (04 e 05 sobre o schema antigo)"
banco campanhas_teste_mig
rodar -d campanhas_teste_mig -f supabase-stub.sql 2>/dev/null
rodar -d campanhas_teste_mig -f v1-schema.sql >/dev/null 2>&1
# Uma campanha "antiga", gravada antes da migração, precisa sobreviver intacta.
rodar -d campanhas_teste_mig -c "insert into campanhas (cliente, laboratorio, campanha, status, investimento_lynkz, meta) values ('Cliente v1','Avert','Antiga','Aprovada', 500, 10000)" >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/04-gestao-empresas-balconistas.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/05-data-decisao-fuso.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/07-clientes-qlik-e-historico.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/08-notas-fiscais.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/09-marca-da-consulta.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/10-seguranca.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/11-enviar-campanha.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/12-usuarios-e-balconistas.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/13-devolucoes-da-consulta.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/06-validacao-v2.sql -t -A -F' ' | tee /tmp/val2.txt
# Cada linha sai como "12 f Nome do teste": o f/t é a 2ª coluna. Um "! grep" não
# para o script com set -e (o bash ignora comandos com !), por isso o if explícito.
if grep -q '^[0-9]* f ' /tmp/val2.txt; then echo "FALHOU: validação 06 com linha false"; exit 1; fi
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from campanhas_app where campanha='Antiga' and empresa_id is null and status='Aprovada' and investimento_lynkz=500")" = 1
echo "ok  campanha da v1 continua igual depois da migração"
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from campanhas_app where campanha='Antiga' and importada = false")" = 1
echo "ok  campanha antiga continua como não importada depois da 07"
rodar -d campanhas_teste_mig -f testes.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_mig -f $SQL/migracoes/07-validacao.sql -t -A -F' ' | tee /tmp/val7b.txt
if grep -q '^[0-9]* f ' /tmp/val7b.txt; then echo "FALHOU: validação 07 com linha false"; exit 1; fi
rodar -d campanhas_teste_mig -f testes-07.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_mig -f $SQL/migracoes/08-validacao.sql -t -A -F' ' | tee /tmp/val8b.txt
if grep -q '^[0-9]* f ' /tmp/val8b.txt; then echo "FALHOU: validação 08 com linha false"; exit 1; fi
rodar -d campanhas_teste_mig -f testes-08.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_mig -f $SQL/migracoes/10-validacao.sql -t -A -F' ' | tee /tmp/val10b.txt
if grep -q '^[0-9]* f ' /tmp/val10b.txt; then echo "FALHOU: validação 10 com linha false"; exit 1; fi
rodar -d campanhas_teste_mig -f testes-10.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_mig -f $SQL/migracoes/11-validacao.sql -t -A -F' ' | tee /tmp/val11b.txt
if grep -q '^[0-9]* f ' /tmp/val11b.txt; then echo "FALHOU: validação 11 com linha false"; exit 1; fi
rodar -d campanhas_teste_mig -f testes-11.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_mig -f $SQL/migracoes/12-validacao.sql -t -A -F' ' | tee /tmp/val12b.txt
if grep -q '^[0-9]* f ' /tmp/val12b.txt; then echo "FALHOU: validação 12 com linha false"; exit 1; fi
rodar -d campanhas_teste_mig -f testes-12.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'
rodar -d campanhas_teste_mig -f $SQL/migracoes/13-validacao.sql -t -A -F' ' | tee /tmp/val13b.txt
if grep -q '^[0-9]* f ' /tmp/val13b.txt; then echo "FALHOU: validação 13 com linha false"; exit 1; fi
rodar -d campanhas_teste_mig -f testes-13.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'

echo "== 2b. Migração a partir do banco de produção: v1 SEM a parte B (02) → só 04 + 05"
banco campanhas_teste_semb
rodar -d campanhas_teste_semb -f supabase-stub.sql 2>/dev/null
rodar -d campanhas_teste_semb -f v1-sem-parteB-schema.sql >/dev/null 2>&1
test "$(rodar -d campanhas_teste_semb -t -A -c "select to_regclass('public.campanhas_app') is null and to_regprocedure('public.swile_da_campanha(bigint)') is null")" = t
echo "ok  banco de partida sem a parte B (sem campanhas_app e sem swile_da_campanha)"
# Campanha Swile antiga, gravada antes da migração: precisa sobreviver e ficar protegida.
rodar -d campanhas_teste_semb -c "insert into campanhas (cliente, laboratorio, campanha, status, forma_pagamento, investimento_lynkz, meta, swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone) values ('Cliente v1','Avert','Antiga Swile','Aprovada','Swile', 500, 10000, 'Maria Antiga', '52998224725', '1990-01-01', 'm@x.com', '98988887777')" >/dev/null
rodar -d campanhas_teste_semb -f $SQL/migracoes/04-gestao-empresas-balconistas.sql >/dev/null
rodar -d campanhas_teste_semb -f $SQL/migracoes/05-data-decisao-fuso.sql >/dev/null
rodar -d campanhas_teste_semb -f $SQL/migracoes/06-validacao-v2.sql -t -A -F' ' | tee /tmp/val3.txt
if grep -q '^[0-9]* f ' /tmp/val3.txt; then echo "FALHOU: validação 06 com linha false"; exit 1; fi
test "$(rodar -d campanhas_teste_semb -t -A -c "select count(*) from campanhas_app where campanha='Antiga Swile' and investimento_lynkz=500 and status='Aprovada'")" = 1
echo "ok  campanha Swile da v1 continua igual depois da 04"
test "$(rodar -d campanhas_teste_semb -t -A -c "select has_column_privilege('authenticated','public.campanhas','swile_cpf','SELECT')")" = f
echo "ok  swile_cpf da campanha antiga protegido (sem leitura direta)"
rodar -d campanhas_teste_semb -f testes.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p; /ERROR/p; /FALHOU/p'

echo "== 3. Rodar as migrações de novo não quebra (idempotência)"
rodar -d campanhas_teste_mig -f $SQL/migracoes/04-gestao-empresas-balconistas.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/05-data-decisao-fuso.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/07-clientes-qlik-e-historico.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/08-notas-fiscais.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/09-marca-da-consulta.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/10-seguranca.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/11-enviar-campanha.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/12-usuarios-e-balconistas.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/13-devolucoes-da-consulta.sql >/dev/null
echo "ok  04, 05, 07, 08, 09, 10, 11, 12 e 13 rodam duas vezes"

echo "== 4. Rollback (13, 12, 11, 10, 09, 08, 07, 05 e 04) volta ao formato da v1"
rodar -d campanhas_teste_mig -f $SQL/migracoes/13-rollback.sql >/dev/null
test "$(rodar -d campanhas_teste_mig -t -A -c "select not exists (select 1 from information_schema.columns where table_name = 'campanhas' and column_name like 'compras_devol%') and position('compras_devolvidas' in pg_get_functiondef('public.enviar_campanha(jsonb,jsonb,jsonb)'::regprocedure)) = 0 and exists (select 1 from campanhas)")" = t
echo "ok  rollback da 13 tira as colunas de devolução, volta enviar_campanha da 11 e mantém as campanhas"
rodar -d campanhas_teste_mig -f $SQL/migracoes/12-rollback.sql >/dev/null
test "$(rodar -d campanhas_teste_mig -t -A -c "select to_regprocedure('public.definir_perfil(uuid,text,boolean,text)') is null and not exists (select 1 from pg_trigger where tgname = 'ao_limitar_balconistas_empresa')")" = t
echo "ok  rollback da 12 remove a função e o limite e mantém os dados"
rodar -d campanhas_teste_mig -f $SQL/migracoes/11-rollback.sql >/dev/null
test "$(rodar -d campanhas_teste_mig -t -A -c "select to_regprocedure('public.enviar_campanha(jsonb,jsonb,jsonb)') is null")" = t
echo "ok  rollback da 11 remove a função e mantém os dados"
rodar -d campanhas_teste_mig -f $SQL/migracoes/10-rollback.sql >/dev/null
test "$(rodar -d campanhas_teste_mig -t -A -c "select to_regclass('public.auditoria_perfis') is null")" = t
echo "ok  rollback da 10 tira as regras de segurança e mantém os dados"
rodar -d campanhas_teste_mig -f $SQL/migracoes/09-rollback.sql >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/08-rollback.sql >/dev/null
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from information_schema.tables where table_name='campanha_notas'")" = 0
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) > 0 from campanhas")" = t
echo "ok  rollback da 08 tira as notas e mantém as campanhas"
rodar -d campanhas_teste_mig -f $SQL/migracoes/07-rollback.sql >/dev/null
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from information_schema.columns where table_name='empresas' and column_name in ('codigo_cliente','origem')")" = 0
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) > 0 from campanhas")" = t
echo "ok  rollback da 07 tira as colunas novas e mantém as campanhas"
rodar -d campanhas_teste_mig -f $SQL/migracoes/05-rollback.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/04-rollback.sql >/dev/null 2>&1
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from information_schema.columns where table_name='campanhas' and column_name in ('empresa_id','balconista_id')")" = 0
test "$(rodar -d campanhas_teste_mig -t -A -c "select to_regclass('public.empresas') is null")" = t
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from campanhas_app")" -ge 0
echo "ok  rollback remove gestão e mantém campanhas_app"

rodar -d postgres -c "drop database campanhas_teste_novo" -c "drop database campanhas_teste_mig" -c "drop database campanhas_teste_semb"
echo "BANCO: TUDO OK"
