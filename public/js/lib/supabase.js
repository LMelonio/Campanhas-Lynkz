// Cliente do Supabase. Único arquivo trocado para rodar sem banco:
// copie dev/supabase-simulado.js por cima deste (ver dev/LEIA-ME no topo dele).
// url-auth.js vem primeiro: lê os tokens da URL antes de o cliente consumi-los.
import './url-auth.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const C = window.CONFIG;
export const sb = createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
