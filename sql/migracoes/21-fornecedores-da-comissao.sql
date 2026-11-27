-- ============================================================
--  21 — FORNECEDORES DA COMISSÃO: PRINCIPAL E SECUNDÁRIOS (v3.6.0)
--
--  Antes havia só "venda principal" e "Farelo" (um código fixo nos Parâmetros
--  e um % por pessoa). Agora:
--    - comissao_fornecedores: fornecedores com regra própria.
--        grupo 'secundario': % por regime (CLT, Televendas, PJ). Hoje: Farelo 6610.
--        grupo 'principal': só usado quando o principal é uma lista
--        (comissao_parametros.principal_modo = 'lista').
--        vale_de: mês (AAAA-MM) a partir do qual a regra vale.
--        Ninguém apaga: desliga com ativo = false.
--    - comissao_excecoes: % de um secundário só para uma pessoa. Para remover,
--      a tela grava o % igual ao padrão do regime (a leitura ignora).
--    - comissao_parametros.principal_modo: 'todos' (todos menos os secundários,
--      como antes) ou 'lista'. Com 'lista', fornecedor fora das listas entra em
--      "Outros fornecedores", com pct_outros_* por regime (obrigatórios).
--  Semente: o Farelo de hoje vira o 1º secundário com os % dos Parâmetros; o
--  pct_farelo de quem tinha % diferente do padrão do regime vira exceção.
--
--  OBSOLETOS DESDE A 21 (o app não lê mais; ficam para o rollback e saem numa
--  migração futura): comissao_parametros.cod_farelo e pct_*_farelo,
--  comissionados.pct_farelo (o app grava nele o % efetivo do Farelo da pessoa).
--
--  Pode rodar duas vezes. Pré-requisito: a 20.
--  Desfazer: 21-rollback.sql. Depois: 21-validacao.sql.
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
