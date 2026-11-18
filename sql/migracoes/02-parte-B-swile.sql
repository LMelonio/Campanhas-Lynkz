-- ============================================================
--  02 — PARTE B: dados pessoais do recebedor Swile
--
--  Campos protegidos: swile_nome_completo, swile_cpf,
--  swile_data_nascimento, swile_email, swile_telefone.
--
--  Quem vê: o aprovador (ativo) e o coordenador que fez a solicitação
--  (ativo). Os demais continuam vendo a campanha, mas esses 5 campos
--  chegam vazios.
--
--  Como:
--  1. A permissão de LER essas 5 colunas na tabela campanhas é retirada
--     do papel "authenticated". Consulta direta (console do navegador,
--     API) passa a dar "permission denied". O canal de tempo real do
--     Supabase checa a mesma permissão coluna a coluna
--     (realtime.apply_rls → has_column_privilege) e para de enviar esses
--     campos nos eventos.
--  2. O app passa a ler a view campanhas_app, que devolve os 5 campos
--     só para quem pode vê-los, mais a coluna swile_visivel (true/false).
--  3. Gravar continua igual: o coordenador ainda envia os dados Swile ao
--     criar a campanha.
--
--  PRÉ-REQUISITOS:
--  - Parte A aplicada (usa eh_ativo()).
--  - App 1.3.1 publicado e aberto pelo menos uma vez nos celulares.
--    O app 1.3.0 lê a tabela com "select *" e PARA DE CARREGAR depois
--    desta parte.
--  - Postgres 15 ou mais (consulta D6 do diagnóstico).
--
--  Não altera nenhuma linha de dados. Para desfazer:
--  02-parte-B-rollback.sql.
-- ============================================================
begin;
-- Se alguém estiver usando a tabela e ela não liberar em 5 s, desiste sem
-- aplicar nada (em vez de ficar na fila travando o app de todo mundo).
set local lock_timeout = '5s';

-- Quem pode ver os dados Swile de uma campanha.
create or replace function public.pode_ver_swile(p_solicitante uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_aprovador() or (p_solicitante = auth.uid() and public.eh_ativo());
$$;

-- Devolve os 5 campos de UMA campanha, só se quem pergunta puder ver.
-- Roda com permissão do dono (lê as colunas protegidas), mas filtra.
create or replace function public.swile_da_campanha(p_id bigint)
returns table (
  swile_nome_completo   text,
  swile_cpf             text,
  swile_data_nascimento date,
  swile_email           text,
  swile_telefone        text
)
language sql stable security definer set search_path = public as $$
  select c.swile_nome_completo, c.swile_cpf, c.swile_data_nascimento, c.swile_email, c.swile_telefone
  from campanhas c
  where c.id = p_id and public.pode_ver_swile(c.solicitante_id);
$$;

revoke execute on function public.pode_ver_swile(uuid)   from public, anon;
revoke execute on function public.swile_da_campanha(bigint) from public, anon;
grant  execute on function public.pode_ver_swile(uuid)   to authenticated;
grant  execute on function public.swile_da_campanha(bigint) to authenticated;

-- View lida pelo app. security_invoker = true: as regras de linha da
-- tabela (só usuário ativo enxerga) continuam valendo para quem consulta.
-- As colunas são montadas a partir da tabela real, para não depender de
-- o schema.sql estar idêntico ao banco.
do $$
declare cols text;
begin
  select string_agg('c.' || quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not like 'swile\_%';

  execute 'drop view if exists public.campanhas_app';
  execute format($v$
    create view public.campanhas_app with (security_invoker = true) as
    select %s,
           s.swile_nome_completo, s.swile_cpf, s.swile_data_nascimento,
           s.swile_email, s.swile_telefone,
           public.pode_ver_swile(c.solicitante_id) as swile_visivel
    from public.campanhas c
    left join lateral public.swile_da_campanha(c.id) s on true
  $v$, cols);
end $$;

revoke all    on public.campanhas_app from public, anon, authenticated;
grant  select on public.campanhas_app to authenticated;

-- Leitura direta da tabela: todas as colunas menos as 5 do Swile.
revoke select on public.campanhas from authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not like 'swile\_%';
  execute format('grant select (%s) on public.campanhas to authenticated', cols);
end $$;

commit;
