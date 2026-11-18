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
! grep -q ' f$' /tmp/val1.txt
rodar -d campanhas_teste_novo -f testes.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p'

echo "== 2. Migração v1.3.1 → v2 (04 e 05 sobre o schema antigo)"
banco campanhas_teste_mig
rodar -d campanhas_teste_mig -f supabase-stub.sql 2>/dev/null
rodar -d campanhas_teste_mig -f v1-schema.sql >/dev/null 2>&1
# Uma campanha "antiga", gravada antes da migração, precisa sobreviver intacta.
rodar -d campanhas_teste_mig -c "insert into campanhas (cliente, laboratorio, campanha, status, investimento_lynkz, meta) values ('Cliente v1','Avert','Antiga','Aprovada', 500, 10000)" >/dev/null
rodar -d campanhas_teste_mig -f $SQL/migracoes/04-gestao-empresas-balconistas.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/05-data-decisao-fuso.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/06-validacao-v2.sql -t -A -F' ' | tee /tmp/val2.txt
! grep -q ' f$' /tmp/val2.txt
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from campanhas_app where campanha='Antiga' and empresa_id is null and status='Aprovada' and investimento_lynkz=500")" = 1
echo "ok  campanha da v1 continua igual depois da migração"
rodar -d campanhas_teste_mig -f testes.sql 2>&1 | sed -n 's/^psql.*NOTICE:  \(ok.*\)/\1/p; /PASSARAM/p'

echo "== 3. Rodar as migrações de novo não quebra (idempotência)"
rodar -d campanhas_teste_mig -f $SQL/migracoes/04-gestao-empresas-balconistas.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/05-data-decisao-fuso.sql >/dev/null 2>&1
echo "ok  04 e 05 rodam duas vezes"

echo "== 4. Rollback (05 e 04) volta ao formato da v1"
rodar -d campanhas_teste_mig -f $SQL/migracoes/05-rollback.sql >/dev/null 2>&1
rodar -d campanhas_teste_mig -f $SQL/migracoes/04-rollback.sql >/dev/null 2>&1
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from information_schema.columns where table_name='campanhas' and column_name in ('empresa_id','balconista_id')")" = 0
test "$(rodar -d campanhas_teste_mig -t -A -c "select to_regclass('public.empresas') is null")" = t
test "$(rodar -d campanhas_teste_mig -t -A -c "select count(*) from campanhas_app")" -ge 0
echo "ok  rollback remove gestão e mantém campanhas_app"

rodar -d postgres -c "drop database campanhas_teste_novo" -c "drop database campanhas_teste_mig"
echo "BANCO: TUDO OK"
