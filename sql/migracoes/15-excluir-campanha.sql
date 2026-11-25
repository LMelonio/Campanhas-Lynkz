-- ============================================================
--  15 — EXCLUIR CAMPANHA (só administrador) (v3.1.0)
--
--  O app continua sem permissão de DELETE na tabela campanhas. A exclusão
--  passa só pela função excluir_campanha(id, motivo), que:
--    - confere no banco que quem chama é administrador ATIVO;
--    - exige um motivo (3 a 500 caracteres);
--    - guarda uma cópia completa (campanha + notas fiscais) em
--      campanhas_excluidas, com quem excluiu e quando — nada some sem rastro;
--    - apaga a campanha (as notas saem junto, por on delete cascade).
--  A cópia só é lida por administrador e ninguém altera nem apaga pela API.
--
--  Só acrescenta tabela e função. Pode rodar duas vezes. Pré-requisito: a 14.
--  Desfazer: 15-rollback.sql. Depois: 15-validacao.sql.
-- ============================================================

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
