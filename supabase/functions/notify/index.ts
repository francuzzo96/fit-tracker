// Fit Tracker: notifiche push.
// GET            → chiave pubblica per l'iscrizione (le chiavi VAPID le genera la funzione e restano nella tabella push_keys, leggibile solo dal server).
// POST {test}    → notifica di prova all'utente che ha fatto login.
// POST {run}     → chiamata ogni 15 minuti da pg_cron: manda i promemoria dovuti (ognuno una volta sola, registrato in push_log).
import * as webpush from "jsr:@negrel/webpush@^0.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = "https://francuzzo96.github.io/fit-tracker/";

let app: webpush.ApplicationServer | null = null, pub = "";
async function server() {
  if (app) return app;
  const { data } = await db.from("push_keys").select("keys").eq("id", 1).maybeSingle();
  let exported = data?.keys;
  if (!exported) {
    exported = await webpush.exportVapidKeys(await webpush.generateVapidKeys({ extractable: true }));
    await db.from("push_keys").insert({ id: 1, keys: exported });
    const again = await db.from("push_keys").select("keys").eq("id", 1).single(); // se due chiamate sono partite insieme, vince la prima
    exported = again.data!.keys;
  }
  const vapidKeys = await webpush.importVapidKeys(exported, { extractable: true });
  pub = await webpush.exportApplicationServerKey(vapidKeys);
  app = await webpush.ApplicationServer.new({ contactInformation: SITE, vapidKeys });
  return app;
}

async function send(user: string, msg: { title: string; body: string; tag?: string }) {
  const a = await server();
  const { data: subs } = await db.from("push_subs").select("endpoint, sub").eq("user_id", user);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await a.subscribe(s.sub).pushTextMessage(JSON.stringify({ ...msg, url: SITE }), { ttl: 6 * 3600 } as webpush.PushMessageOptions);
      ok++;
    } catch (e) {
      if (e instanceof webpush.PushMessageError && e.isGone()) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push", e);
    }
  }
  return ok;
}

// ---- ora italiana e logica dei promemoria (stessa idea dell'app) ----
function romeNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const d = `${p.year}-${p.month}-${p.day}`;
  const wd = (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7;
  return { d, min: +p.hour * 60 + +p.minute, wd };
}
const mi = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const hm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
const addD = (d: string, k: number) => new Date(Date.parse(d + "T12:00:00Z") + k * 864e5).toISOString().slice(0, 10);
type Ev = { d: string; s?: string; e?: string; n: string; src?: number; sleep?: number };
function freeSlot(evs: Ev[]) {
  const E = evs.filter((x) => x.s && x.e).map((x) => [mi(x.s!), x.sleep ? Math.min(1439, mi(x.e!) + 480) : mi(x.e!)]).sort((a, b) => a[0] - b[0]);
  let cur = 360; const gaps: number[][] = [];
  for (const b of E.concat([[1320, 1320]])) { if (b[0] - cur >= 75) gaps.push([cur, b[0]]); cur = Math.max(cur, b[1]); }
  const ev = (x: number[]) => x[1] - Math.max(x[0], 1020) >= 75;
  const g = gaps.find(ev) || gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (!g) return null; const s = ev(g) ? Math.max(g[0], 1020) : g[0];
  return `${hm(s)}–${hm(Math.min(g[1], s + 90))}`;
}
// deno-lint-ignore no-explicit-any
function reminders(S: any, now: ReturnType<typeof romeNow>) {
  const N = { mattina: "07:30", acqua: true, scadenze: true, ...(S.notif || {}) };
  const out: { key: string; at: number; title: string; body: string }[] = [];
  const t = now.d;
  const evs: Ev[] = (S.ev || []).filter((x: Ev) => x.d === t);
  if (N.mattina) {
    const shifts = evs.filter((x) => !x.sleep).map((x) => `${x.n}${x.s ? " " + x.s + "–" + (x.e === "23:59" ? "" : x.e) : ""}`.replace(/–$/, ""));
    const ex = (S.ex || []).filter((e: { days?: number[] }) => (e.days || []).includes(now.wd)).map((e: { name: string }) => e.name);
    const slot = freeSlot(evs);
    const parts = [shifts.length ? "Oggi: " + shifts.join(", ") + "." : "Oggi nessun turno o impegno."];
    if (ex.length) parts.push(`Allenamento: ${ex.slice(0, 3).join(", ")}${ex.length > 3 ? "…" : ""}${slot ? `, meglio ${slot}` : ""}.`);
    else if (slot) parts.push(`Fascia libera per allenarti: ${slot}.`);
    out.push({ key: `${t}:mattina`, at: mi(N.mattina), title: "Buongiorno 👋", body: parts.join(" ") });
  }
  if (N.scadenze) {
    for (const x of (S.docs || []).filter((x: { t: string; done?: number; x?: string }) => x.t === "imp" && !x.done && x.x)) {
      const left = Math.round((Date.parse(x.x + "T12:00:00Z") - Date.parse(t + "T12:00:00Z")) / 864e5);
      if ([3, 1, 0].includes(left)) out.push({ key: `${t}:imp:${x.id}`, at: mi("09:00"), title: "Impegnativa in scadenza", body: `${x.n}: ${left ? `scade tra ${left} ${left === 1 ? "giorno" : "giorni"}` : "scade oggi"}. Prenota se non l'hai già fatto.` });
    }
  }
  if (N.acqua) {
    const kg = (S.w || []).length ? S.w[S.w.length - 1].kg : 70, target = Math.round(kg * 35), w = (S.water || {})[t] || 0;
    if (w < target / 2) out.push({ key: `${t}:acqua`, at: mi("16:00"), title: "Ricordati di bere 💧", body: `Oggi sei a ${(w / 1000).toFixed(1).replace(".", ",")} L su ${(target / 1000).toFixed(1).replace(".", ",")} L.` });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") { await server(); return json({ key: pub }); }
    const body = await req.json().catch(() => ({}));
    if (body.test) {
      const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" } });
      if (!who.ok) return json({ error: "Serve l'accesso a Fit Tracker" }, 401);
      const u = await who.json();
      const n = await send(u.id, { title: "Fit Tracker", body: "Le notifiche funzionano ✅", tag: "test" });
      return json({ sent: n });
    }
    if (body.run) {
      const now = romeNow();
      const { data: subs } = await db.from("push_subs").select("user_id");
      const users = [...new Set((subs ?? []).map((s) => s.user_id))];
      let sent = 0;
      for (const user of users) {
        const { data: row } = await db.from("fit_data").select("data").eq("user_id", user).maybeSingle();
        if (!row) continue;
        for (const r of reminders(row.data, now)) {
          if (now.min < r.at || now.min > r.at + 180) continue; // entro 3 ore dall'orario previsto
          const { error } = await db.from("push_log").insert({ user_id: user, key: r.key }); // già mandato → violazione di unicità
          if (error) continue;
          sent += await send(user, { title: r.title, body: r.body, tag: r.key });
        }
      }
      await db.from("push_log").delete().lt("sent_at", addD(now.d, -14));
      return json({ sent });
    }
    return json({ error: "Richiesta non valida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Errore del servizio notifiche" }, 500);
  }
});
