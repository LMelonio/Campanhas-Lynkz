-- ============================================================
--  16 — COMISSÕES: CADASTRO DE COMISSIONADOS E PARÂMETROS (v3.2.0)
--
--  Entrega 1 da função Comissões (só o administrador vê e grava):
--    1. comissao_parametros: uma linha só (id = 1) com o código do Farelo, o dia
--       de corte da apuração, os % padrão por regime, os gatilhos e faixas do
--       Contrato de Resultado e os nomes do Qlik que não comissionam (TERRAZOO…).
--    2. comissionados: cada vendedor CLT, Televendas ou PJ com os % dele, os nomes
--       como aparecem no Qlik (Vendedor B2B, um ou mais), acordo mínimo (só CLT),
--       metas do Contrato de Resultado (só PJ) e dados da PJ para recibo e ADP.
--       A meta continua valendo nos meses seguintes; meta_atualizada_em guarda a
--       última alteração (o app mostra discretamente).
--       Ninguém apaga: quem sai fica desativado (o histórico dos meses fechados
--       vai apontar para ele).
--    3. comissao_auditoria: o que mudou em cada cadastro e nos parâmetros, quem e quando.
--
--  Um nome do Qlik só pode estar em um comissionado ativo (sem diferenciar
--  maiúsculas e espaços). O app também confere sem acento.
--
--  Pode rodar duas vezes. Pré-requisito: a 15.
--  Desfazer: 16-rollback.sql. Depois: 16-validacao.sql.
--  Cadastro inicial (opcional): 16-carga-inicial.sql, que fica fora do GitHub (dados-privados/).
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
