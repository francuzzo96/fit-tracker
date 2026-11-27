// Fit Tracker: riceve dalle email (Google Apps Script nell'account dell'utente) i messaggi di banca e negozi.
// Autenticazione con un codice segreto generato nell'app: qui arriva il codice, nel database c'è solo il suo hash (ingest_tokens).
// I messaggi finiscono in data.mail; l'app li trasforma in movimenti e ordini e poi cancella il testo.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const str = (x: unknown, n: number) => String(x ?? "").slice(0, n);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Metodo non permesso" }, 405);
  let body: { token?: string; items?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: "Richiesta non valida" }, 400); }
  const token = str(body.token, 200);
  if (token.length < 32 || !Array.isArray(body.items)) return json({ error: "Richiesta non valida" }, 400);
  const { data: tk } = await db.from("ingest_tokens").select("user_id").eq("token_hash", await sha(token)).maybeSingle();
  if (!tk) return json({ error: "Codice non valido: rigeneralo nell'app e aggiorna lo script" }, 401);

  // deno-lint-ignore no-explicit-any
  const items = body.items.slice(0, 100).map((x: any) => ({
    id: str(x?.id, 120), d: str(x?.d, 10), from: str(x?.from, 200), subj: str(x?.subj, 300), text: str(x?.text, 2000),
  })).filter((x) => x.id.startsWith("mail:") && /^\d{4}-\d{2}-\d{2}$/.test(x.d));
  if (!items.length) return json({ added: 0 });

  for (let i = 0; i < 4; i++) {
    const { data: row } = await db.from("fit_data").select("data, updated_at").eq("user_id", tk.user_id).maybeSingle();
    if (!row) return json({ error: "Apri prima Fit Tracker e accedi almeno una volta" }, 409);
    const d = row.data || {};
    const seen = new Set<string>([...(d.mail || []), ...(d.money || []), ...(d.orders || [])].map((x: { id: string }) => x.id).concat(d.mailSkip || []));
    const fresh = items.filter((x) => !seen.has(x.id));
    if (!fresh.length) return json({ added: 0 });
    d.mail = (d.mail || []).concat(fresh).slice(-300);
    d.mailAt = new Date().toISOString();
    // scrivo solo se nessuno ha cambiato i dati nel frattempo, altrimenti rileggo e riprovo
    const { data: w } = await db.from("fit_data").update({ data: d }).eq("user_id", tk.user_id).eq("updated_at", row.updated_at).select("updated_at");
    if (w && w.length) {
      await db.from("ingest_tokens").update({ last_at: new Date().toISOString() }).eq("user_id", tk.user_id);
      return json({ added: fresh.length });
    }
  }
  return json({ error: "Dati occupati, riprova" }, 503);
});
