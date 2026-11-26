-- ============================================================
--  17 — COMISSÕES DO MÊS: PREMIAÇÕES, AJUSTES, CONTRATO, NOTA FISCAL E HISTÓRICO (v3.3.0)
--
--  1. comissao_premiacoes: premiação de campanha lançada à mão para um vendedor
--     (CLT ou PJ) num mês de apuração. Ninguém apaga: remover = desativar.
--  2. comissao_ajustes: acréscimo ou desconto fora da regra, com motivo (entra
--     depois do acordo mínimo). Remover = desativar.
--  3. comissao_mes_pj: uma linha por representante PJ e mês de apuração com
--       - as metas do Contrato de Resultado (do mês anterior ao da apuração:
--         a linha de "2026-10" guarda as metas de setembro/2026);
--       - o realizado informado à mão, quando o Qlik não serve (motivo obrigatório);
--       - o número e o valor da nota fiscal que vão na ADP.
--     Sem linha no mês, o app usa a meta do cadastro (comissionados.meta_*).
--  4. comissao_fechamentos: histórico das comissões. Fechar o mês grava uma cópia
--     do que foi pago (cálculo, cadastro usado, premiações e ajustes). Mês fechado
--     não aceita mudança em premiação, ajuste, contrato ou NF; reabrir pede motivo.
--  Tudo passa pela auditoria da migração 16.
--
--  Pode rodar duas vezes. Pré-requisito: a 16.
--  Desfazer: 17-rollback.sql. Depois: 17-validacao.sql.
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
