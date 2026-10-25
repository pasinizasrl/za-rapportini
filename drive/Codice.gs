/**
 * ZA srl – Foto cantiere dai rapportini → Google Drive  (versione 3 – più veloce)
 * - Riceve le foto dalla pagina rapportini (controllo nome + PIN) e le salva in:
 *   <cartella FOTO> / <cantiere> / <aaaa-mm-gg> / <operatore_ora>.jpg
 * - Restituisce le foto alla galleria online (solo utenti abilitati, solo file della cartella FOTO),
 *   in formato "medio" leggero o originale, più foto per chiamata.
 */
const SB_URL = 'https://mzyvermpfusbbufhjwbu.supabase.co';
const SB_KEY = 'sb_publishable_P_r6pi6oRahzgvfwU-PgeQ_lGecNqwo';
// ⬇⬇ INCOLLA QUI tra gli apici il codice della tua cartella FOTO (la parte finale del link dopo /folders/)
const ID_CARTELLA = '';
const CARTELLA_PRINCIPALE = 'FOTO CANTIERI ZA'; // usata solo se ID_CARTELLA è vuoto
const CACHE = CacheService.getScriptCache();

function doGet() { // usata anche per "svegliare" lo script
  return risposta_({ ok: true, servizio: 'Foto cantieri ZA' });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.azione === 'leggi') return leggi_(d);
    if (!d.nome || !d.pin || !d.b64) return risposta_({ ok: false, err: 'DATI_MANCANTI' });
    const err = controlla_('rap_login', d.nome, d.pin); if (err) return risposta_({ ok: false, err: err });

    const nomeCan = pulisci_(d.cantiere || 'SENZA CANTIERE'), data = /^\d{4}-\d{2}-\d{2}$/.test(d.data || '') ? d.data : Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
    let giorno = cartellaCache_('g|' + nomeCan + '|' + data), cantiere = cartellaCache_('c|' + nomeCan);
    if (!giorno || !cantiere) {
      const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try {
        cantiere = cantiere || cartella_(principale_(), nomeCan); CACHE.put('c|' + nomeCan, cantiere.getId(), 21600);
        giorno = cartella_(cantiere, data); CACHE.put('g|' + nomeCan + '|' + data, giorno.getId(), 21600);
      } finally { lock.releaseLock(); }
    }
    // nome file: AAAA.MM.GG - <cantiere> - 001.jpg  (numerazione progressiva nella cartella del giorno)
    const base = data.replace(/-/g, '.') + ' - ' + nomeCan.slice(0, 90);
    const lock2 = LockService.getScriptLock(); lock2.waitLock(20000);
    let nomeFile, f;
    try {
      const kn = 'n|' + giorno.getId(); let n = +(CACHE.get(kn) || 0);
      if (!n) { const it = giorno.getFiles(); while (it.hasNext()) { it.next(); n++; } }
      n++; CACHE.put(kn, String(n), 21600);
      nomeFile = base + ' - ' + ('00' + n).slice(-3) + '.jpg';
      f = giorno.createFile(Utilities.newBlob(Utilities.base64Decode(d.b64), 'image/jpeg', nomeFile));
    } finally { lock2.releaseLock(); }
    f.setDescription('Operatore: ' + d.nome + '\nCantiere: ' + (d.cantiere || '') + '\nData: ' + data);
    CACHE.put('in|' + f.getId(), '1', 21600);
    return risposta_({ ok: true, id: f.getId(), nome: nomeFile, url: f.getUrl(), cartella: giorno.getUrl(), cartellaCantiere: cantiere.getUrl() });
  } catch (err) {
    return risposta_({ ok: false, err: String(err && err.message || err) });
  }
}

/** Galleria online: d.ids (una o più foto), d.dim = 'm' (media, leggera) oppure 'o' (originale) */
function leggi_(d) {
  const ids = (d.ids || (d.id ? [d.id] : [])).slice(0, 6);
  if (!d.nome || !d.pin || !ids.length) return risposta_({ ok: false, err: 'DATI_MANCANTI' });
  const err = controlla_('rap_galleria_ok', d.nome, d.pin); if (err) return risposta_({ ok: false, err: err });
  const rootId = ID_CARTELLA ? ID_CARTELLA.trim() : principale_().getId(), out = {};
  let token = null;
  ids.forEach(id => {
    try {
      const f = DriveApp.getFileById(id);
      if (!CACHE.get('in|' + id)) { if (!dentro_(f, rootId)) { out[id] = { err: 'NON_CONSENTITO' }; return; } CACHE.put('in|' + id, '1', 21600); }
      let bytes = null, mime = 'image/jpeg';
      if (d.dim === 'm') { // versione ridotta generata da Google: molto più leggera
        try { token = token || ScriptApp.getOAuthToken();
          const r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?sz=w1100&id=' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: true });
          if (r.getResponseCode() === 200 && /^image\//.test(r.getHeaders()['Content-Type'] || r.getHeaders()['content-type'] || '')) { bytes = r.getContent(); mime = 'image/jpeg'; }
        } catch (e) {}
      }
      if (!bytes) { const b = f.getBlob(); bytes = b.getBytes(); mime = b.getContentType(); }
      out[id] = { mime: mime, nome: f.getName(), b64: Utilities.base64Encode(bytes) };
    } catch (e) { out[id] = { err: String(e && e.message || e) }; }
  });
  if (d.id && !d.ids) { const x = out[d.id] || {}; return risposta_(x.err ? { ok: false, err: x.err } : Object.assign({ ok: true }, x)); }
  return risposta_({ ok: true, foto: out });
}

/** controllo nome + PIN (ricordato per 10 minuti per non rallentare) */
function controlla_(rpc, nome, pin) {
  const k = 'ok|' + rpc + '|' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(nome).toUpperCase() + '|' + pin));
  if (CACHE.get(k)) return '';
  const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + rpc, { method: 'post', contentType: 'application/json', headers: { apikey: SB_KEY },
    payload: JSON.stringify({ p_nome: nome, p_pin: pin }), muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText() || '{}');
  if (!j.ok) return j.err || 'PIN_ERRATO';
  CACHE.put(k, '1', 600); return '';
}
function cartellaCache_(k) { const id = CACHE.get(k); if (!id) return null; try { return DriveApp.getFolderById(id); } catch (e) { return null; } }
function dentro_(f, rootId) {
  let liv = [f.getParents()];
  for (let n = 0; n < 4 && liv.length; n++) {
    const prossimi = [];
    for (const it of liv) while (it.hasNext()) { const p = it.next(); if (p.getId() === rootId) return true; prossimi.push(p.getParents()); }
    liv = prossimi;
  }
  return false;
}
function principale_() {
  return ID_CARTELLA ? DriveApp.getFolderById(ID_CARTELLA.trim()) : cartella_(DriveApp.getRootFolder(), CARTELLA_PRINCIPALE);
}
function cartella_(padre, nome) {
  const it = padre.getFoldersByName(nome);
  return it.hasNext() ? it.next() : padre.createFolder(nome);
}
function pulisci_(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'SENZA NOME'; }
function risposta_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Esegui questa funzione dall'editor per dare i permessi (Drive + connessione esterna). */
function autorizza() {
  const root = principale_();
  UrlFetchApp.fetch(SB_URL + '/rest/v1/', { headers: { apikey: SB_KEY }, muteHttpExceptions: true });
  ScriptApp.getOAuthToken();
  Logger.log('OK – cartella: ' + root.getUrl());
}
