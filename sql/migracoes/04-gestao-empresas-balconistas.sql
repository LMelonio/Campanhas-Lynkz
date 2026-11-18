-- ============================================================
--  04 — GESTÃO DE EMPRESAS E BALCONISTAS (v2.0.0)
--
--  O que faz:
--  1. Cria as tabelas "empresas" e "balconistas".
--     - Todo usuário ATIVO lê, cadastra e edita.
--     - Ninguém apaga: o registro é desativado (ativo = false).
--     - CPF, nascimento, e-mail e telefone do balconista ficam visíveis a
--       todo usuário ativo (decisão de 18/11/2026).
--  2. Liga a campanha ao cadastro: colunas novas campanhas.empresa_id e
--     campanhas.balconista_id (opcionais). "cliente" continua existindo e
--     recebe o nome da empresa.
--  3. Trigger ao_vincular_campanha: o balconista precisa ser da empresa
--     da campanha.
--  4. Função reaplicar_permissoes_campanhas(): refaz a view campanhas_app
--     e as permissões por coluna a partir das colunas atuais. Os dados
--     Swile (swile_*) continuam visíveis só ao aprovador e ao solicitante.
--
--  Pré-requisitos: migrações 01 (parte A) e 02 (parte B) aplicadas.
--  Não altera nenhuma campanha existente (as colunas novas nascem vazias).
--  Para desfazer: 04-rollback.sql.
-- ============================================================
begin;
set local lock_timeout = '5s';

-- ---------- carimbo de alteração ----------
-- Preenche quem alterou e quando. Roda no banco: o app não consegue
-- mandar esses campos (não há permissão de coluna para eles).
create or replace function public.carimbar_atualizacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke execute on function public.carimbar_atualizacao() from public, anon, authenticated;

-- ---------- EMPRESAS ----------
create table if not exists public.empresas (
  id             bigint generated always as identity primary key,
  nome           text not null,
  cnpj           text,
  cidade         text,
  telefone       text,
  observacoes    text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid() references public.perfis(id) on delete set null,
  atualizado_em  timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null,
  constraint empresas_nome_valido     check (char_length(btrim(nome)) >= 2),
  constraint empresas_cnpj_valido     check (cnpj is null or cnpj ~ '^\d{14}$'),
  constraint empresas_telefone_valido check (telefone is null or telefone ~ '^\d{10,11}$')
);
-- CNPJ único só quando informado (várias empresas podem ficar sem CNPJ).
create unique index if not exists empresas_cnpj_unico on public.empresas (cnpj) where cnpj is not null;
create index if not exists idx_empresas_nome on public.empresas (lower(nome));

-- ---------- BALCONISTAS ----------
-- Mesma régua da constraint campanhas_swile_valido: os 5 dados são
-- obrigatórios e válidos, porque o balconista é quem recebe a premiação.
create table if not exists public.balconistas (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references public.empresas(id),
  nome_completo   text not null,
  cpf             text not null,
  data_nascimento date not null,
  email           text not null,
  telefone        text not null,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      uuid default auth.uid() references public.perfis(id) on delete set null,
  atualizado_em   timestamptz,
  atualizado_por  uuid references public.perfis(id) on delete set null,
  constraint balconistas_nome_valido     check (btrim(nome_completo) ~ '\S+\s+\S+'),
  constraint balconistas_cpf_valido      check (cpf ~ '^\d{11}$' and public.cpf_valido(cpf)),
  constraint balconistas_email_valido    check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint balconistas_telefone_valido check (telefone ~ '^\d{10,11}$'),
  constraint balconistas_empresa_cpf_unico unique (empresa_id, cpf)
);
create index if not exists idx_balconistas_empresa on public.balconistas (empresa_id);

drop trigger if exists ao_alterar_empresa on public.empresas;
create trigger ao_alterar_empresa
  before update on public.empresas
  for each row execute function public.carimbar_atualizacao();

drop trigger if exists ao_alterar_balconista on public.balconistas;
create trigger ao_alterar_balconista
  before update on public.balconistas
  for each row execute function public.carimbar_atualizacao();

-- ---------- SEGURANÇA DAS TABELAS NOVAS ----------
alter table public.empresas    enable row level security;
alter table public.balconistas enable row level security;

drop policy if exists empresas_leitura  on public.empresas;
drop policy if exists empresas_cadastro on public.empresas;
drop policy if exists empresas_edicao   on public.empresas;
create policy empresas_leitura  on public.empresas for select to authenticated using (public.eh_ativo());
create policy empresas_cadastro on public.empresas for insert to authenticated with check (public.eh_ativo());
create policy empresas_edicao   on public.empresas for update to authenticated
  using (public.eh_ativo()) with check (public.eh_ativo());

drop policy if exists balconistas_leitura  on public.balconistas;
drop policy if exists balconistas_cadastro on public.balconistas;
drop policy if exists balconistas_edicao   on public.balconistas;
create policy balconistas_leitura  on public.balconistas for select to authenticated using (public.eh_ativo());
create policy balconistas_cadastro on public.balconistas for insert to authenticated with check (public.eh_ativo());
create policy balconistas_edicao   on public.balconistas for update to authenticated
  using (public.eh_ativo()) with check (public.eh_ativo());
-- Nenhuma policy de delete: nada é apagado, só desativado.

revoke all on public.empresas, public.balconistas from anon;
revoke insert, update, delete, truncate, references, trigger on public.empresas, public.balconistas from authenticated;
grant select on public.empresas, public.balconistas to authenticated;
-- Só as colunas editáveis. Nunca id, criado_*, atualizado_* (carimbos do banco).
grant insert (nome, cnpj, cidade, telefone, observacoes, ativo) on public.empresas to authenticated;
grant update (nome, cnpj, cidade, telefone, observacoes, ativo) on public.empresas to authenticated;
-- O balconista não muda de empresa depois de cadastrado (o histórico das
-- campanhas aponta para ele): empresa_id entra no insert, não no update.
grant insert (empresa_id, nome_completo, cpf, data_nascimento, email, telefone, ativo) on public.balconistas to authenticated;
grant update (nome_completo, cpf, data_nascimento, email, telefone, ativo) on public.balconistas to authenticated;

-- ---------- CAMPANHA LIGADA AO CADASTRO ----------
alter table public.campanhas add column if not exists empresa_id    bigint references public.empresas(id);
alter table public.campanhas add column if not exists balconista_id bigint references public.balconistas(id);
create index if not exists idx_campanhas_empresa    on public.campanhas (empresa_id);
create index if not exists idx_campanhas_balconista on public.campanhas (balconista_id);

-- Antes de gravar a campanha: o balconista tem de ser da empresa, e
-- "cliente" recebe o nome oficial da empresa do cadastro.
create or replace function public.vincular_campanha()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.balconista_id is not null then
    if new.empresa_id is null then
      raise exception 'Escolha a empresa antes do balconista.';
    end if;
    if not exists (select 1 from balconistas b
                   where b.id = new.balconista_id and b.empresa_id = new.empresa_id) then
      raise exception 'O balconista escolhido não pertence a esta empresa.';
    end if;
  end if;
  if new.empresa_id is not null then
    new.cliente := coalesce((select e.nome from empresas e where e.id = new.empresa_id), new.cliente);
  end if;
  return new;
end $$;
revoke execute on function public.vincular_campanha() from public, anon, authenticated;

drop trigger if exists ao_vincular_campanha on public.campanhas;
create trigger ao_vincular_campanha
  before insert on public.campanhas
  for each row execute function public.vincular_campanha();

-- ---------- VIEW E PERMISSÕES POR COLUNA, A PARTIR DAS COLUNAS ATUAIS ----------
-- Coluna nova em campanhas? Basta rodar:  select public.reaplicar_permissoes_campanhas();
create or replace function public.reaplicar_permissoes_campanhas()
returns void language plpgsql security definer set search_path = public as $$
declare
  cols_view   text;
  cols_select text;
  cols_insert text;
begin
  select string_agg('c.' || quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols_view, cols_select
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not like 'swile\_%';

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_insert
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not in ('id','codigo','criado_em','aprovador_nome','data_decisao','motivo');

  -- View lida pelo app: os 5 campos swile_* só para quem pode ver.
  execute 'drop view if exists public.campanhas_app';
  execute format($v$
    create view public.campanhas_app with (security_invoker = true) as
    select %s,
           s.swile_nome_completo, s.swile_cpf, s.swile_data_nascimento,
           s.swile_email, s.swile_telefone,
           public.pode_ver_swile(c.solicitante_id) as swile_visivel
    from public.campanhas c
    left join lateral public.swile_da_campanha(c.id) s on true
  $v$, cols_view);
  execute 'revoke all on public.campanhas_app from public, anon, authenticated';
  execute 'grant select on public.campanhas_app to authenticated';

  -- Tabela: ninguém sem login; logado lê tudo menos swile_*.
  execute 'revoke all on public.campanhas from anon';
  execute 'revoke select, insert, update, delete, truncate, references, trigger on public.campanhas from authenticated';
  execute format('grant select (%s) on public.campanhas to authenticated', cols_select);
  -- Solicitar: todas as colunas, menos as que o banco carimba.
  execute format('grant insert (%s) on public.campanhas to authenticated', cols_insert);
  -- Decidir: só status e motivo.
  execute 'grant update (status, motivo) on public.campanhas to authenticated';
end $$;
revoke execute on function public.reaplicar_permissoes_campanhas() from public, anon, authenticated;

select public.reaplicar_permissoes_campanhas();

-- ---------- TEMPO REAL (tela de Gestão atualiza sozinha) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'empresas') then
      alter publication supabase_realtime add table public.empresas;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'balconistas') then
      alter publication supabase_realtime add table public.balconistas;
    end if;
  end if;
end $$;

commit;
