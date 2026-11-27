-- ============================================================
--  18 — EXCLUIR BALCONISTA (só administrador) (v3.5.0)
--
--  O limite é de 2 balconistas por empresa, contando os desativados. Para
--  liberar a vaga sem misturar o histórico de duas pessoas num cadastro só,
--  o administrador exclui o cadastro antigo. O app continua sem DELETE
--  direto: a exclusão passa só por excluir_balconista(id, motivo), que
--    - confere no banco que quem chama é administrador ATIVO;
--    - exige um motivo (3 a 500 caracteres);
--    - barra se o balconista estiver em campanha Pendente;
--    - nas campanhas Swile já decididas sem os dados de quem recebe, grava os
--      do cadastro na campanha (a ADP continua saindo igual);
--    - solta o balconista das campanhas (balconista_id = null);
--    - guarda a cópia (cadastro + ids das campanhas) em balconistas_excluidos;
--    - apaga o cadastro, o que libera a vaga na hora.
--  A cópia só é lida por administrador e ninguém altera nem apaga pela API.
--
--  Pode rodar duas vezes. Pré-requisito: a 17.
--  Desfazer: 18-rollback.sql. Depois: 18-validacao.sql.
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

-- Limite de 2 por empresa (migração 12): a mensagem agora aponta para a exclusão.
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
