/**
 * ZA srl – Foto cantiere dai rapportini → Google Drive
 * Riceve le foto dalla pagina rapportini degli operai, controlla nome + PIN
 * e le salva in: FOTO CANTIERI ZA / <cantiere> / <aaaa-mm-gg> / <operatore_ora>.jpg
 */
const SB_URL = 'https://mzyvermpfusbbufhjwbu.supabase.co';
const SB_KEY = 'sb_publishable_P_r6pi6oRahzgvfwU-PgeQ_lGecNqwo';
const CARTELLA_PRINCIPALE = 'FOTO CANTIERI ZA';

function doGet() {
  const root = cartella_(DriveApp.getRootFolder(), CARTELLA_PRINCIPALE);
  return risposta_({ ok: true, servizio: 'Foto cantieri ZA', cartella: root.getUrl() });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.nome || !d.pin || !d.b64) return risposta_({ ok: false, err: 'DATI_MANCANTI' });
    // controllo nome + PIN sullo stesso database dei rapportini
    const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/rap_login', {
      method: 'post', contentType: 'application/json', headers: { apikey: SB_KEY },
      payload: JSON.stringify({ p_nome: d.nome, p_pin: d.pin }), muteHttpExceptions: true });
    const j = JSON.parse(r.getContentText() || '{}');
    if (!j.ok) return risposta_({ ok: false, err: j.err || 'PIN_ERRATO' });

    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    let giorno, cantiere, root;
    try {
      root = cartella_(DriveApp.getRootFolder(), CARTELLA_PRINCIPALE);
      cantiere = cartella_(root, pulisci_(d.cantiere || 'SENZA CANTIERE'));
      giorno = cartella_(cantiere, /^\d{4}-\d{2}-\d{2}$/.test(d.data || '') ? d.data : Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd'));
    } finally { lock.releaseLock(); }

    const ora = Utilities.formatDate(new Date(), 'Europe/Rome', 'HHmmss');
    const nomeFile = pulisci_(d.nome).replace(/\s+/g, '_') + '_' + ora + '_' + Math.floor(Math.random() * 1000) + '.jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(d.b64), 'image/jpeg', nomeFile);
    const f = giorno.createFile(blob);
    f.setDescription('Operatore: ' + d.nome + '\nCantiere: ' + (d.cantiere || '') + '\nData: ' + (d.data || '') + (d.nota ? '\nNota: ' + d.nota : ''));
    return risposta_({ ok: true, id: f.getId(), nome: nomeFile, url: f.getUrl(), cartella: giorno.getUrl(), cartellaCantiere: cantiere.getUrl() });
  } catch (err) {
    return risposta_({ ok: false, err: String(err && err.message || err) });
  }
}

function cartella_(padre, nome) {
  const it = padre.getFoldersByName(nome);
  return it.hasNext() ? it.next() : padre.createFolder(nome);
}
function pulisci_(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'SENZA NOME'; }
function risposta_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Esegui questa funzione UNA volta dall'editor per dare i permessi (Drive + connessione esterna). */
function autorizza() {
  const root = cartella_(DriveApp.getRootFolder(), CARTELLA_PRINCIPALE);
  UrlFetchApp.fetch(SB_URL + '/rest/v1/', { headers: { apikey: SB_KEY }, muteHttpExceptions: true });
  Logger.log('OK – cartella: ' + root.getUrl());
}
