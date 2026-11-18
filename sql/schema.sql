-- ============================================================
--  APROVAÇÃO DE CAMPANHAS PROMOCIONAIS
--  Cole este arquivo inteiro no SQL Editor do Supabase e rode.
--  Instalação NOVA (v2.0.0). Para atualizar um banco da v1, use
--  migracoes/04, 05 e 06 — ver COMECE-AQUI.md, Parte 0.
-- ============================================================

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
--  DEPOIS DE FAZER SEU PRIMEIRO LOGIN NO APP, rode a linha abaixo
--  trocando pelo seu e-mail, para virar o aprovador:
--
--  update perfis set papel = 'aprovador' where email = 'seu.email@empresa.com.br';
-- ============================================================
