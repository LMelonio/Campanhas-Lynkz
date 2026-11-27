-- LYNKZ Campanhas — instalação nova: cole no SQL Editor do Supabase e rode.
-- Banco existente: rode só as migrações novas de migracoes/, em ordem.

-- ---------- PERFIS (quem é quem) ----------
create table if not exists perfis (
  id          uuid primary key references auth.users on delete cascade,
  email       text unique not null,
  nome        text not null,
  papel       text not null default 'coordenador'
              check (papel in ('aprovador','coordenador')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém faz o primeiro login.
-- Todo mundo entra como coordenador; você promove a aprovador na mão.
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, email, nome)
  values (new.id, new.email, split_part(new.email,'@',1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- ---------- CAMPANHAS ----------
create table if not exists campanhas (
  id                bigserial primary key,
  codigo            text unique not null default 'C'||to_char(now(),'YYMMDD')||lpad(floor(random()*10000)::text,4,'0'),

  cliente           text not null,
  laboratorio       text not null,
  campanha          text not null,
  tipo              text,
  mecanica          text,

  investimento_lynkz     numeric(14,2) not null default 0 check (investimento_lynkz >= 0),
  investimento_industria numeric(14,2) not null default 0 check (investimento_industria >= 0),
  forma_pagamento   text,

  data_inicio       date,
  data_fim          date,
  tipo_meta         text,
  meta              numeric(14,2) not null default 0 check (meta >= 0),

  rebate_pct        numeric(6,3)  not null default 0 check (rebate_pct >= 0),
  rebate_teto       numeric(14,2) not null default 0 check (rebate_teto >= 0),
  rebate_base       text,
  rebate_gatilho    text,

  observacoes       text,

  status            text not null default 'Pendente'
                    check (status in ('Pendente','Aprovada','Reprovada')),
  solicitante_id    uuid references perfis(id) on delete set null,
  solicitante_nome  text,
  aprovador_nome    text,
  data_decisao      date,
  motivo            text,

  criado_em         timestamptz not null default now(),

  constraint periodo_valido check (data_fim is null or data_inicio is null or data_fim >= data_inicio)
);

create index if not exists idx_campanhas_status on campanhas (status, criado_em);
create index if not exists idx_campanhas_solicitante on campanhas (solicitante_id);

-- Quem já tinha o banco criado com a coluna antiga "investimento" (só verba LYNKZ)
-- ganha as duas colunas novas sem perder dado: o valor antigo vira investimento_lynkz.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='campanhas' and column_name='investimento')
     and not exists (select 1 from information_schema.columns where table_name='campanhas' and column_name='investimento_lynkz') then
    alter table campanhas rename column investimento to investimento_lynkz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='campanhas' and column_name='investimento_industria') then
    alter table campanhas add column investimento_industria numeric(14,2) not null default 0 check (investimento_industria >= 0);
  end if;
end $$;

-- ---------- SWILE: DADOS DE QUEM VAI RECEBER O VALOR ----------
-- Quando forma_pagamento = 'Swile', a campanha precisa registrar quem vai
-- receber o pagamento. CPF e telefone são gravados SÓ COM DÍGITOS (sem
-- ponto, traço, barra ou parênteses) — a máscara de digitação é só visual,
-- feita no app (js/ui/campos.js); o banco sempre recebe e guarda dígito puro.
alter table campanhas add column if not exists swile_nome_completo   text;
alter table campanhas add column if not exists swile_cpf             text;
alter table campanhas add column if not exists swile_data_nascimento date;
alter table campanhas add column if not exists swile_email           text;
alter table campanhas add column if not exists swile_telefone        text;

-- Valida CPF pelo algoritmo oficial dos dígitos verificadores (módulo 11)
-- e rejeita sequências repetidas (000.000.000-00, 111.111.111-11 etc.),
-- que passam na conta de dígitos mas não são CPFs reais.
create or replace function public.cpf_valido(cpf text)
returns boolean
language plpgsql
immutable
as $$
declare
  d    text := regexp_replace(coalesce(cpf,''), '\D', '', 'g');
  n    int[];
  soma int; resto int; dv1 int; dv2 int; k int; peso int;
begin
  if length(d) <> 11 then return false; end if;
  if d ~ '^(\d)\1{10}$' then return false; end if;

  -- "g" aqui é só o apelido da coluna do generate_series; "k" é a variável
  -- de loop mais abaixo. Nomes iguais aos das declarações do começo da
  -- função dão erro 42702 (column reference is ambiguous) — por isso os
  -- dois têm nome próprio, sem repetir "i".
  n := array(select substring(d from g for 1)::int from generate_series(1,11) g);

  soma := 0; peso := 10;
  for k in 1..9 loop
    soma := soma + n[k]*peso;
    peso := peso - 1;
  end loop;
  resto := soma % 11;
  dv1 := case when resto < 2 then 0 else 11 - resto end;
  if dv1 <> n[10] then return false; end if;

  soma := 0; peso := 11;
  for k in 1..10 loop
    soma := soma + n[k]*peso;
    peso := peso - 1;
  end loop;
  resto := soma % 11;
  dv2 := case when resto < 2 then 0 else 11 - resto end;
  if dv2 <> n[11] then return false; end if;

  return true;
end;
$$;

-- Só permite gravar (inserir ou atualizar) uma campanha com forma_pagamento
-- 'Swile' (string exata — é o valor exato da opção em config.js PAGTO,
-- amarrada aqui) se os cinco campos do recebedor estiverem preenchidos e
-- válidos. Qualquer outra forma de pagamento passa livre, sem exigir nada.
--
-- NOT VALID: campanhas Swile antigas, cadastradas antes desta regra existir,
-- não são checadas retroativamente — mas qualquer INSERT ou UPDATE novo
-- (inclusive nelas) já é bloqueado se os dados não baterem. Veja a consulta
-- logo abaixo para achar as antigas incompletas.
alter table campanhas drop constraint if exists campanhas_swile_valido;
alter table campanhas
  add constraint campanhas_swile_valido
  check (
    forma_pagamento is distinct from 'Swile'
    or (
      swile_nome_completo is not null and trim(swile_nome_completo) ~ '\S+\s+\S+'
      and swile_cpf is not null and public.cpf_valido(swile_cpf)
      and swile_data_nascimento is not null
      and swile_email is not null and swile_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and swile_telefone is not null and swile_telefone ~ '^\d{10,11}$'
    )
  ) not valid;
  -- Data no futuro não é barrada aqui de propósito: essa regra fica só no
  -- app (errosRecebedor() em js/lib/regras.js). O banco só exige que a data exista.

-- Não precisa rodar agora — é só para você mapear se há campanhas Swile
-- antigas que ainda não atendem à regra nova:
--
-- select id, codigo, cliente, criado_em
-- from campanhas
-- where forma_pagamento = 'Swile'
--   and not (
--     swile_nome_completo is not null and trim(swile_nome_completo) ~ '\S+\s+\S+'
--     and swile_cpf is not null and public.cpf_valido(swile_cpf)
--     and swile_data_nascimento is not null
--     and swile_email is not null and swile_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
--     and swile_telefone is not null and swile_telefone ~ '^\d{10,11}$'
--   );
--
-- Depois de completar (ou decidir não completar) essas linhas, você pode
-- validar a constraint de vez com:
-- alter table campanhas validate constraint campanhas_swile_valido;

-- ---------- SEGURANÇA (quem pode fazer o quê) ----------
-- Mesmas regras de migracoes/01, 02, 04 e 05. Se mudar aqui,
-- mude lá também (e vice-versa).
alter table perfis enable row level security;
alter table campanhas enable row level security;

-- Descobre se o usuário logado é o aprovador, sem consultar a tabela
-- de dentro da própria política (evita recursão).
create or replace function public.eh_aprovador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and papel = 'aprovador' and ativo);
$$;

-- Usuário com ativo = false não lê nem cria nada — no banco, não só na tela.
create or replace function public.eh_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo);
$$;
revoke execute on function public.eh_ativo() from public, anon;
grant  execute on function public.eh_ativo() to authenticated;

-- O desativado ainda lê o próprio perfil (é isso que mostra a tela
-- "Acesso desativado"), mas não vê os outros.
drop policy if exists perfis_leitura on perfis;
create policy perfis_leitura on perfis
  for select to authenticated using (id = auth.uid() or public.eh_ativo());

-- Ninguém edita perfil pela API (nem o próprio): a gerência edita pelo
-- Table Editor do Supabase. Antes existia "perfis_edita_proprio", que
-- deixava um desativado se reativar.
drop policy if exists perfis_edita_proprio on perfis;

-- Todo mundo ATIVO enxerga todas as campanhas (o extrato é compartilhado).
-- Os dados pessoais do recebedor Swile são protegidos por coluna (abaixo).
drop policy if exists campanhas_leitura on campanhas;
create policy campanhas_leitura on campanhas
  for select to authenticated using (public.eh_ativo());

-- Qualquer um ativo pode solicitar, mas sempre em nome de si mesmo,
-- e sempre como Pendente. Ninguém nasce aprovado.
drop policy if exists campanhas_solicita on campanhas;
create policy campanhas_solicita on campanhas
  for insert to authenticated
  with check (solicitante_id = auth.uid() and status = 'Pendente' and public.eh_ativo());

-- Só o aprovador decide.
drop policy if exists campanhas_decide on campanhas;
create policy campanhas_decide on campanhas
  for update to authenticated
  using (public.eh_aprovador())
  with check (public.eh_aprovador());

-- Ninguém apaga nada: o registro é permanente (não existe policy de delete
-- e a permissão de delete/truncate é retirada abaixo).

-- ---------- PERMISSÕES DE COLUNA ----------
-- Visitante sem login não tem acesso nenhum às tabelas.
revoke all on public.perfis, public.campanhas from anon;
revoke insert, update, delete, truncate on public.perfis    from authenticated;
revoke insert, update, delete, truncate on public.campanhas from authenticated;

-- As permissões por coluna (select sem swile_*, insert sem carimbos,
-- update só de status e motivo) são aplicadas no fim deste arquivo por
-- reaplicar_permissoes_campanhas(), já com as colunas da v2.

-- ---------- TRAVA DE INTEGRIDADE ----------
-- Impede que uma campanha já decidida seja alterada de novo (status e
-- motivo), e carimba quem decidiu e quando. Vale mesmo direto no banco.
create or replace function public.registrar_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'Pendente' then
    if new.status <> old.status then
      raise exception 'Esta campanha já foi %. A decisão não pode ser alterada.', old.status;
    end if;
    if new.motivo is distinct from old.motivo then
      raise exception 'Esta campanha já foi %. O motivo não pode ser alterado.', old.status;
    end if;
  end if;
  if new.status <> old.status then
    new.data_decisao := (now() at time zone 'America/Fortaleza')::date;  -- fuso do Maranhão (migração 05)
    new.aprovador_nome := coalesce((select nome from perfis where id = auth.uid()), 'Aprovador');
    if new.status = 'Reprovada' and coalesce(trim(new.motivo),'') = '' then
      raise exception 'Reprova exige motivo.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ao_decidir on campanhas;
create trigger ao_decidir
  before update on campanhas
  for each row execute function public.registrar_decisao();

-- Nome do solicitante vem do perfil de quem está logado, não do app.
-- Inserções feitas pelo SQL Editor (sem usuário logado) ficam como vierem.
create or replace function public.carimbar_solicitacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.solicitante_nome := coalesce((select nome from perfis where id = auth.uid()), new.solicitante_nome);
  end if;
  return new;
end $$;

drop trigger if exists ao_solicitar on campanhas;
create trigger ao_solicitar
  before insert on campanhas
  for each row execute function public.carimbar_solicitacao();

-- ---------- ATUALIZAÇÃO EM TEMPO REAL ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campanhas') then
    alter publication supabase_realtime add table campanhas;
  end if;
end $$;

-- ---------- DADOS PESSOAIS DO RECEBEDOR SWILE ----------
-- Só o aprovador e quem solicitou veem os 5 campos swile_*. A leitura
-- dessas colunas na tabela é retirada de todos; o app lê a view
-- campanhas_app, que entrega os campos só a quem pode. O tempo real do
-- Supabase checa a mesma permissão por coluna e não envia esses campos.
-- Coluna nova em campanhas? Rode  select public.reaplicar_permissoes_campanhas();
create or replace function public.pode_ver_swile(p_solicitante uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_aprovador() or (p_solicitante = auth.uid() and public.eh_ativo());
$$;

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

revoke execute on function public.pode_ver_swile(uuid)      from public, anon;
revoke execute on function public.swile_da_campanha(bigint) from public, anon;
grant  execute on function public.pode_ver_swile(uuid)      to authenticated;
grant  execute on function public.swile_da_campanha(bigint) to authenticated;

-- ============================================================
--  v2 — EMPRESAS, BALCONISTAS, VIEW E PERMISSÕES
--  (mesmo conteúdo de migracoes/04-gestao-empresas-balconistas.sql)
-- ============================================================
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


-- ============================================================
--  v2.3 — CLIENTES DO QLIK E HISTÓRICO DAS PLANILHAS
--  (mesmo conteúdo de migracoes/07-clientes-qlik-e-historico.sql)
-- ============================================================

-- ---------- funções de apoio ----------
-- CNPJ: dígitos verificadores (módulo 11) e sem sequência repetida.
-- Mesma regra de cnpjValido() em public/js/lib/regras.js.
create or replace function public.cnpj_valido(cnpj text)
returns boolean language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(cnpj,''), '\D', '', 'g');
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int; resto int; dv1 int; dv2 int; k int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  soma := 0;
  for k in 1..12 loop soma := soma + substring(d from k for 1)::int * pesos1[k]; end loop;
  resto := soma % 11; dv1 := case when resto < 2 then 0 else 11 - resto end;
  if dv1 <> substring(d from 13 for 1)::int then return false; end if;
  soma := 0;
  for k in 1..13 loop soma := soma + substring(d from k for 1)::int * pesos2[k]; end loop;
  resto := soma % 11; dv2 := case when resto < 2 then 0 else 11 - resto end;
  return dv2 = substring(d from 14 for 1)::int;
end $$;

-- Nome para comparar cadastros: sem acento, sem pontuação, maiúsculo e sem
-- LTDA/ME/EPP/EIRELI/SA. "L Lazzarotti Reis LTDA" = "L LAZZAROTTI REIS LTDA".
create or replace function public.normalizar_nome(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               upper(translate(coalesce(t,''),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
               '[^A-Z0-9 ]', ' ', 'g'),
             '\m(LTDA|ME|EPP|EIRELI|SA|S A)\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- ---------- EMPRESAS: dados do Qlik ----------
alter table public.empresas add column if not exists codigo_cliente  text;
alter table public.empresas add column if not exists nome_fantasia   text;
alter table public.empresas add column if not exists uf              text;
alter table public.empresas add column if not exists vendedor        text;
alter table public.empresas add column if not exists origem          text not null default 'app';
alter table public.empresas add column if not exists sincronizado_em timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'empresas_origem_valida') then
    alter table public.empresas add constraint empresas_origem_valida check (origem in ('app','qlik','planilha'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_cnpj_dv') then
    alter table public.empresas add constraint empresas_cnpj_dv check (cnpj is null or public.cnpj_valido(cnpj)) not valid;
  end if;
end $$;
create unique index if not exists empresas_codigo_cliente_unico on public.empresas (codigo_cliente) where codigo_cliente is not null;
create index if not exists idx_empresas_nome_normalizado on public.empresas (public.normalizar_nome(nome));

-- Nome, CNPJ e cidade de empresa do Qlik vêm do Qlik. Pelo app (usuário
-- logado), só telefone, observações e ativo mudam. A sincronização roda
-- com a chave service_role (sem usuário logado) e passa.
create or replace function public.proteger_dados_qlik()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.codigo_cliente is not null
     and (new.nome, new.cnpj, new.cidade) is distinct from (old.nome, old.cnpj, old.cidade) then
    raise exception 'Nome, CNPJ e cidade desta empresa vêm do Qlik e não podem ser alterados no app.';
  end if;
  return new;
end $$;
revoke execute on function public.proteger_dados_qlik() from public, anon, authenticated;

drop trigger if exists ao_proteger_qlik on public.empresas;
create trigger ao_proteger_qlik
  before update on public.empresas
  for each row execute function public.proteger_dados_qlik();

-- As colunas novas NÃO entram nos grants de insert/update do app
-- (continuam só nome, cnpj, cidade, telefone, observacoes, ativo).
-- A leitura (grant select na tabela) já cobre as colunas novas.

-- ---------- CAMPANHAS: marca de importada ----------
alter table public.campanhas add column if not exists importada boolean not null default false;

-- Mesma função do schema, agora sem deixar o app gravar "importada".
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
    and column_name not in ('id','codigo','criado_em','aprovador_nome','data_decisao','motivo','importada');

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

  execute 'revoke all on public.campanhas from anon';
  execute 'revoke select, insert, update, delete, truncate, references, trigger on public.campanhas from authenticated';
  execute format('grant select (%s) on public.campanhas to authenticated', cols_select);
  execute format('grant insert (%s) on public.campanhas to authenticated', cols_insert);
  execute 'grant update (status, motivo) on public.campanhas to authenticated';
end $$;
revoke execute on function public.reaplicar_permissoes_campanhas() from public, anon, authenticated;

select public.reaplicar_permissoes_campanhas();

-- ============================================================
--  CARGA 1 — CLIENTES DO QLIK
--  Recebe um array JSON: [{codigo, nome, fantasia, documento, cidade, uf, vendedor}]
--  Para cada cliente, nesta ordem:
--    a) já existe empresa com o código      → atualiza os dados do Qlik
--    b) empresa sem código com o mesmo CNPJ → vincula (ganha o código)
--    c) empresa sem código com o mesmo nome (normalizado, um único resultado)
--       → vincula. É assim que as empresas das planilhas ganham o código.
--    d) senão                               → cadastra nova (origem qlik)
--  Nunca desativa nem apaga: cliente que sumiu do Qlik continua como está.
--  CNPJ inválido ou já usado por outra empresa fica de fora (conta em cnpj_ignorado).
-- ============================================================
create or replace function public.importar_clientes_qlik(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r          jsonb;
  v_codigo   text; v_nome text; v_fantasia text; v_doc text; v_cnpj text;
  v_cidade   text; v_uf text; v_vendedor text;
  v_id       bigint;
  v_ids      bigint[];
  n_novas int := 0; n_atual int := 0; n_cnpj int := 0; n_nome int := 0; n_cnpj_ign int := 0; n_sem int := 0;
begin
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'Envie um array JSON de clientes.'; end if;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_codigo   := nullif(btrim(r->>'codigo'), '');
    v_nome     := nullif(btrim(regexp_replace(r->>'nome', '\s+', ' ', 'g')), '');
    v_fantasia := nullif(btrim(regexp_replace(r->>'fantasia', '\s+', ' ', 'g')), '');
    v_doc      := regexp_replace(coalesce(r->>'documento',''), '\D', '', 'g');
    v_cidade   := nullif(btrim(r->>'cidade'), '');
    v_uf       := nullif(upper(btrim(r->>'uf')), '');
    v_vendedor := nullif(btrim(r->>'vendedor'), '');
    if v_codigo is null or coalesce(char_length(v_nome), 0) < 2 then n_sem := n_sem + 1; continue; end if;

    -- Só CNPJ válido entra (CPF de pessoa física fica de fora: a coluna é de CNPJ).
    v_cnpj := case when public.cnpj_valido(v_doc) then v_doc end;

    v_id := null;
    select id into v_id from empresas where codigo_cliente = v_codigo;
    if v_id is null and v_cnpj is not null then
      select id into v_id from empresas where codigo_cliente is null and cnpj = v_cnpj;
      if v_id is not null then n_cnpj := n_cnpj + 1; end if;
    end if;
    if v_id is null then
      select array_agg(id) into v_ids from empresas
       where codigo_cliente is null
         and normalizar_nome(nome) in (normalizar_nome(v_nome), normalizar_nome(v_fantasia));
      if array_length(v_ids, 1) = 1 then v_id := v_ids[1]; n_nome := n_nome + 1; end if;
    end if;

    -- CNPJ já em outra empresa: não troca, para não quebrar o índice único.
    if v_cnpj is not null and exists (select 1 from empresas where cnpj = v_cnpj and id is distinct from v_id) then
      v_cnpj := null; n_cnpj_ign := n_cnpj_ign + 1;
    end if;

    if v_id is null then
      insert into empresas (nome, nome_fantasia, cnpj, cidade, uf, vendedor, codigo_cliente, origem, sincronizado_em)
      values (v_nome, v_fantasia, v_cnpj, v_cidade, v_uf, v_vendedor, v_codigo, 'qlik', now());
      n_novas := n_novas + 1;
    else
      update empresas set
        codigo_cliente  = v_codigo,
        nome            = v_nome,
        nome_fantasia   = coalesce(v_fantasia, nome_fantasia),
        cnpj            = coalesce(v_cnpj, cnpj),
        cidade          = coalesce(v_cidade, cidade),
        uf              = coalesce(v_uf, uf),
        vendedor        = coalesce(v_vendedor, vendedor),
        origem          = 'qlik',
        sincronizado_em = now()
      where id = v_id;
      n_atual := n_atual + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'recebidas', jsonb_array_length(p_linhas), 'novas', n_novas, 'atualizadas', n_atual,
    'vinculadas_por_cnpj', n_cnpj, 'vinculadas_por_nome', n_nome,
    'cnpj_ignorado', n_cnpj_ign, 'sem_codigo_ou_nome', n_sem);
end $$;
revoke execute on function public.importar_clientes_qlik(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.importar_clientes_qlik(jsonb) to service_role;
  end if;
end $$;

-- ============================================================
--  CARGA 2 — HISTÓRICO DAS PLANILHAS ANTIGAS
--  Recebe um array JSON gerado por scripts/importar-planilhas.mjs:
--  [{codigo, empresa, solicitante, laboratorio, campanha, tipo, mecanica,
--    forma_pagamento, data_inicio, data_fim, meta, valor, aprovador,
--    observacoes, data_decisao, criado_em,
--    recebedor: {nome, cpf, nascimento, email, telefone} | null}]
--  - empresa: acha pelo nome normalizado (nome ou nome fantasia); senão cadastra (origem planilha)
--  - balconista: cadastra se o CPF ainda não está na empresa (o primeiro da lista
--    vence; o script manda a campanha mais recente primeiro). Nunca sobrescreve.
--  - campanha: entra Aprovada e importada = true. Código repetido é ignorado,
--    então rodar o mesmo arquivo de novo não duplica nada.
--  Tudo ou nada: se uma linha tiver erro, nada é gravado e a mensagem diz qual.
-- ============================================================
create or replace function public.importar_historico_planilha(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; rec jsonb;
  v_emp bigint; v_bal bigint; v_ids bigint[]; v_sol uuid;
  v_cpf text; v_tel text;
  n_emp int := 0; n_bal int := 0; n_camp int := 0; n_rep int := 0;
begin
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'Envie um array JSON de campanhas.'; end if;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_bal := null; v_cpf := null; v_tel := null; v_sol := null; rec := null;
    if exists (select 1 from campanhas where codigo = r->>'codigo') then n_rep := n_rep + 1; continue; end if;

    begin
      -- empresa
      select array_agg(id) into v_ids from empresas
       where normalizar_nome(r->>'empresa') in (normalizar_nome(nome), normalizar_nome(nome_fantasia));
      if array_length(v_ids, 1) >= 1 then
        v_emp := v_ids[1];
      else
        insert into empresas (nome, origem) values (btrim(r->>'empresa'), 'planilha') returning id into v_emp;
        n_emp := n_emp + 1;
      end if;

      -- balconista (quem recebeu pela Swile)
      rec := r->'recebedor';
      if rec is not null and jsonb_typeof(rec) = 'object' then
        v_cpf := regexp_replace(rec->>'cpf', '\D', '', 'g');
        v_tel := regexp_replace(rec->>'telefone', '\D', '', 'g');
        select id into v_bal from balconistas where empresa_id = v_emp and cpf = v_cpf;
        if v_bal is null then
          insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
          values (v_emp, btrim(regexp_replace(rec->>'nome', '\s+', ' ', 'g')), v_cpf,
                  (rec->>'nascimento')::date, lower(btrim(rec->>'email')), v_tel)
          returning id into v_bal;
          n_bal := n_bal + 1;
        end if;
      end if;

      -- solicitante: liga ao perfil quando o nome bate (aí ele vê a própria campanha em "Só as minhas")
      select id into v_sol from perfis where normalizar_nome(nome) = normalizar_nome(r->>'solicitante') limit 1;

      insert into campanhas (
        codigo, empresa_id, balconista_id, cliente, laboratorio, campanha, tipo, mecanica,
        forma_pagamento, data_inicio, data_fim, meta, investimento_lynkz, observacoes,
        status, solicitante_id, solicitante_nome, aprovador_nome, data_decisao, criado_em, importada,
        swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone)
      values (
        r->>'codigo', v_emp, v_bal, btrim(r->>'empresa'), r->>'laboratorio', r->>'campanha', r->>'tipo', r->>'mecanica',
        r->>'forma_pagamento', (r->>'data_inicio')::date, (r->>'data_fim')::date,
        coalesce((r->>'meta')::numeric, 0), coalesce((r->>'valor')::numeric, 0), nullif(r->>'observacoes', ''),
        'Aprovada', v_sol, r->>'solicitante', nullif(r->>'aprovador', ''), (r->>'data_decisao')::date,
        coalesce((r->>'criado_em')::timestamptz, now()), true,
        btrim(regexp_replace(rec->>'nome', '\s+', ' ', 'g')), v_cpf, (rec->>'nascimento')::date,
        lower(btrim(rec->>'email')), v_tel);
      n_camp := n_camp + 1;
    exception when others then
      raise exception 'Linha % (%): %', r->>'codigo', r->>'empresa', sqlerrm;
    end;
  end loop;

  return jsonb_build_object('campanhas', n_camp, 'ja_existiam', n_rep, 'empresas_novas', n_emp, 'balconistas_novos', n_bal);
end $$;
revoke execute on function public.importar_historico_planilha(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.importar_historico_planilha(jsonb) to service_role;
  end if;
end $$;

-- ============================================================
--  UNIR EMPRESAS DUPLICADAS
--  Quando a mesma loja ficou com dois cadastros (ex.: "Pets Village" da
--  planilha e "PETS VILLAGE HOTEL LTDA" do Qlik), passa campanhas e
--  balconistas de p_de para p_para e desativa p_de. Não apaga nada.
--  Balconista com o mesmo CPF nas duas: as campanhas passam a apontar
--  para o de p_para e o de p_de é desativado.
--  Uso no SQL Editor:  select public.unir_empresas(<id que sai>, <id que fica>);
-- ============================================================
create or replace function public.unir_empresas(p_de bigint, p_para bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b record; v_dest bigint; n_balc int := 0; n_camp int := 0;
begin
  if p_de = p_para then raise exception 'Escolha duas empresas diferentes.'; end if;
  if not exists (select 1 from empresas where id = p_de) or not exists (select 1 from empresas where id = p_para) then
    raise exception 'Empresa não encontrada (% ou %).', p_de, p_para;
  end if;

  for b in select * from balconistas where empresa_id = p_de loop
    select id into v_dest from balconistas where empresa_id = p_para and cpf = b.cpf;
    if v_dest is null then
      update balconistas set empresa_id = p_para where id = b.id;
    else
      update campanhas set balconista_id = v_dest where balconista_id = b.id;
      update balconistas set ativo = false where id = b.id;
    end if;
    n_balc := n_balc + 1;
  end loop;

  update campanhas set empresa_id = p_para where empresa_id = p_de;
  get diagnostics n_camp = row_count;

  update empresas d set
    telefone    = coalesce(d.telefone, o.telefone),
    observacoes = coalesce(d.observacoes, o.observacoes)
  from empresas o where d.id = p_para and o.id = p_de;
  update empresas set ativo = false,
    observacoes = concat_ws(' · ', nullif(observacoes, ''), 'Unida à empresa #' || p_para)
  where id = p_de;

  return jsonb_build_object('campanhas_movidas', n_camp, 'balconistas_movidos', n_balc);
end $$;
revoke execute on function public.unir_empresas(bigint, bigint) from public, anon, authenticated;

-- ============================================================
--  v2.4 — NOTAS FISCAIS DA CAMPANHA
--  (mesmo conteúdo de migracoes/08-notas-fiscais.sql)
-- ============================================================
alter table public.campanhas add column if not exists compras_periodo       numeric(14,2);
alter table public.campanhas add column if not exists compras_consultado_em timestamptz;

create table if not exists public.campanha_notas (
  id            bigint generated always as identity primary key,
  campanha_id   bigint not null references public.campanhas(id) on delete cascade,
  numero        text not null,
  serie         text not null default '',
  data_emissao  date,
  valor         numeric(14,2) not null default 0,
  criado_em     timestamptz not null default now(),
  constraint campanha_notas_numero_valido check (btrim(numero) <> ''),
  constraint campanha_notas_unica unique (campanha_id, numero, serie)
);
create index if not exists idx_campanha_notas_campanha on public.campanha_notas (campanha_id);

alter table public.campanha_notas enable row level security;

drop policy if exists campanha_notas_leitura on public.campanha_notas;
create policy campanha_notas_leitura on public.campanha_notas
  for select to authenticated using (public.eh_ativo());

drop policy if exists campanha_notas_inclui on public.campanha_notas;
create policy campanha_notas_inclui on public.campanha_notas
  for insert to authenticated
  with check (
    public.eh_ativo()
    and exists (select 1 from public.campanhas c
                where c.id = campanha_id and c.solicitante_id = auth.uid() and c.status = 'Pendente')
  );
-- Sem policy de update/delete: nota marcada fica registrada.

revoke all on public.campanha_notas from anon;
revoke all on public.campanha_notas from authenticated;
grant select on public.campanha_notas to authenticated;
grant insert (campanha_id, numero, serie, data_emissao, valor) on public.campanha_notas to authenticated;

-- As colunas novas de campanhas entram no select da view e nos grants.
select public.reaplicar_permissoes_campanhas();

-- ============================================================
--  v2.5 — MARCA DA CONSULTA NO QLIK
--  (mesmo conteúdo de migracoes/09-marca-da-consulta.sql)
-- ============================================================
alter table public.campanhas add column if not exists compras_marca text;

-- A coluna nova entra no select da view e nos grants do app.
select public.reaplicar_permissoes_campanhas();

-- ============================================================
--  v2.9 — DEVOLUÇÕES NA CONSULTA DO QLIK
--  (mesmo conteúdo de migracoes/13-devolucoes-da-consulta.sql; enviar_campanha mais abaixo já grava)
-- ============================================================
alter table public.campanhas add column if not exists compras_devolucoes numeric(14,2);
alter table public.campanhas add column if not exists compras_devolvidas jsonb;
-- Os dois campos vêm do aparelho de quem pede (como compras_periodo): limites no banco.
-- Nulos = consulta não feita ou site anterior à v2.9 (que não manda as chaves novas).
alter table public.campanhas drop constraint if exists campanhas_devolucoes_faixa;
alter table public.campanhas add constraint campanhas_devolucoes_faixa check (
  (compras_devolucoes is null or (compras_devolucoes >= 0 and compras_devolucoes <= 10000000))
  and (case when compras_devolvidas is null then true
            when jsonb_typeof(compras_devolvidas) <> 'array' then false
            else jsonb_array_length(compras_devolvidas) <= 50 end)
) not valid;

-- As colunas novas entram no select da view e nos grants do app.
select public.reaplicar_permissoes_campanhas();

-- ============================================================
--  v2.13 — FORNECEDORES: META E INVESTIMENTO DA INDÚSTRIA POR FORNECEDOR
--  (mesmo conteúdo de migracoes/14-fornecedores.sql; enviar_campanha mais abaixo já grava)
-- ============================================================
alter table public.campanhas add column if not exists fornecedores jsonb;

-- Confere a divisão gravada: nula (campanha sem divisão) ou 2 a 5 itens
-- { nome, meta, investimento_industria }, um por fornecedor da campanha (os mesmos de
-- "laboratorio", sem repetir), valores dentro dos limites e somas iguais às colunas
-- meta e investimento_industria. plpgsql para conferir o tipo antes de converter.
create or replace function public.fornecedores_validos(f jsonb, lab text, meta numeric, ind numeric)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  e       jsonb;
  nomes   text[] := '{}';
  labs    text[];
  s_meta  numeric := 0;
  s_ind   numeric := 0;
  v_meta  numeric;
  v_ind   numeric;
  v_nome  text;
begin
  if f is null then return true; end if;
  if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) < 2 or jsonb_array_length(f) > 5 then return false; end if;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into labs from unnest(string_to_array(coalesce(lab, ''), ',')) x;
  if cardinality(labs) <> jsonb_array_length(f) then return false; end if;
  for e in select * from jsonb_array_elements(f) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'nome') <> 'string'
       or jsonb_typeof(e->'meta') <> 'number' or jsonb_typeof(e->'investimento_industria') <> 'number' then
      return false;
    end if;
    v_nome := lower(btrim(e->>'nome'));
    v_meta := (e->>'meta')::numeric;
    v_ind  := (e->>'investimento_industria')::numeric;
    if v_nome = '' or length(v_nome) > 120 or v_nome = any(nomes) or not (v_nome = any(labs)) then return false; end if;
    if v_meta < 0 or v_meta > 1000000000 or v_ind < 0 or v_ind > 10000000 then return false; end if;
    nomes := nomes || v_nome;
    s_meta := s_meta + v_meta;
    s_ind  := s_ind + v_ind;
  end loop;
  return round(s_meta, 2) = round(coalesce(meta, 0), 2) and round(s_ind, 2) = round(coalesce(ind, 0), 2);
end $$;

alter table public.campanhas drop constraint if exists campanhas_fornecedores_valido;
alter table public.campanhas add constraint campanhas_fornecedores_valido
  check (public.fornecedores_validos(fornecedores, laboratorio, meta, investimento_industria)) not valid;
-- No máximo 5 fornecedores em "laboratorio" ("Ouro Fino, Avert, …"). NOT VALID: só vale para o que entrar daqui em diante.
alter table public.campanhas drop constraint if exists campanhas_fornecedores_max;
alter table public.campanhas add constraint campanhas_fornecedores_max
  check (cardinality(array_remove(string_to_array(regexp_replace(coalesce(laboratorio, ''), '\s*,\s*', ',', 'g'), ','), '')) <= 5) not valid;

-- A coluna nova entra no select da view e nos grants do app (inserir sim, alterar não).
select public.reaplicar_permissoes_campanhas();

-- ============================================================
--  v2.6 — SEGURANÇA
--  (mesmo conteúdo de migracoes/10-seguranca.sql)
-- ============================================================

-- ---------- 1. conta nova entra desativada ----------
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, email, nome, ativo)
  values (new.id, new.email, split_part(new.email,'@',1), false)
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.criar_perfil() from public, anon, authenticated;

-- ---------- 2. limites de tamanho e de faixa ----------
create or replace function public.texto_ate(t text, n int)
returns boolean language sql immutable as $$ select t is null or char_length(t) <= n $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campanhas_textos_tamanho') then
    alter table public.campanhas add constraint campanhas_textos_tamanho check (
      texto_ate(cliente, 200) and texto_ate(laboratorio, 120) and texto_ate(campanha, 200)
      and texto_ate(tipo, 120) and texto_ate(mecanica, 2000) and texto_ate(observacoes, 2000)
      and texto_ate(motivo, 1000) and texto_ate(forma_pagamento, 60) and texto_ate(tipo_meta, 60)
      and texto_ate(rebate_base, 120) and texto_ate(rebate_gatilho, 120)
      and texto_ate(swile_nome_completo, 150) and texto_ate(swile_email, 254)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campanhas_valores_faixa') then
    alter table public.campanhas add constraint campanhas_valores_faixa check (
      investimento_lynkz <= 10000000 and investimento_industria <= 10000000
      and meta <= 1000000000 and rebate_pct <= 100 and rebate_teto <= 10000000
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_textos_tamanho') then
    alter table public.empresas add constraint empresas_textos_tamanho check (
      texto_ate(nome, 200) and texto_ate(cidade, 120) and texto_ate(observacoes, 2000)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'balconistas_textos_tamanho') then
    alter table public.balconistas add constraint balconistas_textos_tamanho check (
      texto_ate(nome_completo, 150) and texto_ate(email, 254) and data_nascimento >= date '1900-01-01'
    ) not valid;
  end if;
  if to_regclass('public.campanha_notas') is not null
     and not exists (select 1 from pg_constraint where conname = 'campanha_notas_tamanho') then
    alter table public.campanha_notas add constraint campanha_notas_tamanho check (
      texto_ate(numero, 30) and texto_ate(serie, 10) and abs(valor) <= 1000000000
    ) not valid;
  end if;
end $$;

-- ---------- 3. limite de gravações por hora ----------
-- Só vale para usuário logado (auth.uid()). SQL Editor, cargas do Qlik e
-- das planilhas (service_role) não têm limite.
create or replace function public.limitar_gravacoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int; limite int;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'campanhas' then
    limite := 30;
    select count(*) into n from campanhas where solicitante_id = auth.uid() and criado_em > now() - interval '1 hour';
  elsif tg_table_name = 'empresas' then
    limite := 60;
    select count(*) into n from empresas where criado_por = auth.uid() and criado_em > now() - interval '1 hour';
  elsif tg_table_name = 'balconistas' then
    limite := 60;
    select count(*) into n from balconistas where criado_por = auth.uid() and criado_em > now() - interval '1 hour';
  elsif tg_table_name = 'campanha_notas' then
    limite := 300;
    select count(*) into n from campanha_notas where campanha_id = new.campanha_id;
  else
    return new;
  end if;
  if n >= limite then
    raise exception 'Muitos registros em pouco tempo. Aguarde e tente de novo, ou fale com a gerência.';
  end if;
  return new;
end $$;
revoke execute on function public.limitar_gravacoes() from public, anon, authenticated;

drop trigger if exists ao_limitar_campanhas on public.campanhas;
create trigger ao_limitar_campanhas before insert on public.campanhas for each row execute function public.limitar_gravacoes();
drop trigger if exists ao_limitar_empresas on public.empresas;
create trigger ao_limitar_empresas before insert on public.empresas for each row execute function public.limitar_gravacoes();
drop trigger if exists ao_limitar_balconistas on public.balconistas;
create trigger ao_limitar_balconistas before insert on public.balconistas for each row execute function public.limitar_gravacoes();
do $$ begin
  if to_regclass('public.campanha_notas') is not null then
    drop trigger if exists ao_limitar_notas on public.campanha_notas;
    create trigger ao_limitar_notas before insert on public.campanha_notas for each row execute function public.limitar_gravacoes();
  end if;
end $$;
create index if not exists idx_campanhas_solicitante_criado on public.campanhas (solicitante_id, criado_em);
create index if not exists idx_empresas_criado_por on public.empresas (criado_por, criado_em);
create index if not exists idx_balconistas_criado_por on public.balconistas (criado_por, criado_em);

-- ---------- 4. auditoria de perfis ----------
create table if not exists public.auditoria_perfis (
  id          bigint generated always as identity primary key,
  perfil_id   uuid not null,
  email       text,
  campo       text not null,
  de          text,
  para        text,
  feito_por   uuid,              -- null = SQL Editor / Table Editor do Supabase
  feito_em    timestamptz not null default now()
);
alter table public.auditoria_perfis enable row level security;
drop policy if exists auditoria_leitura on public.auditoria_perfis;
create policy auditoria_leitura on public.auditoria_perfis for select to authenticated using (public.eh_aprovador());
revoke all on public.auditoria_perfis from anon, authenticated;
grant select on public.auditoria_perfis to authenticated;

create or replace function public.auditar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.papel is distinct from old.papel then
    insert into auditoria_perfis (perfil_id, email, campo, de, para, feito_por) values (new.id, new.email, 'papel', old.papel, new.papel, auth.uid());
  end if;
  if new.ativo is distinct from old.ativo then
    insert into auditoria_perfis (perfil_id, email, campo, de, para, feito_por) values (new.id, new.email, 'ativo', old.ativo::text, new.ativo::text, auth.uid());
  end if;
  return new;
end $$;
revoke execute on function public.auditar_perfil() from public, anon, authenticated;
drop trigger if exists ao_auditar_perfil on public.perfis;
create trigger ao_auditar_perfil after update on public.perfis for each row execute function public.auditar_perfil();

-- ---------- 5. funções de apoio fora do alcance do visitante ----------
revoke execute on function public.eh_aprovador() from public, anon;
grant  execute on function public.eh_aprovador() to authenticated;
revoke execute on function public.registrar_decisao()    from public, anon, authenticated;
revoke execute on function public.carimbar_solicitacao() from public, anon, authenticated;

-- ---------- 6. enviar campanha num passo só (v2.7.0) ----------
--  (mesmo conteúdo de migracoes/11-enviar-campanha.sql)
create or replace function public.enviar_campanha(
  p_campanha   jsonb,
  p_balconista jsonb default null,
  p_notas      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  c        public.campanhas;
  v_bal    public.balconistas.id%type;
  v_id     public.campanhas.id%type;
  v_codigo public.campanhas.codigo%type;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para enviar a campanha.';
  end if;
  if p_campanha is null or jsonb_typeof(p_campanha) <> 'object' then
    raise exception 'Campanha inválida.';
  end if;

  c := jsonb_populate_record(null::public.campanhas, p_campanha);
  v_bal := c.balconista_id;

  if p_balconista is not null and jsonb_typeof(p_balconista) = 'object' then
    if nullif(p_balconista->>'id', '') is not null then
      update public.balconistas set
        nome_completo   = p_balconista->>'nome_completo',
        cpf             = p_balconista->>'cpf',
        data_nascimento = nullif(p_balconista->>'data_nascimento', '')::date,
        email           = p_balconista->>'email',
        telefone        = p_balconista->>'telefone'
      where id = (p_balconista->>'id')::bigint
      returning id into v_bal;
      if v_bal is null then
        raise exception 'O balconista escolhido não foi encontrado.';
      end if;
    else
      insert into public.balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
      values ((p_balconista->>'empresa_id')::bigint, p_balconista->>'nome_completo', p_balconista->>'cpf',
              nullif(p_balconista->>'data_nascimento', '')::date, p_balconista->>'email', p_balconista->>'telefone')
      returning id into v_bal;
    end if;
  end if;

  insert into public.campanhas (
    cliente, empresa_id, balconista_id, laboratorio, campanha, tipo, mecanica,
    investimento_lynkz, investimento_industria, forma_pagamento, data_inicio, data_fim,
    tipo_meta, meta, rebate_pct, rebate_teto, rebate_base, rebate_gatilho,
    swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone,
    observacoes, compras_periodo, compras_consultado_em, compras_marca, compras_devolucoes, compras_devolvidas,
    fornecedores, status, solicitante_id
  ) values (
    c.cliente, c.empresa_id, v_bal, c.laboratorio, c.campanha, c.tipo, c.mecanica,
    coalesce(c.investimento_lynkz, 0), coalesce(c.investimento_industria, 0), c.forma_pagamento, c.data_inicio, c.data_fim,
    c.tipo_meta, coalesce(c.meta, 0), coalesce(c.rebate_pct, 0), coalesce(c.rebate_teto, 0), c.rebate_base, c.rebate_gatilho,
    c.swile_nome_completo, c.swile_cpf, c.swile_data_nascimento, c.swile_email, c.swile_telefone,
    c.observacoes, c.compras_periodo, c.compras_consultado_em, c.compras_marca, c.compras_devolucoes, c.compras_devolvidas,
    c.fornecedores, 'Pendente', auth.uid()
  ) returning id, codigo into v_id, v_codigo;

  if p_notas is not null and jsonb_typeof(p_notas) = 'array' and jsonb_array_length(p_notas) > 0 then
    insert into public.campanha_notas (campanha_id, numero, serie, data_emissao, valor)
    select v_id, n->>'numero', coalesce(n->>'serie', ''), nullif(n->>'data', '')::date, (n->>'valor')::numeric
    from jsonb_array_elements(p_notas) n;
  end if;

  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'balconista_id', v_bal);
end $$;

revoke execute on function public.enviar_campanha(jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.enviar_campanha(jsonb, jsonb, jsonb) to authenticated;

-- ---------- 7. usuários no app (v2.8.0) ----------
--  (mesmo conteúdo de migracoes/12-usuarios-e-balconistas.sql)
create or replace function public.definir_perfil(
  p_id    uuid,
  p_papel text    default null,
  p_ativo boolean default null,
  p_nome  text    default null
) returns public.perfis
language plpgsql security definer set search_path = public as $$
declare
  r      public.perfis;
  v_nome text := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
begin
  if not public.eh_aprovador() then
    raise exception 'Só um administrador muda usuários.' using errcode = '42501';
  end if;
  if p_papel is not null and p_papel not in ('aprovador', 'coordenador') then
    raise exception 'Papel inválido.';
  end if;
  if p_nome is not null and (v_nome is null or length(v_nome) < 2 or length(v_nome) > 80) then
    raise exception 'O nome precisa ter de 2 a 80 caracteres.';
  end if;
  if p_id = auth.uid() and ((p_papel is not null and p_papel <> 'aprovador') or p_ativo is false) then
    raise exception 'Você não pode tirar o seu próprio acesso de administrador. Peça a outro administrador.';
  end if;

  update public.perfis set
    papel = coalesce(p_papel, papel),
    ativo = coalesce(p_ativo, ativo),
    nome  = coalesce(v_nome, nome)
  where id = p_id
  returning * into r;

  if r.id is null then
    raise exception 'Usuário não encontrado.';
  end if;
  return r;
end $$;

revoke execute on function public.definir_perfil(uuid, text, boolean, text) from public, anon;
grant  execute on function public.definir_perfil(uuid, text, boolean, text) to authenticated;

-- ---------- 8. no máximo 2 balconistas por empresa (v2.8.0) ----------
create or replace function public.limitar_balconistas_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / cargas
  -- Fila por empresa: dois cadastros ao mesmo tempo não passam juntos do limite.
  perform pg_advisory_xact_lock(1202, new.empresa_id::int);
  if (select count(*) from public.balconistas where empresa_id = new.empresa_id) >= 2 then
    raise exception 'Esta empresa já tem 2 balconistas cadastrados, que é o limite. Para trocar a pessoa, um administrador exclui um deles na ficha da empresa.';
  end if;
  return new;
end $$;
revoke execute on function public.limitar_balconistas_empresa() from public, anon, authenticated;
drop trigger if exists ao_limitar_balconistas_empresa on public.balconistas;
create trigger ao_limitar_balconistas_empresa before insert on public.balconistas
  for each row execute function public.limitar_balconistas_empresa();

-- ---------- 8. excluir campanha (v3.1.0) ----------
--  (mesmo conteúdo de migracoes/15-excluir-campanha.sql)
create table if not exists public.campanhas_excluidas (
  id                bigint generated always as identity primary key,
  campanha_id       bigint not null,
  codigo            text,
  cliente           text,
  campanha          text,
  status            text,
  dados             jsonb not null,           -- {"campanha": {...linha inteira...}, "notas": [...]}
  motivo            text not null,
  excluida_por      uuid references public.perfis(id) on delete set null,
  excluida_por_nome text,
  excluida_em       timestamptz not null default now(),
  constraint campanhas_excluidas_motivo check (char_length(btrim(motivo)) between 3 and 500)
);
create index if not exists idx_campanhas_excluidas_em on public.campanhas_excluidas (excluida_em desc);

alter table public.campanhas_excluidas enable row level security;
drop policy if exists campanhas_excluidas_leitura on public.campanhas_excluidas;
create policy campanhas_excluidas_leitura on public.campanhas_excluidas
  for select to authenticated using (public.eh_aprovador());
-- Sem policy de insert/update/delete: só a função grava (security definer).
revoke all on public.campanhas_excluidas from public, anon, authenticated;
grant select on public.campanhas_excluidas to authenticated;

create or replace function public.excluir_campanha(p_id bigint, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        public.campanhas;
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  v_notas  jsonb;
begin
  if auth.uid() is null or not public.eh_aprovador() then
    raise exception 'Só um administrador exclui campanhas.' using errcode = '42501';
  end if;
  if char_length(v_motivo) < 3 or char_length(v_motivo) > 500 then
    raise exception 'Escreva o motivo da exclusão (de 3 a 500 caracteres).';
  end if;

  select * into c from public.campanhas where id = p_id for update;
  if not found then
    raise exception 'Campanha não encontrada. Talvez outra pessoa já tenha excluído.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) into v_notas
  from public.campanha_notas n where n.campanha_id = c.id;

  insert into public.campanhas_excluidas (campanha_id, codigo, cliente, campanha, status, dados, motivo, excluida_por, excluida_por_nome)
  values (c.id, c.codigo, c.cliente, c.campanha, c.status,
          jsonb_build_object('campanha', to_jsonb(c), 'notas', v_notas),
          v_motivo, auth.uid(), (select p.nome from public.perfis p where p.id = auth.uid()));

  delete from public.campanhas where id = c.id;   -- notas saem junto (on delete cascade)
  return jsonb_build_object('id', c.id, 'codigo', c.codigo);
end $$;

revoke execute on function public.excluir_campanha(bigint, text) from public, anon;
grant  execute on function public.excluir_campanha(bigint, text) to authenticated;

-- ============================================================
--  COMISSÕES (v3.2.0) — mesmo conteúdo de migracoes/16-comissoes.sql.
--  Se mudar aqui, mude lá também (e vice-versa).
-- ============================================================
-- ---------- 1. parâmetros ----------
create table if not exists public.comissao_parametros (
  id                            smallint primary key default 1,
  cod_farelo                    text     not null default '6610',
  dia_corte                     smallint not null default 25,
  pct_clt_principal             numeric(5,2) not null default 2.5,
  pct_clt_farelo                numeric(5,2) not null default 1,
  pct_televendas_principal      numeric(5,2) not null default 1,
  pct_televendas_farelo         numeric(5,2) not null default 1,
  pct_pj_principal              numeric(5,2) not null default 5,
  pct_pj_farelo                 numeric(5,2) not null default 2,
  contrato_gatilho_faturamento  numeric(5,2) not null default 100,
  contrato_gatilho_positivacao  numeric(5,2) not null default 80,
  contrato_limite_faixa         numeric(5,2) not null default 105,
  contrato_pct_faixa1           numeric(5,2) not null default 1,
  contrato_pct_faixa2           numeric(5,2) not null default 1.2,
  nomes_ignorados               text[]   not null default '{}',
  atualizado_em                 timestamptz,
  atualizado_por                uuid references public.perfis(id),
  constraint comissao_parametros_uma_linha check (id = 1),
  constraint comissao_parametros_farelo check (cod_farelo ~ '^[0-9]{1,10}$'),
  constraint comissao_parametros_corte check (dia_corte between 1 and 28),
  constraint comissao_parametros_pct check (
    pct_clt_principal between 0 and 20 and pct_clt_farelo between 0 and 20 and
    pct_televendas_principal between 0 and 20 and pct_televendas_farelo between 0 and 20 and
    pct_pj_principal between 0 and 20 and pct_pj_farelo between 0 and 20 and
    contrato_pct_faixa1 between 0 and 20 and contrato_pct_faixa2 between 0 and 20),
  constraint comissao_parametros_contrato check (
    contrato_gatilho_faturamento between 1 and 500 and contrato_gatilho_positivacao between 1 and 500 and
    contrato_limite_faixa between 1 and 500),
  constraint comissao_parametros_ignorados check (cardinality(nomes_ignorados) <= 50)
);
insert into public.comissao_parametros (id) values (1) on conflict (id) do nothing;

-- ---------- 2. comissionados ----------
create table if not exists public.comissionados (
  id                   bigint generated always as identity primary key,
  nome                 text    not null,
  regime               text    not null,
  equipe               text,
  pct_principal        numeric(5,2) not null,
  pct_farelo           numeric(5,2) not null,
  nomes_qlik           text[]  not null default '{}',
  email                text,
  acordo_minimo        numeric(12,2),
  acordo_inicio        date,
  acordo_fim           date,
  meta_faturamento     numeric(14,2),
  meta_positivacao     integer,
  meta_atualizada_em   timestamptz,
  meta_atualizada_por  uuid references public.perfis(id),
  pj_razao_social      text,
  pj_documento         text,
  pj_pix               text,
  pj_banco             text,
  adp_observacao       text,
  ativo                boolean not null default true,
  criado_em            timestamptz not null default now(),
  criado_por           uuid references public.perfis(id),
  atualizado_em        timestamptz,
  atualizado_por       uuid references public.perfis(id),
  constraint comissionados_nome_valido check (length(btrim(nome)) between 2 and 80),
  constraint comissionados_regime_valido check (regime in ('CLT', 'TELEVENDAS', 'PJ')),
  constraint comissionados_pct_valido check (pct_principal between 0 and 20 and pct_farelo between 0 and 20),
  constraint comissionados_nomes_qlik_valido check (cardinality(nomes_qlik) between 1 and 10),
  constraint comissionados_acordo_valido check (
    (acordo_minimo is null or acordo_minimo = 0 or (regime <> 'PJ' and acordo_minimo between 0 and 1000000 and acordo_inicio is not null))
    and (acordo_fim is null or acordo_inicio is null or acordo_fim >= acordo_inicio)),
  constraint comissionados_meta_valida check (
    (meta_faturamento is null or meta_faturamento between 0 and 100000000)
    and (meta_positivacao is null or meta_positivacao between 0 and 100000)),
  constraint comissionados_documento_valido check (pj_documento is null or pj_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  constraint comissionados_email_valido check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  constraint comissionados_textos_tamanho check (
    coalesce(length(equipe), 0) <= 60 and coalesce(length(email), 0) <= 120 and
    coalesce(length(pj_razao_social), 0) <= 120 and coalesce(length(pj_pix), 0) <= 140 and
    coalesce(length(pj_banco), 0) <= 60 and coalesce(length(adp_observacao), 0) <= 200)
);

-- Nome do Qlik como o banco guarda: maiúsculas, um espaço entre as palavras.
create or replace function public.nome_qlik(t text) returns text
language sql immutable set search_path = public as $$
  select upper(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')))
$$;

create or replace function public.preparar_comissionado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_repetido text;
  v_dono     text;
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  new.equipe := nullif(btrim(regexp_replace(coalesce(new.equipe, ''), '\s+', ' ', 'g')), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.pj_documento := nullif(regexp_replace(coalesce(new.pj_documento, ''), '\D', '', 'g'), '');
  new.pj_razao_social := nullif(btrim(coalesce(new.pj_razao_social, '')), '');
  new.pj_pix := nullif(btrim(coalesce(new.pj_pix, '')), '');
  new.pj_banco := nullif(btrim(coalesce(new.pj_banco, '')), '');
  new.adp_observacao := nullif(btrim(coalesce(new.adp_observacao, '')), '');
  -- nomes do Qlik: maiúsculas, sem vazios, sem repetir
  select coalesce(array_agg(n order by ord), '{}') into new.nomes_qlik
    from (select distinct on (public.nome_qlik(x)) public.nome_qlik(x) n, ord
            from unnest(new.nomes_qlik) with ordinality u(x, ord)
           where public.nome_qlik(x) <> '' order by public.nome_qlik(x), ord) s;
  if new.acordo_minimo = 0 then new.acordo_minimo := null; end if;
  if new.acordo_minimo is null then new.acordo_inicio := null; new.acordo_fim := null; end if;

  -- Um nome do Qlik em um comissionado ativo só. Fila única: dois cadastros ao mesmo tempo não passam juntos.
  if new.ativo then
    perform pg_advisory_xact_lock(1501, 0);
    select n, c.nome into v_repetido, v_dono
      from unnest(new.nomes_qlik) n
      join public.comissionados c on c.ativo and c.id is distinct from new.id and n = any(c.nomes_qlik)
     limit 1;
    if v_repetido is not null then
      raise exception '"%" já está ligado a %. Cada nome do Qlik pode estar em uma pessoa só.', v_repetido, v_dono;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.criado_por := auth.uid();
    new.atualizado_em := null;
    new.atualizado_por := null;
    if new.meta_faturamento is not null or new.meta_positivacao is not null then
      new.meta_atualizada_em := now();
      new.meta_atualizada_por := auth.uid();
    else
      new.meta_atualizada_em := null;
      new.meta_atualizada_por := null;
    end if;
  else
    new.criado_em := old.criado_em;
    new.criado_por := old.criado_por;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
    if new.meta_faturamento is distinct from old.meta_faturamento or new.meta_positivacao is distinct from old.meta_positivacao then
      new.meta_atualizada_em := now();
      new.meta_atualizada_por := auth.uid();
    else
      new.meta_atualizada_em := old.meta_atualizada_em;
      new.meta_atualizada_por := old.meta_atualizada_por;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.preparar_comissionado() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissionado on public.comissionados;
create trigger ao_preparar_comissionado before insert or update on public.comissionados
  for each row execute function public.preparar_comissionado();

create or replace function public.preparar_comissao_parametros()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := 1;
  select coalesce(array_agg(distinct public.nome_qlik(x)) filter (where public.nome_qlik(x) <> ''), '{}')
    into new.nomes_ignorados from unnest(new.nomes_ignorados) x;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke execute on function public.preparar_comissao_parametros() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissao_parametros on public.comissao_parametros;
create trigger ao_preparar_comissao_parametros before update on public.comissao_parametros
  for each row execute function public.preparar_comissao_parametros();

-- ---------- 3. auditoria ----------
create table if not exists public.comissao_auditoria (
  id          bigint generated always as identity primary key,
  tabela      text not null,
  registro_id bigint not null,
  acao        text not null,
  mudou       jsonb not null,           -- { campo: { "de": …, "para": … } }
  feito_por   uuid,
  feito_em    timestamptz not null default now()
);
create index if not exists comissao_auditoria_registro on public.comissao_auditoria (tabela, registro_id, feito_em desc);

create or replace function public.auditar_comissao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  antes  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  depois jsonb := to_jsonb(new);
  mudou  jsonb := '{}'::jsonb;
  k      text;
begin
  for k in select jsonb_object_keys(depois) loop
    continue when k in ('atualizado_em', 'atualizado_por', 'criado_em', 'criado_por', 'meta_atualizada_em', 'meta_atualizada_por');
    if antes->k is distinct from depois->k then
      mudou := mudou || jsonb_build_object(k, jsonb_build_object('de', antes->k, 'para', depois->k));
    end if;
  end loop;
  if mudou <> '{}'::jsonb then
    insert into public.comissao_auditoria (tabela, registro_id, acao, mudou, feito_por)
    values (tg_table_name, (depois->>'id')::bigint, lower(tg_op), mudou, auth.uid());
  end if;
  return null;
end $$;
revoke execute on function public.auditar_comissao() from public, anon, authenticated;
drop trigger if exists ao_auditar_comissionado on public.comissionados;
create trigger ao_auditar_comissionado after insert or update on public.comissionados
  for each row execute function public.auditar_comissao();
drop trigger if exists ao_auditar_comissao_parametros on public.comissao_parametros;
create trigger ao_auditar_comissao_parametros after update on public.comissao_parametros
  for each row execute function public.auditar_comissao();

-- ---------- 4. quem lê e grava: só o administrador ativo ----------
alter table public.comissao_parametros enable row level security;
alter table public.comissionados       enable row level security;
alter table public.comissao_auditoria  enable row level security;

-- O Supabase dá tudo para anon/authenticated em tabela nova: tira e devolve só o necessário.
revoke all on table public.comissao_parametros, public.comissionados, public.comissao_auditoria from anon, authenticated;
grant select, update on table public.comissao_parametros to authenticated;
grant select, insert, update on table public.comissionados to authenticated;
grant select on table public.comissao_auditoria to authenticated;

drop policy if exists comissao_parametros_admin_le on public.comissao_parametros;
create policy comissao_parametros_admin_le on public.comissao_parametros for select to authenticated using (public.eh_aprovador());
drop policy if exists comissao_parametros_admin_grava on public.comissao_parametros;
create policy comissao_parametros_admin_grava on public.comissao_parametros for update to authenticated
  using (public.eh_aprovador()) with check (public.eh_aprovador());

drop policy if exists comissionados_admin_le on public.comissionados;
create policy comissionados_admin_le on public.comissionados for select to authenticated using (public.eh_aprovador());
drop policy if exists comissionados_admin_cria on public.comissionados;
create policy comissionados_admin_cria on public.comissionados for insert to authenticated with check (public.eh_aprovador());
drop policy if exists comissionados_admin_altera on public.comissionados;
create policy comissionados_admin_altera on public.comissionados for update to authenticated
  using (public.eh_aprovador()) with check (public.eh_aprovador());

drop policy if exists comissao_auditoria_admin_le on public.comissao_auditoria;
create policy comissao_auditoria_admin_le on public.comissao_auditoria for select to authenticated using (public.eh_aprovador());

-- ============================================================
--  COMISSÕES DO MÊS (v3.3.0) — mesmo conteúdo de migracoes/17-comissoes-mes.sql.
--  Se mudar aqui, mude lá também (e vice-versa).
-- ============================================================
-- ---------- 1. premiações ----------
create table if not exists public.comissao_premiacoes (
  id              bigint generated always as identity primary key,
  mes             text    not null,
  comissionado_id bigint  not null references public.comissionados(id),
  descricao       text    not null,
  valor           numeric(12,2) not null,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references public.perfis(id),
  atualizado_em   timestamptz,
  atualizado_por  uuid references public.perfis(id),
  constraint comissao_premiacoes_mes check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_premiacoes_descricao check (length(btrim(descricao)) between 2 and 120),
  constraint comissao_premiacoes_valor check (valor between 0.01 and 1000000)
);
create index if not exists comissao_premiacoes_mes on public.comissao_premiacoes (mes, comissionado_id);

-- ---------- 2. ajustes ----------
create table if not exists public.comissao_ajustes (
  id              bigint generated always as identity primary key,
  mes             text    not null,
  comissionado_id bigint  not null references public.comissionados(id),
  motivo          text    not null,
  valor           numeric(12,2) not null,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references public.perfis(id),
  atualizado_em   timestamptz,
  atualizado_por  uuid references public.perfis(id),
  constraint comissao_ajustes_mes check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_ajustes_motivo check (length(btrim(motivo)) between 3 and 200),
  constraint comissao_ajustes_valor check (valor between -1000000 and 1000000 and valor <> 0)
);
create index if not exists comissao_ajustes_mes on public.comissao_ajustes (mes, comissionado_id);

-- ---------- 3. dados do PJ no mês ----------
create table if not exists public.comissao_mes_pj (
  id                     bigint generated always as identity primary key,
  mes                    text   not null,
  comissionado_id        bigint not null references public.comissionados(id),
  meta_faturamento       numeric(14,2),
  meta_positivacao       integer,
  realizado_faturamento  numeric(14,2),
  realizado_positivacao  integer,
  realizado_motivo       text,
  nf_numero              text,
  nf_valor               numeric(12,2),
  atualizado_em          timestamptz,
  atualizado_por         uuid references public.perfis(id),
  constraint comissao_mes_pj_unico unique (mes, comissionado_id),
  constraint comissao_mes_pj_mes check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_mes_pj_metas check (
    (meta_faturamento is null or meta_faturamento between 0 and 100000000)
    and (meta_positivacao is null or meta_positivacao between 0 and 100000)),
  constraint comissao_mes_pj_realizado check (
    (realizado_faturamento is null or realizado_faturamento between -100000000 and 100000000)
    and (realizado_positivacao is null or realizado_positivacao between 0 and 100000)
    and ((realizado_faturamento is null and realizado_positivacao is null)
         or length(btrim(coalesce(realizado_motivo, ''))) between 3 and 200)),
  constraint comissao_mes_pj_nf check (nf_numero is null or nf_numero ~ '^[0-9A-Za-z./-]{1,20}$')
);
alter table public.comissao_mes_pj add column if not exists nf_valor numeric(12,2);
alter table public.comissao_mes_pj drop constraint if exists comissao_mes_pj_nf_valor;
alter table public.comissao_mes_pj add constraint comissao_mes_pj_nf_valor check (nf_valor is null or nf_valor between 0.01 and 10000000);

-- ---------- 4. histórico (mês fechado) ----------
create table if not exists public.comissao_fechamentos (
  id                bigint generated always as identity primary key,
  mes               text   not null,
  status            text   not null default 'fechado',
  dados             jsonb  not null,           -- { resultado, cadastro, premiacoes, ajustes, parametros }
  total             numeric(14,2) not null,
  total_clt         numeric(14,2) not null,
  total_pj          numeric(14,2) not null,
  fechado_em        timestamptz,
  fechado_por       uuid references public.perfis(id),
  reaberto_em       timestamptz,
  reaberto_por      uuid references public.perfis(id),
  motivo_reabertura text,
  constraint comissao_fechamentos_mes_unico unique (mes),
  constraint comissao_fechamentos_mes check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_fechamentos_status check (status in ('fechado', 'reaberto')),
  constraint comissao_fechamentos_tamanho check (pg_column_size(dados) < 2000000),
  constraint comissao_fechamentos_motivo check (status = 'fechado' or length(btrim(coalesce(motivo_reabertura, ''))) between 3 and 300)
);

-- ---------- preparo e trava do mês fechado ----------
create or replace function public.preparar_comissao_mes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Quem não é administrador para no RLS logo depois: não conta nada sobre o mês aqui.
  if not public.eh_aprovador() then return new; end if;
  -- Mês fechado não muda (nem a linha antiga, se o update tentar trocar de mês).
  if exists (select 1 from public.comissao_fechamentos f
              where f.status = 'fechado' and (f.mes = new.mes or (tg_op = 'UPDATE' and f.mes = old.mes))) then
    raise exception 'O mês % está fechado. Reabra o mês para mudar premiações, ajustes, contrato ou nota fiscal.', new.mes;
  end if;
  if tg_table_name = 'comissao_mes_pj' then
    if not exists (select 1 from public.comissionados where id = new.comissionado_id and regime = 'PJ') then
      raise exception 'Contrato de Resultado e nota fiscal são só para representantes PJ.';
    end if;
    new.nf_numero := nullif(btrim(coalesce(new.nf_numero, '')), '');
    new.realizado_motivo := nullif(btrim(regexp_replace(coalesce(new.realizado_motivo, ''), '\s+', ' ', 'g')), '');
    if new.realizado_faturamento is null and new.realizado_positivacao is null then new.realizado_motivo := null; end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
    return new;
  end if;
  if tg_table_name = 'comissao_premiacoes' then
    new.descricao := btrim(regexp_replace(new.descricao, '\s+', ' ', 'g'));
  else
    new.motivo := btrim(regexp_replace(new.motivo, '\s+', ' ', 'g'));
  end if;
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.criado_por := auth.uid();
    new.atualizado_em := null;
    new.atualizado_por := null;
  else
    new.criado_em := old.criado_em;
    new.criado_por := old.criado_por;
    new.mes := old.mes;
    new.comissionado_id := old.comissionado_id;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  return new;
end $$;
revoke execute on function public.preparar_comissao_mes() from public, anon, authenticated;

drop trigger if exists ao_preparar_comissao_premiacao on public.comissao_premiacoes;
create trigger ao_preparar_comissao_premiacao before insert or update on public.comissao_premiacoes
  for each row execute function public.preparar_comissao_mes();
drop trigger if exists ao_preparar_comissao_ajuste on public.comissao_ajustes;
create trigger ao_preparar_comissao_ajuste before insert or update on public.comissao_ajustes
  for each row execute function public.preparar_comissao_mes();
drop trigger if exists ao_preparar_comissao_mes_pj on public.comissao_mes_pj;
create trigger ao_preparar_comissao_mes_pj before insert or update on public.comissao_mes_pj
  for each row execute function public.preparar_comissao_mes();

-- Fechar: grava a cópia e quem fechou. Reabrir: só muda o status (a cópia fica), com motivo.
-- Fechar de novo um mês reaberto: troca a cópia. Fechado não fecha de novo sem reabrir.
create or replace function public.preparar_comissao_fechamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.motivo_reabertura := nullif(btrim(regexp_replace(coalesce(new.motivo_reabertura, ''), '\s+', ' ', 'g')), '');
  if tg_op = 'INSERT' then
    if new.status <> 'fechado' then raise exception 'Um mês entra no histórico fechado.'; end if;
    new.fechado_em := now(); new.fechado_por := auth.uid();
    new.reaberto_em := null; new.reaberto_por := null; new.motivo_reabertura := null;
    return new;
  end if;
  new.mes := old.mes;
  if old.status = 'fechado' and new.status = 'fechado' then
    raise exception 'O mês % já está fechado. Reabra antes de fechar de novo.', old.mes;
  end if;
  if new.status = 'reaberto' then
    if old.status = 'reaberto' then raise exception 'O mês % já está reaberto.', old.mes; end if;
    new.dados := old.dados; new.total := old.total; new.total_clt := old.total_clt; new.total_pj := old.total_pj;
    new.fechado_em := old.fechado_em; new.fechado_por := old.fechado_por;
    new.reaberto_em := now(); new.reaberto_por := auth.uid();
  else
    new.fechado_em := now(); new.fechado_por := auth.uid();
    new.reaberto_em := old.reaberto_em; new.reaberto_por := old.reaberto_por; new.motivo_reabertura := old.motivo_reabertura;
  end if;
  return new;
end $$;
revoke execute on function public.preparar_comissao_fechamento() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissao_fechamento on public.comissao_fechamentos;
create trigger ao_preparar_comissao_fechamento before insert or update on public.comissao_fechamentos
  for each row execute function public.preparar_comissao_fechamento();

-- Auditoria do fechamento: só status, totais e motivo (a cópia inteira já fica na própria tabela).
create or replace function public.auditar_comissao_fechamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.comissao_auditoria (tabela, registro_id, acao, mudou, feito_por)
  values ('comissao_fechamentos', new.id, lower(tg_op), jsonb_build_object(
    'mes', new.mes, 'status', jsonb_build_object('de', case when tg_op = 'UPDATE' then old.status end, 'para', new.status),
    'total', jsonb_build_object('de', case when tg_op = 'UPDATE' then old.total end, 'para', new.total),
    'motivo_reabertura', new.motivo_reabertura), auth.uid());
  return null;
end $$;
revoke execute on function public.auditar_comissao_fechamento() from public, anon, authenticated;
drop trigger if exists ao_auditar_comissao_fechamento on public.comissao_fechamentos;
create trigger ao_auditar_comissao_fechamento after insert or update on public.comissao_fechamentos
  for each row execute function public.auditar_comissao_fechamento();

drop trigger if exists ao_auditar_comissao_premiacao on public.comissao_premiacoes;
create trigger ao_auditar_comissao_premiacao after insert or update on public.comissao_premiacoes
  for each row execute function public.auditar_comissao();
drop trigger if exists ao_auditar_comissao_ajuste on public.comissao_ajustes;
create trigger ao_auditar_comissao_ajuste after insert or update on public.comissao_ajustes
  for each row execute function public.auditar_comissao();
drop trigger if exists ao_auditar_comissao_mes_pj on public.comissao_mes_pj;
create trigger ao_auditar_comissao_mes_pj after insert or update on public.comissao_mes_pj
  for each row execute function public.auditar_comissao();

-- ---------- 5. quem lê e grava: só o administrador ativo ----------
alter table public.comissao_premiacoes  enable row level security;
alter table public.comissao_ajustes     enable row level security;
alter table public.comissao_mes_pj      enable row level security;
alter table public.comissao_fechamentos enable row level security;
revoke all on table public.comissao_premiacoes, public.comissao_ajustes, public.comissao_mes_pj, public.comissao_fechamentos from anon, authenticated;
grant select, insert, update on table public.comissao_premiacoes, public.comissao_ajustes, public.comissao_mes_pj, public.comissao_fechamentos to authenticated;

do $$
declare t text;
begin
  foreach t in array array['comissao_premiacoes', 'comissao_ajustes', 'comissao_mes_pj', 'comissao_fechamentos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_le', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.eh_aprovador())', t || '_admin_le', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_cria', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.eh_aprovador())', t || '_admin_cria', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_altera', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.eh_aprovador()) with check (public.eh_aprovador())', t || '_admin_altera', t);
  end loop;
end $$;

-- ============================================================
--  EXCLUIR BALCONISTA (v3.5.0) — mesmo conteúdo de migracoes/18-excluir-balconista.sql
--  (a mensagem nova do limite já está na seção 8 acima). Se mudar aqui, mude lá também.
-- ============================================================
create table if not exists public.balconistas_excluidos (
  id                bigint generated always as identity primary key,
  balconista_id     bigint not null,
  empresa_id        bigint,
  nome_completo     text,
  dados             jsonb not null,          -- {"balconista": {...}, "campanhas": [ids]}
  motivo            text not null,
  excluido_por      uuid references public.perfis(id) on delete set null,
  excluido_por_nome text,
  excluido_em       timestamptz not null default now(),
  constraint balconistas_excluidos_motivo check (char_length(btrim(motivo)) between 3 and 500)
);
create index if not exists idx_balconistas_excluidos_em on public.balconistas_excluidos (excluido_em desc);

alter table public.balconistas_excluidos enable row level security;
drop policy if exists balconistas_excluidos_leitura on public.balconistas_excluidos;
create policy balconistas_excluidos_leitura on public.balconistas_excluidos
  for select to authenticated using (public.eh_aprovador());
-- Sem policy de insert/update/delete: só a função grava (security definer).
revoke all on public.balconistas_excluidos from public, anon, authenticated;
grant select on public.balconistas_excluidos to authenticated;

create or replace function public.excluir_balconista(p_id bigint, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b        public.balconistas;
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  n_pend   int;
  v_ids    jsonb;
begin
  if auth.uid() is null or not public.eh_aprovador() then
    raise exception 'Só um administrador exclui balconistas.' using errcode = '42501';
  end if;
  if char_length(v_motivo) < 3 or char_length(v_motivo) > 500 then
    raise exception 'Escreva o motivo da exclusão (de 3 a 500 caracteres).';
  end if;

  select * into b from public.balconistas where id = p_id for update;
  if not found then
    raise exception 'Balconista não encontrado. Talvez outra pessoa já tenha excluído.';
  end if;

  select count(*) into n_pend from public.campanhas where balconista_id = b.id and status = 'Pendente';
  if n_pend > 0 then
    raise exception 'Este balconista está em % campanha(s) pendente(s). Decida ou troque o balconista antes de excluir.', n_pend;
  end if;

  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) into v_ids
  from public.campanhas where balconista_id = b.id;

  -- Campanha Swile decidida sem os dados de quem recebe: grava os do cadastro antes de apagar.
  update public.campanhas set
    swile_nome_completo   = b.nome_completo,
    swile_cpf             = b.cpf,
    swile_data_nascimento = b.data_nascimento,
    swile_email           = b.email,
    swile_telefone        = b.telefone
  where balconista_id = b.id and forma_pagamento = 'Swile' and swile_nome_completo is null;

  update public.campanhas set balconista_id = null where balconista_id = b.id;

  insert into public.balconistas_excluidos (balconista_id, empresa_id, nome_completo, dados, motivo, excluido_por, excluido_por_nome)
  values (b.id, b.empresa_id, b.nome_completo,
          jsonb_build_object('balconista', to_jsonb(b), 'campanhas', v_ids),
          v_motivo, auth.uid(), (select p.nome from public.perfis p where p.id = auth.uid()));

  delete from public.balconistas where id = b.id;
  return jsonb_build_object('id', b.id, 'campanhas', jsonb_array_length(v_ids));
end $$;

revoke execute on function public.excluir_balconista(bigint, text) from public, anon;
grant  execute on function public.excluir_balconista(bigint, text) to authenticated;

-- ============================================================
--  CONSULTA DO QLIK DO MÊS (v3.5.0) — mesmo conteúdo de migracoes/19-consulta-qlik-do-mes.sql.
--  Se mudar aqui, mude lá também.
-- ============================================================
create table if not exists public.comissao_consultas (
  id             bigint generated always as identity primary key,
  mes            text   not null,
  dados          jsonb  not null,           -- { apuracao, contrato, cod_farelo, dia_corte }
  consultado_em  timestamptz not null default now(),
  consultado_por uuid references public.perfis(id),
  conferido_em   timestamptz,
  conferido_por  uuid references public.perfis(id),
  constraint comissao_consultas_mes_unico unique (mes),
  constraint comissao_consultas_mes check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_consultas_dados check (jsonb_typeof(dados) = 'object'),
  constraint comissao_consultas_tamanho check (pg_column_size(dados) < 2000000)
);

-- Carimbos do banco (o app não escolhe quem nem quando) e trava do mês fechado.
create or replace function public.preparar_comissao_consulta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Quem não é administrador para no RLS logo depois: não conta nada sobre o mês aqui.
  if not public.eh_aprovador() then return new; end if;
  if exists (select 1 from public.comissao_fechamentos f
              where f.status = 'fechado' and (f.mes = new.mes or (tg_op = 'UPDATE' and f.mes = old.mes))) then
    raise exception 'O mês % está fechado. Reabra o mês para consultar o Qlik de novo.', new.mes;
  end if;
  if tg_op = 'INSERT' then
    new.consultado_em := now(); new.consultado_por := auth.uid();
    new.conferido_em := null;  new.conferido_por := null;
    return new;
  end if;
  new.mes := old.mes;
  if new.dados is distinct from old.dados then
    -- Consulta nova: o que foi conferido antes não vale mais.
    new.consultado_em := now(); new.consultado_por := auth.uid();
    new.conferido_em := null;  new.conferido_por := null;
  else
    new.consultado_em := old.consultado_em; new.consultado_por := old.consultado_por;
    if new.conferido_em is null then new.conferido_por := null;
    elsif old.conferido_em is null then new.conferido_em := now(); new.conferido_por := auth.uid();
    else new.conferido_em := old.conferido_em; new.conferido_por := old.conferido_por;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.preparar_comissao_consulta() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissao_consulta on public.comissao_consultas;
create trigger ao_preparar_comissao_consulta before insert or update on public.comissao_consultas
  for each row execute function public.preparar_comissao_consulta();

alter table public.comissao_consultas enable row level security;
revoke all on table public.comissao_consultas from public, anon, authenticated;
grant select on table public.comissao_consultas to authenticated;
grant insert (mes, dados) on table public.comissao_consultas to authenticated;
grant update (dados, conferido_em) on table public.comissao_consultas to authenticated;

drop policy if exists comissao_consultas_admin_le on public.comissao_consultas;
create policy comissao_consultas_admin_le on public.comissao_consultas for select to authenticated using (public.eh_aprovador());
drop policy if exists comissao_consultas_admin_cria on public.comissao_consultas;
create policy comissao_consultas_admin_cria on public.comissao_consultas for insert to authenticated with check (public.eh_aprovador());
drop policy if exists comissao_consultas_admin_altera on public.comissao_consultas;
create policy comissao_consultas_admin_altera on public.comissao_consultas for update to authenticated
  using (public.eh_aprovador()) with check (public.eh_aprovador());

-- ============================================================
--  TOTAL DO FECHAMENTO CONFERIDO NO BANCO (v3.5.0) — mesmo conteúdo de
--  migracoes/20-total-do-fechamento.sql. Se mudar aqui, mude lá também.
-- ============================================================
create or replace function public.validar_total_fechamento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_linhas jsonb := new.dados->'resultado'->'linhas';
  v_clt    numeric;
  v_pj     numeric;
begin
  if new.status <> 'fechado' then return new; end if;
  if jsonb_typeof(v_linhas) is distinct from 'array' then v_linhas := '[]'::jsonb; end if;
  select coalesce(sum((l->>'valor_pagar')::numeric) filter (where coalesce(l->>'regime', '') <> 'PJ'), 0),
         coalesce(sum((l->>'valor_pagar')::numeric) filter (where l->>'regime' = 'PJ'), 0)
    into v_clt, v_pj
  from jsonb_array_elements(v_linhas) l;
  if new.total_clt <> v_clt or new.total_pj <> v_pj or new.total <> v_clt + v_pj then
    raise exception 'O total do fechamento não confere com as linhas da apuração (CLT %, PJ %). Busque as vendas de novo e feche outra vez.', v_clt, v_pj;
  end if;
  return new;
end $$;
revoke execute on function public.validar_total_fechamento() from public, anon, authenticated;

drop trigger if exists ao_validar_total_fechamento on public.comissao_fechamentos;
create trigger ao_validar_total_fechamento before insert or update on public.comissao_fechamentos
  for each row execute function public.validar_total_fechamento();

-- ============================================================
--  FORNECEDORES DA COMISSÃO (v3.6.0) — mesmo conteúdo de
--  migracoes/21-fornecedores-da-comissao.sql. Se mudar aqui, mude lá também.
-- ============================================================
-- ---------- 1. fornecedores ----------
create table if not exists public.comissao_fornecedores (
  id              bigint generated always as identity primary key,
  codigo          text not null,
  nome            text not null,
  grupo           text not null,
  pct_clt         numeric(5,2),
  pct_televendas  numeric(5,2),
  pct_pj          numeric(5,2),
  vale_de         text not null default '2000-01',
  ativo           boolean not null default true,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references public.perfis(id) on delete set null,
  constraint comissao_fornecedores_codigo_unico unique (codigo),
  constraint comissao_fornecedores_codigo check (codigo ~ '^[0-9]{1,10}$'),
  constraint comissao_fornecedores_nome   check (char_length(btrim(nome)) between 1 and 80),
  constraint comissao_fornecedores_grupo  check (grupo in ('principal', 'secundario')),
  constraint comissao_fornecedores_vale   check (vale_de ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint comissao_fornecedores_pct    check (
    grupo = 'principal'
    or (pct_clt between 0 and 20 and pct_televendas between 0 and 20 and pct_pj between 0 and 20))
);

-- ---------- 2. exceções por pessoa ----------
create table if not exists public.comissao_excecoes (
  id              bigint generated always as identity primary key,
  comissionado_id bigint not null references public.comissionados(id),
  fornecedor_id   bigint not null references public.comissao_fornecedores(id),
  pct             numeric(5,2) not null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references public.perfis(id) on delete set null,
  constraint comissao_excecoes_unica unique (comissionado_id, fornecedor_id),
  constraint comissao_excecoes_pct check (pct between 0 and 20)
);

-- ---------- 3. parâmetros: principal e "Outros fornecedores" ----------
alter table public.comissao_parametros add column if not exists principal_modo        text not null default 'todos';
alter table public.comissao_parametros add column if not exists pct_outros_clt        numeric(5,2);
alter table public.comissao_parametros add column if not exists pct_outros_televendas numeric(5,2);
alter table public.comissao_parametros add column if not exists pct_outros_pj         numeric(5,2);
alter table public.comissao_parametros drop constraint if exists comissao_parametros_principal;
alter table public.comissao_parametros add constraint comissao_parametros_principal check (
  principal_modo in ('todos', 'lista')
  and (pct_outros_clt is null or pct_outros_clt between 0 and 20)
  and (pct_outros_televendas is null or pct_outros_televendas between 0 and 20)
  and (pct_outros_pj is null or pct_outros_pj between 0 and 20)
  and (principal_modo = 'todos' or (pct_outros_clt is not null and pct_outros_televendas is not null and pct_outros_pj is not null)));

-- ---------- 4. carimbos e travas ----------
create or replace function public.preparar_comissao_fornecedor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nome := btrim(regexp_replace(coalesce(new.nome, ''), '\s+', ' ', 'g'));
  new.codigo := btrim(coalesce(new.codigo, ''));
  if tg_op = 'UPDATE' then new.codigo := old.codigo; end if;   -- as exceções apontam para o fornecedor
  if new.grupo = 'principal' then new.pct_clt := null; new.pct_televendas := null; new.pct_pj := null; end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke execute on function public.preparar_comissao_fornecedor() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissao_fornecedor on public.comissao_fornecedores;
create trigger ao_preparar_comissao_fornecedor before insert or update on public.comissao_fornecedores
  for each row execute function public.preparar_comissao_fornecedor();

create or replace function public.preparar_comissao_excecao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.comissionado_id := old.comissionado_id;
    new.fornecedor_id := old.fornecedor_id;
  end if;
  if not exists (select 1 from public.comissao_fornecedores f where f.id = new.fornecedor_id and f.grupo = 'secundario') then
    raise exception 'Exceção de %% só vale para fornecedor secundário.';
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke execute on function public.preparar_comissao_excecao() from public, anon, authenticated;
drop trigger if exists ao_preparar_comissao_excecao on public.comissao_excecoes;
create trigger ao_preparar_comissao_excecao before insert or update on public.comissao_excecoes
  for each row execute function public.preparar_comissao_excecao();

drop trigger if exists ao_auditar_comissao_fornecedor on public.comissao_fornecedores;
create trigger ao_auditar_comissao_fornecedor after insert or update on public.comissao_fornecedores
  for each row execute function public.auditar_comissao();
drop trigger if exists ao_auditar_comissao_excecao on public.comissao_excecoes;
create trigger ao_auditar_comissao_excecao after insert or update on public.comissao_excecoes
  for each row execute function public.auditar_comissao();

-- ---------- 5. semente ----------
-- O Farelo de hoje vira o 1º secundário, com os % de Parâmetros.
insert into public.comissao_fornecedores (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj)
select p.cod_farelo, 'Farelo', 'secundario', p.pct_clt_farelo, p.pct_televendas_farelo, p.pct_pj_farelo
from public.comissao_parametros p
on conflict (codigo) do nothing;

-- O pct_farelo de cada pessoa vira exceção só quando difere do padrão do regime.
insert into public.comissao_excecoes (comissionado_id, fornecedor_id, pct)
select c.id, f.id, c.pct_farelo
from public.comissionados c
cross join public.comissao_parametros p
join public.comissao_fornecedores f on f.codigo = p.cod_farelo
where c.pct_farelo is distinct from case c.regime when 'PJ' then p.pct_pj_farelo
                                                  when 'TELEVENDAS' then p.pct_televendas_farelo
                                                  else p.pct_clt_farelo end
on conflict (comissionado_id, fornecedor_id) do nothing;

-- ---------- 6. quem lê e grava: só o administrador ativo; ninguém apaga ----------
alter table public.comissao_fornecedores enable row level security;
alter table public.comissao_excecoes     enable row level security;
revoke all on table public.comissao_fornecedores, public.comissao_excecoes from public, anon, authenticated;
grant select on table public.comissao_fornecedores, public.comissao_excecoes to authenticated;
grant insert (codigo, nome, grupo, pct_clt, pct_televendas, pct_pj, vale_de, ativo) on public.comissao_fornecedores to authenticated;
grant update (nome, grupo, pct_clt, pct_televendas, pct_pj, vale_de, ativo) on public.comissao_fornecedores to authenticated;
grant insert (comissionado_id, fornecedor_id, pct) on public.comissao_excecoes to authenticated;
grant update (pct) on public.comissao_excecoes to authenticated;

do $$
declare t text;
begin
  foreach t in array array['comissao_fornecedores', 'comissao_excecoes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_le', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.eh_aprovador())', t || '_admin_le', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_cria', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.eh_aprovador())', t || '_admin_cria', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_altera', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.eh_aprovador()) with check (public.eh_aprovador())', t || '_admin_altera', t);
  end loop;
end $$;

-- comissionados.pct_farelo é obsoleto: o app grava o % efetivo do Farelo, mas não lê.
comment on column public.comissionados.pct_farelo is 'Obsoleto desde a 21: o % de cada secundário fica em comissao_fornecedores e comissao_excecoes.';
comment on column public.comissao_parametros.cod_farelo is 'Obsoleto desde a 21: o Farelo é um secundário em comissao_fornecedores.';

-- ============================================================
--  DEPOIS DE FAZER SEU PRIMEIRO LOGIN NO APP, rode a linha abaixo
--  trocando pelo seu e-mail, para virar o primeiro administrador:
--
--  update perfis set papel = 'aprovador', ativo = true where email = 'seu.email@empresa.com.br';
--
--  Os próximos usuários você libera pelo app, no menu Usuários.
-- ============================================================
