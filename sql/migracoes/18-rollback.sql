-- ============================================================
--  18 — ROLLBACK: tira a função de excluir balconista e volta a mensagem
--  do limite da 12. As campanhas ficam como estão (as que perderam o
--  balconista continuam com balconista_id nulo e os dados de quem recebeu).
--  A tabela balconistas_excluidos FICA (é o registro do que já foi excluído).
--  Para apagá-la de vez, depois de salvar o conteúdo:
--    drop table public.balconistas_excluidos;
-- ============================================================
drop function if exists public.excluir_balconista(bigint, text);

create or replace function public.limitar_balconistas_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / cargas
  -- Fila por empresa: dois cadastros ao mesmo tempo não passam juntos do limite.
  perform pg_advisory_xact_lock(1202, new.empresa_id::int);
  if (select count(*) from public.balconistas where empresa_id = new.empresa_id) >= 2 then
    raise exception 'Esta empresa já tem 2 balconistas cadastrados, que é o limite. Edite um deles na ficha da empresa.';
  end if;
  return new;
end $$;
revoke execute on function public.limitar_balconistas_empresa() from public, anon, authenticated;
