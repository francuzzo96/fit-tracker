// Fit Tracker: legge un calendario .ics (iCloud, Google, Outlook) e lo restituisce all'app.
// Serve perché il browser non può leggere direttamente quei calendari (CORS).
// Accesso solo con login (controllato qui sotto chiedendo a Supabase Auth chi è l'utente)
// e solo verso i servizi di calendario qui sotto: non è un proxy aperto.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const allowed = (h: string) =>
  /(^|\.)icloud\.com$/.test(h) || h === "calendar.google.com" || /(^|\.)outlook\.(live|office365)\.com$/.test(h);
const err = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err("Metodo non permesso", 405);
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!who.ok) return err("Serve l'accesso a Fit Tracker", 401);
  let u: URL;
  try {
    const { url } = await req.json();
    u = new URL(String(url).trim().replace(/^webcal:/i, "https:"));
  } catch {
    return err("Link del calendario non valido", 400);
  }
  if (u.protocol !== "https:" || !allowed(u.hostname)) return err("Questo link non è di iCloud, Google o Outlook", 400);
  try {
    const r = await fetch(u, { redirect: "follow", headers: { "User-Agent": "FitTracker/1.0" } });
    if (!allowed(new URL(r.url).hostname)) return err("Il calendario rimanda a un indirizzo non permesso", 502);
    const t = await r.text();
    if (!r.ok || !t.includes("BEGIN:VCALENDAR")) return err(`Calendario non trovato (${r.status}): controlla che sia pubblico`, 502);
    return new Response(t, { headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return err("Impossibile leggere il calendario adesso", 502);
  }
});
