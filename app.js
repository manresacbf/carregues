/* ═══════════════════════════════════════════════════════════════════
   Rendiment MCBF — lògica de l'app
   ═══════════════════════════════════════════════════════════════════
   Quatre idees que expliquen la resta del fitxer:

   1) La jugadora no té PIN: tria el seu nom un cop i el mòbil se'l
      recorda. El camí ha de ser el més curt possible.
   2) Tot el que s'envia passa abans per una cua local, així el
      vestidor sense cobertura no és un problema. El full desa una
      única fila per jugadora, dia i moment, de manera que reenviar
      el mateix registre mai no en crea un de nou.
   3) "El meu resum" es calcula AQUÍ, amb els registres que aquest
      mòbil ha enviat. No hi ha cap crida que digui "dona'm l'històric
      de la jugadora X" sense el PIN del cos tècnic: si n'hi hagués,
      canviant l'id es podrien llegir les dades d'una companya.
   4) L'app registra i avisa. No diagnostica ni recomana res.          */

'use strict';

/* ─────────────────────────────────────────────────────────────────────
   1. MODEL
   ───────────────────────────────────────────────────────────────────── */

/* Atenció a la direcció de les escales: a son i ànim, 5 és el millor;
   a fatiga, 5 és el pitjor (l'alerta de fatiga sostinguda mira ≥ 4). */
const ESC_SON = [
  { v: 1, e: '😵', l: 'Molt malament' },
  { v: 2, e: '😪', l: 'Malament' },
  { v: 3, e: '😐', l: 'Normal' },
  { v: 4, e: '🙂', l: 'Bé' },
  { v: 5, e: '😴', l: 'Molt bé' }
];
const ESC_FATIGA = [
  { v: 1, e: '💪', l: 'Gens' },
  { v: 2, e: '🙂', l: 'Poc' },
  { v: 3, e: '😐', l: 'Normal' },
  { v: 4, e: '😓', l: 'Bastant' },
  { v: 5, e: '🥵', l: 'Molt' }
];
const ESC_ANIM = [
  { v: 1, e: '😞', l: 'Molt baix' },
  { v: 2, e: '😕', l: 'Baix' },
  { v: 3, e: '😐', l: 'Normal' },
  { v: 4, e: '🙂', l: 'Bo' },
  { v: 5, e: '😃', l: 'Molt bo' }
];

const DIES_CURT = ['dl', 'dm', 'dc', 'dj', 'dv', 'ds', 'dg'];

const CLAUS = {
  jo: 'carregues.jo',
  roster: 'carregues.roster',
  meus: 'carregues.meus',
  pendents: 'carregues.pendents',
  staff: 'carregues.staff'
};

/* ─────────────────────────────────────────────────────────────────────
   2. ESTAT
   ───────────────────────────────────────────────────────────────────── */

let jo = null;                 // { id, nom, dorsal, equip }
let roster = { jugadores: [], equips: [], minuts_defecte: 90, dies_entrenament: [], ts: '' };
let meus = [];                 // registres propis, per al resum
let pendents = [];
let staff = { pin: '' };
let sincronitzant = false;
let equipTriat = '';
let carregantRoster = false;

/* ─────────────────────────────────────────────────────────────────────
   3. UTILITATS
   ───────────────────────────────────────────────────────────────────── */

const $ = (s, d) => (d || document).querySelector(s);
const $$ = (s, d) => Array.prototype.slice.call((d || document).querySelectorAll(s));

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const pad = (n) => ('0' + n).slice(-2);

/** Avui en hora local: amb toISOString(), a la nit ens canviaria el dia. */
function avuiISO() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function sumaDies(iso, n) {
  const p = iso.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Dilluns de la setmana d'una data. */
function dillunsDe(iso) {
  const p = iso.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return sumaDies(iso, -((d.getDay() + 6) % 7));
}

function diaCurt(iso) {
  const p = iso.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return DIES_CURT[(d.getDay() + 6) % 7];
}

function formatDia(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

function llegeix(clau, defecte) {
  try {
    const v = localStorage.getItem(clau);
    return v ? JSON.parse(v) : defecte;
  } catch (err) { return defecte; }
}

function guarda(clau, valor) {
  try { localStorage.setItem(clau, JSON.stringify(valor)); } catch (err) { /* quota */ }
}

let idToast;
function avisa(text, dolent) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('ko', !!dolent);
  t.classList.remove('amagat', 'fora');
  clearTimeout(idToast);
  idToast = setTimeout(() => {
    t.classList.add('fora');
    setTimeout(() => t.classList.add('amagat'), 250);
  }, dolent ? 5200 : 2600);
}

/* ─────────────────────────────────────────────────────────────────────
   4. CONNEXIÓ AMB EL FULL
   ───────────────────────────────────────────────────────────────────── *
   Apps Script triga sovint entre 4 i 11 segons a contestar i de tant en
   tant retorna un 404 pel mig. Per això: marge ampli, uns quants intents
   i escriptures idempotents (una fila per jugadora, dia i moment).      */

const ESPERES = [1000, 2500, 5000, 8000];
const TEMPS_MAX = 25000;
const LIMIT_TOTAL = 60000;

async function api(action, extra, intents) {
  if (!CONFIG.API_URL) throw new Error('Falta configurar API_URL');
  intents = intents || 3;
  const cos = Object.assign({ action: action }, extra || {});
  const INICI = Date.now();
  let ultim;

  for (let i = 0; i < intents; i++) {
    const ctrl = new AbortController();
    const rellotge = setTimeout(() => ctrl.abort(), TEMPS_MAX);
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // evita el preflight CORS
        body: JSON.stringify(cos),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dades = await res.json();
      if (dades && dades.ok === false && dades.error === 'PIN') throw new Error('PIN');
      return dades;
    } catch (err) {
      ultim = err;
      if (String(err && err.message) === 'PIN') throw err;
      if (i >= intents - 1 || Date.now() - INICI > LIMIT_TOTAL) break;
      await new Promise((r) => setTimeout(r, ESPERES[Math.min(i, ESPERES.length - 1)]));
    } finally {
      clearTimeout(rellotge);
    }
  }
  throw ultim || new Error('Sense connexió');
}

/* ─────────────────────────────────────────────────────────────────────
   5. CUA I REGISTRES PROPIS
   ───────────────────────────────────────────────────────────────────── */

function guardaMeus() { guarda(CLAUS.meus, meus); }
function guardaPendents() { guarda(CLAUS.pendents, pendents); }

/** Un registre per dia i moment també aquí: el mòbil ha de veure el mateix
    que acabarà havent-hi al full. */
function desaLocal(reg) {
  const i = meus.findIndex((r) => r.data === reg.data && r.moment === reg.moment);
  if (i === -1) meus.push(reg); else meus[i] = reg;
  // El resum només mira les últimes setmanes: no cal arrossegar-ho tot.
  meus = meus.filter((r) => r.data >= sumaDies(avuiISO(), -400));
  guardaMeus();
}

function registreDe(data, moment) {
  return meus.filter((r) => r.data === data && r.moment === moment)[0] || null;
}

function encua(reg) {
  desaLocal(reg);
  pendents.push({ opId: uuid(), payload: reg, errades: 0, ultimError: '' });
  guardaPendents();
  pintaSync();
  sincronitza();
}

function pintaSync() {
  const p = $('#estat-sync'), t = $('#estat-sync-text');
  if (!p) return;
  const n = pendents.length;
  p.classList.toggle('pendent', n > 0);
  p.classList.toggle('treballant', sincronitzant);
  if (sincronitzant) t.textContent = 'Enviant…';
  else if (!n) t.textContent = 'Enviat';
  else t.textContent = n === 1 ? '1 pendent' : n + ' pendents';
}

async function sincronitza(manual) {
  if (sincronitzant || !pendents.length) return;
  if (!navigator.onLine && !manual) return;

  sincronitzant = true;
  pintaSync();
  try {
    const res = await api('sync', { operacions: pendents.map((o) => ({ opId: o.opId, payload: o.payload })) });
    if (!res || !res.ok) throw new Error((res && res.error) || 'El full no ha contestat bé');

    const perId = {};
    ((res.data && res.data.resultats) || []).forEach((r) => { perId[r.opId] = r; });
    pendents = pendents.filter((o) => {
      const r = perId[o.opId];
      if (!r) return true;
      if (r.ok) return false;
      o.errades++;
      o.ultimError = r.error || '';
      return true;
    });
    guardaPendents();
    if (manual) avisa(pendents.length ? 'Encara queda alguna cosa per enviar' : 'Tot enviat');
  } catch (err) {
    if (manual) avisa('No s\'ha pogut connectar. Queda desat al mòbil i s\'enviarà sol.', true);
  } finally {
    sincronitzant = false;
    pintaSync();
  }
}

/* ─────────────────────────────────────────────────────────────────────
   6. QUI ETS
   ───────────────────────────────────────────────────────────────────── */

async function carregaRoster(silenci) {
  carregantRoster = true;
  if (!jo) pintaQui();
  try {
    const res = await api('getJugadores', { equip: equipTriat }, 3);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Error');
    roster = Object.assign(roster, res.data, { ts: new Date().toISOString() });
    guarda(CLAUS.roster, roster);
    carregantRoster = false;
    return true;
  } catch (err) {
    if (!silenci && CONFIG.API_URL) {
      // Sense botó, l'única sortida seria tancar i tornar a obrir l'app.
      $('#qui-error').innerHTML = (navigator.onLine
        ? 'El full no ha contestat. '
        : 'Sense connexió: cal cobertura el primer cop. ') +
        '<button type="button" class="chip" id="qui-reintenta" style="min-height:34px">Tornar-ho a provar</button>';
      $('#qui-reintenta').addEventListener('click', () => {
        $('#qui-error').textContent = '';
        carregaRoster(false).then(() => { if (!jo) pintaQui(); });
      });
    }
    carregantRoster = false;
    return false;
  }
}

function pintaQui() {
  $('#vista-app').classList.add('amagat');
  $('#vista-qui').classList.remove('amagat');

  const equips = roster.equips || [];
  const selEquip = $('#camp-equip');
  if (equips.length > 1) {
    selEquip.classList.remove('amagat');
    $('#equip').innerHTML = '<option value="">Tots</option>' +
      equips.map((e) => '<option value="' + esc(e) + '"' + (e === equipTriat ? ' selected' : '') + '>' + esc(e) + '</option>').join('');
    $('#equip').onchange = () => { equipTriat = $('#equip').value; pintaQui(); };
  } else {
    selEquip.classList.add('amagat');
  }

  const llista = (roster.jugadores || []).filter((j) => !equipTriat || j.equip === equipTriat);
  $('#llista-qui').innerHTML = llista.length
    ? llista.map((j) =>
        '<button type="button" class="fila-jug" data-id="' + esc(j.id) + '">' +
          '<span class="dorsal">' + esc(j.dorsal || '—') + '</span>' +
          '<span class="nom">' + esc(j.nom) + '</span>' +
        '</button>').join('')
    : (carregantRoster
        ? '<p class="buit">Carregant la llista…</p>'
        : '<p class="buit">Encara no hi ha cap jugadora activa al full.</p>');

  $$('#llista-qui [data-id]').forEach((b) => {
    b.addEventListener('click', () => {
      const j = (roster.jugadores || []).filter((x) => x.id === b.getAttribute('data-id'))[0];
      if (!j) return;
      jo = { id: j.id, nom: j.nom, dorsal: j.dorsal, equip: j.equip };
      guarda(CLAUS.jo, jo);
      obreApp('#/inici');
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────
   7. NAVEGACIÓ
   ───────────────────────────────────────────────────────────────────── */

function rutaActual() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { vista: parts[0] || 'inici', id: parts[1] || '' };
}

function ves(hash) { location.hash = hash; }

function obreApp(hash) {
  $('#vista-qui').classList.add('amagat');
  $('#vista-app').classList.remove('amagat');
  pintaSync();
  if (hash && location.hash !== hash) { location.hash = hash; return; }
  ruta();
}

function ruta() {
  const r = rutaActual();
  const staffVistes = ['staff', 'panell', 'fitxa'];

  if (staffVistes.indexOf(r.vista) !== -1) {
    $('#vista-qui').classList.add('amagat');
    $('#vista-app').classList.remove('amagat');
  } else if (!jo) {
    pintaQui();
    return;
  }

  const enrere = $('#enrere');
  enrere.classList.toggle('amagat', r.vista === 'inici');

  if (r.vista === 'abans') pintaAbans();
  else if (r.vista === 'despres') pintaDespres();
  else if (r.vista === 'resum') pintaResum();
  else if (r.vista === 'staff') pintaStaffPin();
  else if (r.vista === 'panell') pintaPanell();
  else if (r.vista === 'fitxa') pintaFitxa(r.id);
  else pintaInici();

  window.scrollTo(0, 0);
}

/* ─────────────────────────────────────────────────────────────────────
   8. INICI DE LA JUGADORA
   ───────────────────────────────────────────────────────────────────── */

function pintaInici() {
  $('#titol').textContent = 'Rendiment';
  const avui = avuiISO();
  const a = registreDe(avui, 'abans');
  const d = registreDe(avui, 'despres');

  const rajola = (hash, ic, tit, sub, fet) =>
    '<button type="button" class="accio' + (fet ? ' fet' : '') + '" data-ves="' + hash + '">' +
      '<span class="ic">' + ic + '</span>' +
      '<span><span class="tit">' + tit + '</span><br><span class="sub">' + sub + '</span></span>' +
      (fet ? '<span class="fetmarca">✓ fet</span>' : '') +
    '</button>';

  $('#contingut').innerHTML =
    '<p class="meta" style="margin:0">' + esc(diaCurt(avui)) + ' ' + esc(formatDia(avui)) + '</p>' +
    '<p class="hola">Hola, ' + esc((jo.nom || '').split(' ')[0]) + '</p>' +
    '<p class="meta" style="margin:0 0 16px">' + esc(jo.equip || '') + '</p>' +

    rajola('#/abans', '🌅', 'Abans de l\'entrenament', 'Com arribes avui', !!a) +
    rajola('#/despres', '🌙', 'Després de l\'entrenament', 'Com ha anat la sessió', !!d) +
    rajola('#/resum', '📈', 'El meu resum', 'La teva setmana i la teva càrrega', false) +

    '<p class="meta" style="text-align:center; margin-top:22px">' +
      'No ets ' + esc((jo.nom || '').split(' ')[0]) + '? ' +
      '<button type="button" class="chip" id="canvia-jug" style="min-height:34px">Canviar de jugadora</button>' +
    '</p>' +
    '<p class="meta" style="text-align:center; margin-top:10px">' +
      '<button type="button" class="chip" id="ves-staff" style="min-height:34px">Cos tècnic</button>' +
    '</p>';

  $$('#contingut [data-ves]').forEach((b) => b.addEventListener('click', () => ves(b.getAttribute('data-ves'))));
  $('#canvia-jug').addEventListener('click', () => {
    jo = null;
    localStorage.removeItem(CLAUS.jo);
    // Els registres del resum són de qui hi havia abans: fora.
    meus = []; guardaMeus();
    location.hash = '';
    pintaQui();
  });
  $('#ves-staff').addEventListener('click', () => ves('#/staff'));
}

/* ─────────────────────────────────────────────────────────────────────
   9. ABANS DE L'ENTRENAMENT
   ───────────────────────────────────────────────────────────────────── */

function blocEscala(clau, pregunta, escala) {
  return '<div class="pregunta"><div class="q">' + pregunta + '</div>' +
    '<div class="escala" data-escala="' + clau + '">' +
      escala.map((o) =>
        '<button type="button" class="mood" data-valor="' + o.v + '" aria-pressed="false">' +
          '<span class="emoji">' + o.e + '</span><span class="lbl">' + esc(o.l) + '</span>' +
        '</button>').join('') +
    '</div></div>';
}

function blocNumeros(clau, min, max, esqE, dreE) {
  const nums = [];
  for (let n = min; n <= max; n++) nums.push(n);
  return '<div class="escala11" data-numeros="' + clau + '">' +
      nums.map((n) => '<button type="button" class="num" data-valor="' + n + '" aria-pressed="false">' + n + '</button>').join('') +
    '</div><div class="extrems"><span>' + esqE + '</span><span>' + dreE + '</span></div>';
}

function enganxaUnicaTria(sel) {
  $$(sel + ' button').forEach((b) => b.addEventListener('click', () => {
    const ja = b.getAttribute('aria-pressed') === 'true';
    $$(sel + ' button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', ja ? 'false' : 'true');
  }));
}

function triat(sel) {
  const b = $(sel + ' button[aria-pressed="true"]');
  return b ? Number(b.getAttribute('data-valor')) : null;
}

function pintaAbans() {
  $('#titol').textContent = 'Abans';
  const previ = registreDe(avuiISO(), 'abans');

  $('#contingut').innerHTML =
    '<div class="card">' +
      blocEscala('son', 'Com has dormit?', ESC_SON) +
      blocEscala('fatiga', 'Com estàs de cansada?', ESC_FATIGA) +
      blocEscala('anim', 'Com estàs d\'ànim?', ESC_ANIM) +
      '<div class="pregunta" style="margin-bottom:0">' +
        '<div class="q">Tens alguna molèstia?</div>' +
        '<div class="sino" id="te-molestia">' +
          '<button type="button" data-valor="no" aria-pressed="false">No</button>' +
          '<button type="button" data-valor="si" aria-pressed="false">Sí</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="card amagat" id="bloc-molestia">' +
      '<div class="eyebrow">On et fa mal</div>' +
      '<div id="mapa"></div>' +
      '<div class="pregunta" style="margin:18px 0 0">' +
        '<div class="q">Quant et fa mal?</div>' +
        blocNumeros('dolor', 0, 10, '0 gens', '10 moltíssim') +
      '</div>' +
      '<div class="pregunta" style="margin:18px 0 0">' +
        '<div class="q">Et limita per entrenar?</div>' +
        '<div class="sino" id="limita">' +
          '<button type="button" data-valor="no" aria-pressed="false">No</button>' +
          '<button type="button" data-valor="si" aria-pressed="false">Sí</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="card"><div class="camp" style="margin:0">' +
      '<label for="comentari">Vols afegir alguna cosa? (opcional)</label>' +
      '<textarea id="comentari"></textarea>' +
    '</div></div>' +

    '<button class="btn" id="desa">' + (previ ? 'Actualitzar' : 'Enviar') + '</button>' +
    (previ ? '<p class="meta" style="text-align:center;margin-top:9px">Avui ja has contestat: si envies, s\'actualitza.</p>' : '');

  ['son', 'fatiga', 'anim'].forEach((k) => enganxaUnicaTria('[data-escala="' + k + '"]'));
  enganxaUnicaTria('[data-numeros="dolor"]');
  enganxaUnicaTria('#limita');
  enganxaUnicaTria('#te-molestia');

  // El detall de la molèstia només apareix si cal: qui no en té, no el veu.
  $$('#te-molestia button').forEach((b) => b.addEventListener('click', () => {
    const si = $('#te-molestia button[data-valor="si"]').getAttribute('aria-pressed') === 'true';
    $('#bloc-molestia').classList.toggle('amagat', !si);
    if (si && !$('#mapa').children.length) montaMapa();
  }));

  if (previ) reomple(previ);
  $('#desa').addEventListener('click', desaAbans);
}

let zonaTriada = '';

function montaMapa() {
  $('#mapa').appendChild(document.getElementById('tpl-cos').content.cloneNode(true));

  const mostra = () => { $('#zona-triada').textContent = zonaTriada || 'Toca on et fa mal'; };
  const totes = () => $$('#mapa .zona').concat($$('#mapa .zona-boto'));

  totes().forEach((z) => {
    const nom = z.getAttribute('data-zona') +
      (z.getAttribute('data-costat') ? ' ' + z.getAttribute('data-costat') : '');
    z.addEventListener('click', () => {
      const ja = z.getAttribute('aria-pressed') === 'true';
      totes().forEach((x) => x.setAttribute('aria-pressed', 'false'));
      z.setAttribute('aria-pressed', ja ? 'false' : 'true');
      zonaTriada = ja ? '' : nom;
      mostra();
    });
  });
  mostra();
}

function reomple(r) {
  const marca = (sel, valor) => {
    const b = $(sel + ' button[data-valor="' + valor + '"]');
    if (b) b.setAttribute('aria-pressed', 'true');
  };
  if (r.son) marca('[data-escala="son"]', r.son);
  if (r.fatiga) marca('[data-escala="fatiga"]', r.fatiga);
  if (r.anim) marca('[data-escala="anim"]', r.anim);
  marca('#te-molestia', r.te_molestia ? 'si' : 'no');
  if (r.te_molestia) {
    $('#bloc-molestia').classList.remove('amagat');
    montaMapa();
    zonaTriada = r.zona_molestia || '';
    $('#zona-triada').textContent = zonaTriada || 'Toca on et fa mal';
    $$('#mapa .zona').concat($$('#mapa .zona-boto')).forEach((z) => {
      const nom = z.getAttribute('data-zona') + (z.getAttribute('data-costat') ? ' ' + z.getAttribute('data-costat') : '');
      if (nom === zonaTriada) z.setAttribute('aria-pressed', 'true');
    });
    if (r.dolor !== null && r.dolor !== '') marca('[data-numeros="dolor"]', r.dolor);
    marca('#limita', r.limita ? 'si' : 'no');
  }
  if (r.comentari) $('#comentari').value = r.comentari;
}

function desaAbans() {
  const son = triat('[data-escala="son"]');
  const fatiga = triat('[data-escala="fatiga"]');
  const anim = triat('[data-escala="anim"]');
  const molestiaSi = $('#te-molestia button[data-valor="si"]').getAttribute('aria-pressed') === 'true';
  const molestiaNo = $('#te-molestia button[data-valor="no"]').getAttribute('aria-pressed') === 'true';

  if (!son || !fatiga || !anim) { avisa('Contesta les tres primeres preguntes', true); return; }
  if (!molestiaSi && !molestiaNo) { avisa('Digues si tens alguna molèstia', true); return; }

  encua({
    id: uuid(),
    id_jugadora: jo.id,
    data: avuiISO(),
    moment: 'abans',
    son: son,
    fatiga: fatiga,
    anim: anim,
    te_molestia: molestiaSi,
    zona_molestia: molestiaSi ? zonaTriada : '',
    dolor: molestiaSi ? triat('[data-numeros="dolor"]') : null,
    limita: molestiaSi && $('#limita button[data-valor="si"]').getAttribute('aria-pressed') === 'true',
    comentari: $('#comentari').value.trim(),
    timestamp: new Date().toISOString()
  });
  zonaTriada = '';
  avisa('Rebut. Bon entrenament!');
  ves('#/inici');
}

/* ─────────────────────────────────────────────────────────────────────
   10. DESPRÉS DE L'ENTRENAMENT
   ───────────────────────────────────────────────────────────────────── */

function pintaDespres() {
  $('#titol').textContent = 'Després';
  const previ = registreDe(avuiISO(), 'despres');
  const minuts = previ && previ.minuts ? previ.minuts : (roster.minuts_defecte || 90);

  $('#contingut').innerHTML =
    '<div class="card">' +
      '<div class="pregunta" style="margin-bottom:0">' +
        '<div class="q">Com de dura ha estat la sessió?</div>' +
        blocNumeros('duresa', 0, 10, '0 repòs · 5 moderada', '10 màxima') +
      '</div>' +
    '</div>' +
    '<div class="card"><div class="camp" style="margin:0">' +
      '<label for="minuts">Minuts entrenats</label>' +
      '<input id="minuts" type="number" inputmode="numeric" min="0" max="300" value="' + esc(minuts) + '">' +
    '</div></div>' +
    '<div class="card"><div class="camp" style="margin:0">' +
      '<label for="comentari">Vols afegir alguna cosa? (opcional)</label>' +
      '<textarea id="comentari"></textarea>' +
    '</div></div>' +
    '<button class="btn" id="desa">' + (previ ? 'Actualitzar' : 'Enviar') + '</button>' +
    (previ ? '<p class="meta" style="text-align:center;margin-top:9px">Avui ja has contestat: si envies, s\'actualitza.</p>' : '');

  enganxaUnicaTria('[data-numeros="duresa"]');
  if (previ) {
    const b = $('[data-numeros="duresa"] button[data-valor="' + previ.duresa + '"]');
    if (b) b.setAttribute('aria-pressed', 'true');
    if (previ.comentari) $('#comentari').value = previ.comentari;
  }

  $('#desa').addEventListener('click', () => {
    const duresa = triat('[data-numeros="duresa"]');
    const min = Number($('#minuts').value);
    if (duresa === null) { avisa('Digues com de dura ha estat', true); return; }
    if (!min || min < 0) { avisa('Posa els minuts entrenats', true); return; }

    encua({
      id: uuid(),
      id_jugadora: jo.id,
      data: avuiISO(),
      moment: 'despres',
      duresa: duresa,
      minuts: min,
      // La càrrega bona és la que calcula el full; aquesta és per al resum
      // d'aquest mòbil mentre el registre encara està a la cua.
      carrega: duresa * min,
      comentari: $('#comentari').value.trim(),
      timestamp: new Date().toISOString()
    });
    avisa('Rebut. Descansa!');
    ves('#/inici');
  });
}

/* ─────────────────────────────────────────────────────────────────────
   11. EL MEU RESUM  (només dades d'aquest mòbil)
   ───────────────────────────────────────────────────────────────────── */

function carregaSetmana(dilluns) {
  let t = 0, n = 0;
  meus.forEach((r) => {
    if (r.moment !== 'despres') return;
    if (r.data < dilluns || r.data > sumaDies(dilluns, 6)) return;
    t += Number(r.carrega) || (Number(r.duresa) * Number(r.minuts)) || 0;
    n++;
  });
  return { total: t, sessions: n };
}

function pintaResum() {
  $('#titol').textContent = 'El meu resum';
  const dilluns = dillunsDe(avuiISO());
  const ara = carregaSetmana(dilluns);

  // Ratio: cal tenir les 3 setmanes anteriors. Amb una sola setmana no hi ha
  // referència possible, i inventar-la seria pitjor que no dir res.
  const previes = [1, 2, 3].map((k) => carregaSetmana(sumaDies(dilluns, -7 * k)));
  const completes = previes.filter((p) => p.sessions > 0);
  let ratio = null, mitjanaPrevia = null;
  if (completes.length === 3) {
    mitjanaPrevia = (previes[0].total + previes[1].total + previes[2].total) / 3;
    if (mitjanaPrevia > 0) ratio = Math.round((ara.total / mitjanaPrevia) * 100) / 100;
  }

  const setmanes = [];
  for (let k = 5; k >= 0; k--) {
    const dl = sumaDies(dilluns, -7 * k);
    setmanes.push({ dl: dl, total: carregaSetmana(dl).total });
  }
  const sostre = Math.max.apply(null, setmanes.map((s) => s.total).concat([1]));

  const delaSetmana = meus.filter((r) => r.moment === 'abans' && r.data >= dilluns && r.data <= sumaDies(dilluns, 6));
  const mitjana = (camp) => {
    const v = delaSetmana.map((r) => Number(r[camp])).filter((n) => n >= 1 && n <= 5);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).replace('.', ',') : '—';
  };

  $('#contingut').innerHTML =
    '<div class="xifres">' +
      '<div class="xifra"><div class="k">Càrrega d\'aquesta setmana</div>' +
        '<div class="v">' + ara.total.toLocaleString('ca-ES') + '</div>' +
        '<div class="u">' + ara.sessions + (ara.sessions === 1 ? ' sessió' : ' sessions') + '</div></div>' +
      '<div class="xifra"><div class="k">Respecte les 3 anteriors</div>' +
        '<div class="v">' + (ratio === null ? '—' : String(ratio).replace('.', ',')) + '</div>' +
        '<div class="u">' + (ratio === null ? 'dades insuficients' : 'mitjana ' + Math.round(mitjanaPrevia).toLocaleString('ca-ES')) + '</div></div>' +
      '<div class="xifra"><div class="k">Son (mitjana)</div><div class="v">' + mitjana('son') + '</div><div class="u">sobre 5</div></div>' +
      '<div class="xifra"><div class="k">Cansament (mitjana)</div><div class="v">' + mitjana('fatiga') + '</div><div class="u">sobre 5</div></div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="eyebrow">Les teves últimes 6 setmanes</div>' +
      '<div class="barres">' +
        setmanes.map((s) =>
          '<span class="b"><i style="height:' + Math.round((s.total / sostre) * 100) + '%"></i>' +
          '<span>' + formatDia(s.dl).slice(0, 5) + '</span></span>').join('') +
      '</div>' +
      '<p class="meta" style="margin-top:10px">Càrrega = duresa × minuts, sumada per setmana.</p>' +
    '</div>' +

    '<p class="meta" style="text-align:center">' +
      'Aquí només hi ha les teves dades, i són les que has enviat des d\'aquest mòbil.' +
    '</p>';
}

/* ─────────────────────────────────────────────────────────────────────
   12. COS TÈCNIC
   ───────────────────────────────────────────────────────────────────── */

function pintaStaffPin() {
  $('#titol').textContent = 'Cos tècnic';
  $('#contingut').innerHTML =
    '<div class="card">' +
      '<div class="eyebrow">Accés del cos tècnic</div>' +
      '<div class="camp"><label for="pin">PIN</label>' +
        '<input id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="····"></div>' +
      '<p class="meta" id="pin-error" style="color:var(--pink); min-height:20px"></p>' +
      '<button class="btn" id="entra">Entrar</button>' +
    '</div>' +
    '<button class="btn secundari" id="torna">Torno a l\'app de jugadora</button>';

  $('#torna').addEventListener('click', () => ves(jo ? '#/inici' : ''));
  $('#entra').addEventListener('click', async () => {
    const pin = $('#pin').value.trim();
    if (!pin) return;
    $('#entra').disabled = true;
    $('#entra').textContent = 'Comprovant…';
    staff.pin = pin;
    try {
      await demanaPanell(dillunsDe(avuiISO()));
      guarda(CLAUS.staff, staff);
      ves('#/panell');
    } catch (e) {
      staff.pin = '';
      $('#pin-error').textContent = String(e && e.message) === 'PIN'
        ? 'PIN incorrecte.'
        : 'El full no ha contestat (' + String(e && e.message ? e.message : e) + '). Torna-ho a provar.';
    } finally {
      $('#entra').disabled = false;
      $('#entra').textContent = 'Entrar';
    }
  });
  if (!jo) $('#enrere').classList.add('amagat');
}

let panell = null;
let setmanaPanell = '';

async function demanaPanell(dilluns) {
  const res = await api('getPanell', { pin_staff: staff.pin, equip: equipTriat, setmana: dilluns }, 3);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Error');
  panell = res.data;
  setmanaPanell = dilluns;
  return panell;
}

let equipPanell = '';

function jugadoresVisibles() {
  return (panell.jugadores || []).filter((j) => !equipPanell || j.equip === equipPanell);
}

function equipsDelPanell() {
  const vist = {};
  (panell.jugadores || []).forEach((j) => { if (j.equip) vist[j.equip] = true; });
  return Object.keys(vist).sort();
}

/**
 * L'únic número que es pot llegir sol. "2100" no vol dir res; "+45% respecte
 * la seva mitjana" sí. Surt del ratio que ja calcula el full.
 */
function variacio(ratio) {
  return (ratio === null || ratio === undefined) ? null : Math.round((ratio - 1) * 100);
}

/**
 * Quins dies es compten per al compliment. No n'hi ha prou amb els dies
 * de 'dies_recordatori': és una sola llista per a tot el club i cada equip
 * entrena dies diferents, de manera que una resposta d'un dia "no previst"
 * no comptava i la jugadora sortia com si no hagués contestat mai.
 * Per això s'hi afegeix qualsevol dia en què algú hagi respost.
 */
function diesComptats(visibles) {
  const avui = avuiISO();
  const configurats = panell.dies_esperats || [];
  const ambActivitat = {};
  visibles.forEach((j) => j.dies.forEach((d) => {
    if (d.te_abans || d.te_despres) ambActivitat[d.data] = true;
  }));
  return (panell.dies || []).filter((d) =>
    d <= avui && (configurats.indexOf(d) !== -1 || ambActivitat[d]));
}

/** Compliment recalculat només amb les jugadores que es veuen ara. */
function complimentDe(visibles, diesEsperats) {
  let rebuts = 0;
  const sense = [];
  visibles.forEach((j) => {
    let meus = 0;
    j.dies.forEach((d) => {
      if (diesEsperats.indexOf(d.data) === -1) return;
      if (d.te_abans) meus++;
      if (d.te_despres) meus++;
    });
    rebuts += meus;
    if (!meus && diesEsperats.length) sense.push(j.nom);
  });
  const esperats = visibles.length * diesEsperats.length * 2;
  return { rebuts: rebuts, esperats: esperats, sense: sense,
           percentatge: esperats ? Math.round((rebuts / esperats) * 100) : null };
}

/* La intensitat és relativa al dia més fort de la setmana que s'està mirant:
   el que es vol veure d'un cop d'ull és la forma de la setmana. El valor
   absolut surt tocant la cel·la. */
function colorCarrega(v, max) {
  if (v === null || v === undefined) return '';
  const p = max > 0 ? v / max : 0;
  return 'background:rgba(255,45,120,' + (0.14 + p * 0.66).toFixed(2) + ');';
}

function pintaPanell() {
  if (!staff.pin) { ves('#/staff'); return; }
  $('#titol').textContent = 'Panell';

  if (!panell) {
    $('#contingut').innerHTML = '<p class="buit">Carregant…</p>';
    demanaPanell(setmanaPanell || dillunsDe(avuiISO()))
      .then(() => pintaPanell())
      .catch((e) => {
        $('#contingut').innerHTML = '<p class="buit">No s&#39;ha pogut carregar: ' +
          esc(String(e && e.message ? e.message : e)) + '</p>';
      });
    return;
  }

  const equips = equipsDelPanell();
  const visibles = jugadoresVisibles();
  const diesEsperats = diesComptats(visibles);
  const c = complimentDe(visibles, diesEsperats);

  // Les alertes segueixen el filtre: si mires el U15, les del U13 no hi pinten res.
  const idsVisibles = {};
  visibles.forEach((j) => { idsVisibles[j.id] = true; });
  const alertes = panell.alertes.filter((a) => idsVisibles[a.id_jugadora]);

  const max = Math.max.apply(null, visibles.map((j) =>
    Math.max.apply(null, j.dies.map((d) => d.carrega || 0).concat([0]))).concat([1]));

  // Qui ha entrat i fins on arriba. El filtratge de debò es fa al full;
  // això només és per saber què estàs mirant.
  const u = panell.usuari || {};
  const seus = (u.equips || []).join(', ');
  const quiSoc = u.nom
    ? '<p class="meta" style="margin:-2px 0 10px; text-align:center">' + esc(u.nom) + ' · ' +
      (u.rol === 'director'
        ? 'veus tots els equips'
        : (seus ? 'veus ' + esc(seus) : 'no tens cap equip assignat')) + '</p>'
    : '';

  const filtres = equips.length > 1
    ? '<div class="filtres-equip">' +
        '<button type="button" class="chip" data-equip="" aria-pressed="' + (!equipPanell) + '">Tots</button>' +
        equips.map((e) => '<button type="button" class="chip" data-equip="' + esc(e) + '"' +
          ' aria-pressed="' + (equipPanell === e) + '">' + esc(e) + '</button>').join('') +
      '</div>'
    : '';

  const blocAlertes = alertes.length
    ? alertes.map((a) =>
        '<div class="alerta ' + (a.nivell === 'vermella' ? 'vermella' : '') + '">' +
          '<div class="qui">' + esc(a.jugadora) + ' · ' + esc(a.titol) + '</div>' +
          '<div class="que">' + esc(a.detall) + '</div>' +
        '</div>').join('')
    : '<p class="meta" style="margin:0">Cap alerta' + (equipPanell ? ' al ' + esc(equipPanell) : '') + ' aquesta setmana.</p>';

  // Les molesties que no limiten no generen alerta i, fins ara, nomes es
  // veien entrant a la fitxa de cada jugadora d'una en una.
  const molesties = [];
  visibles.forEach((j) => j.dies.forEach((d) => {
    if (d.molestia) {
      molesties.push({ nom: j.nom, data: d.data, zona: d.zona, dolor: d.dolor, limita: d.limita });
    }
  }));
  molesties.sort((a, b) => (b.limita - a.limita) || b.data.localeCompare(a.data));

  const blocMolesties =
    '<div class="card"><div class="eyebrow">Mol&egrave;sties d&#39;aquesta setmana</div>' +
    (molesties.length
      ? molesties.map((m) =>
          '<div class="molestia' + (m.limita ? ' limita' : '') + '">' +
            '<span class="qui">' + esc(m.nom) + '</span>' +
            '<span class="on">' + esc(m.zona || 'zona sense indicar') +
              (m.dolor !== null && m.dolor !== '' && m.dolor !== undefined
                ? ' &middot; dolor ' + esc(m.dolor) + '/10' : '') + '</span>' +
            '<span class="quan">' + esc(diaCurt(m.data)) + ' ' + esc(formatDia(m.data)) +
              (m.limita ? ' &middot; <b>la limita per entrenar</b>' : '') + '</span>' +
          '</div>').join('')
      : '<p class="meta" style="margin:0">Cap mol&egrave;stia declarada aquesta setmana.</p>') +
    '</div>';

  const capsDies = panell.dies.map((d) =>
    '<th' + (diesEsperats.indexOf(d) !== -1 ? ' class="dia-entreno"' : '') + '>' +
    esc(diaCurt(d)) + '<br>' + esc(d.slice(8, 10)) + '</th>').join('');

  const files = visibles.map((j) => {
    const v = variacio(j.ratio);
    const alt = j.ratio !== null && j.ratio > panell.llindar;
    const txt = v === null ? '—' : (v > 0 ? '+' + v : (v < 0 ? '−' + Math.abs(v) : '0')) + '%';
    const titol = v === null ? (j.motiu_ratio || 'sense referència')
      : 'setmana ' + j.carrega_setmana + ' · mitjana de les 3 anteriors ' + j.mitjana_previa;

    return '<tr><td class="nom"><button type="button" class="chip" data-fitxa="' + esc(j.id) + '" style="min-height:34px">' +
        (j.dorsal ? '<b>' + esc(j.dorsal) + '</b> ' : '') + esc(j.nom) + '</button></td>' +
      j.dies.map((d) => {
        const te = d.carrega !== null && d.carrega !== undefined;
        return '<td class="cel' + (te ? ' plena' : ' buida') + (d.limita ? ' limita' : '') + '"' +
          ' style="' + (te ? colorCarrega(d.carrega, max) : '') + '"' +
          ' data-jug="' + esc(j.id) + '" data-dia="' + esc(d.data) + '">' +
          (te ? '' : (d.te_abans ? '·' : '–')) +
          (d.molestia ? '<span class="punt-mol"></span>' : '') +
        '</td>';
      }).join('') +
      '<td class="variacio ' + (v === null ? 'neutre' : (alt ? 'alt' : (v <= -25 ? 'baix' : 'normal'))) + '"' +
        ' title="' + esc(titol) + '">' + txt + '</td></tr>';
  }).join('');

  $('#contingut').innerHTML =
    '<div style="display:flex; align-items:center; gap:8px; margin-bottom:10px">' +
      '<button type="button" class="chip" id="setm-ant">←</button>' +
      '<span class="meta" style="flex:1; text-align:center">Setmana del ' + esc(formatDia(panell.setmana)) + '</span>' +
      '<button type="button" class="chip" id="setm-seg">→</button>' +
    '</div>' +
    quiSoc +
    filtres +

    '<div class="card"><div class="eyebrow">Alertes actives</div>' + blocAlertes + '</div>' +
    blocMolesties +

    '<div class="card">' +
      '<div class="eyebrow">Compliment' + (equipPanell ? ' · ' + esc(equipPanell) : '') + '</div>' +
      '<div style="font-size:25px; font-weight:800">' + (c.percentatge === null ? '—' : c.percentatge + '%') + '</div>' +
      '<div class="barra-compliment"><i style="width:' + (c.percentatge || 0) + '%"></i></div>' +
      '<p class="meta" style="margin:0">' + c.rebuts + ' de ' + c.esperats + ' respostes esperades · ' +
        visibles.length + (visibles.length === 1 ? ' jugadora' : ' jugadores') + '</p>' +
      '<p class="meta" style="margin:6px 0 0">Dies comptats: ' +
        (diesEsperats.length
          ? diesEsperats.map((d) => esc(diaCurt(d)) + ' ' + esc(d.slice(8, 10))).join(', ')
          : 'cap encara') + '.</p>' +
      (c.sense.length
        ? '<p class="meta" style="margin:8px 0 0"><b>Sense cap resposta aquests dies:</b><br>' + esc(c.sense.join(', ')) + '</p>'
        : '<p class="meta" style="margin:8px 0 0">Totes han contestat algun dia.</p>') +
    '</div>' +

    '<div class="card">' +
      '<div class="eyebrow">La setmana d&#39;un cop d&#39;ull</div>' +
      '<div class="graella-embolcall"><table class="graella"><thead><tr><th></th>' + capsDies +
        '<th title="Respecte la mitjana de les 3 setmanes anteriors">vs<br>normal</th></tr></thead>' +
      '<tbody>' + (files || '<tr><td class="nom">Cap jugadora</td></tr>') + '</tbody></table></div>' +
      '<p class="detall-cel" id="detall-cel">Toca una cel·la per veure què hi ha darrere.</p>' +
      '<p class="meta" style="margin-top:10px">' +
        'Com més fosca la cel·la, més càrrega va fer aquell dia comparat amb el dia més fort de la setmana. ' +
        'Punt taronja: molèstia. Vora vermella: la limita. «·»: va contestar abans però no després. ' +
        '«–»: no va contestar.' +
      '</p>' +
    '</div>' +

    '<button class="btn secundari" id="surt-staff">Sortir del panell</button>';

  $$('#contingut [data-equip]').forEach((b) => b.addEventListener('click', () => {
    equipPanell = b.getAttribute('data-equip');
    pintaPanell();
  }));

  // El número surt tocant la cel·la: a la graella només hi ha la forma.
  $$('#contingut td.cel[data-jug]').forEach((td) => td.addEventListener('click', () => {
    const j = visibles.filter((x) => x.id === td.getAttribute('data-jug'))[0];
    const d = j ? j.dies.filter((x) => x.data === td.getAttribute('data-dia'))[0] : null;
    if (!d) return;
    const trossos = [esc(j.nom) + ' · ' + esc(diaCurt(d.data)) + ' ' + esc(formatDia(d.data))];
    if (d.carrega !== null && d.carrega !== undefined) {
      trossos.push('càrrega <b>' + Math.round(d.carrega) + '</b>' +
        (d.duresa ? ' (duresa ' + d.duresa + ' × ' + d.minuts + ' min)' : ''));
    } else if (d.te_abans) {
      trossos.push('va contestar abans, però no després');
    } else {
      trossos.push('sense resposta');
    }
    if (d.fatiga) trossos.push('cansament ' + d.fatiga + '/5');
    if (d.son) trossos.push('son ' + d.son + '/5');
    if (d.molestia) {
      const on = (d.zona || 'zona sense indicar') +
        (d.dolor !== null && d.dolor !== '' && d.dolor !== undefined ? ' ' + d.dolor + '/10' : '');
      trossos.push(d.limita
        ? '<b style="color:var(--vermell)">' + esc(on) + ' &mdash; la limita</b>'
        : esc(on));
    }
    $('#detall-cel').innerHTML = trossos.join(' — ');
    $$('#contingut td.cel.triada').forEach((x) => x.classList.remove('triada'));
    td.classList.add('triada');
  }));

  const vesSetmana = (n) => {
    panell = null;
    setmanaPanell = sumaDies(setmanaPanell, n);
    pintaPanell();
  };
  $('#setm-ant').addEventListener('click', () => vesSetmana(-7));
  $('#setm-seg').addEventListener('click', () => vesSetmana(7));
  $$('#contingut [data-fitxa]').forEach((b) =>
    b.addEventListener('click', () => ves('#/fitxa/' + b.getAttribute('data-fitxa'))));
  $('#surt-staff').addEventListener('click', () => {
    staff.pin = '';
    panell = null;
    localStorage.removeItem(CLAUS.staff);
    ves(jo ? '#/inici' : '');
    if (!jo) pintaQui();
  });
}

function pintaFitxa(id) {
  if (!staff.pin) { ves('#/staff'); return; }
  $('#titol').textContent = 'Fitxa';
  $('#contingut').innerHTML = '<p class="buit">Carregant…</p>';

  api('getJugadora', { pin_staff: staff.pin, id: id, n_setmanes: 8 }, 3).then((res) => {
    if (!res || !res.ok) throw new Error((res && res.error) || 'Error');
    const d = res.data;
    const sostre = Math.max.apply(null, d.setmanes.map((s) => s.carrega).concat([1]));

    const serie = (camp, titol, maxim) =>
      '<div class="card"><div class="eyebrow">' + titol + '</div><div class="barres">' +
        d.setmanes.map((s) =>
          '<span class="b"><i style="height:' +
          (s[camp] === null ? 0 : Math.round((s[camp] / maxim) * 100)) + '%"></i>' +
          '<span>' + formatDia(s.setmana).slice(0, 5) + '</span></span>').join('') +
      '</div><p class="meta" style="margin-top:8px">' +
      d.setmanes.map((s) => (s[camp] === null ? '—' : String(s[camp]).replace('.', ','))).join(' · ') +
      '</p></div>';

    $('#contingut').innerHTML =
      '<p class="hola" style="margin-bottom:2px">' + esc(d.jugadora.nom) + '</p>' +
      '<p class="meta" style="margin:0 0 14px">' + esc(d.jugadora.equip || '') +
        (d.jugadora.dorsal ? ' · dorsal ' + esc(d.jugadora.dorsal) : '') + '</p>' +

      serie('carrega', 'Càrrega setmanal', sostre) +
      serie('fatiga', 'Cansament mitjà (1–5)', 5) +
      serie('son', 'Son mitjà (1–5)', 5) +

      '<div class="card">' +
        '<div class="eyebrow">Molèsties registrades</div>' +
        (d.molesties.length
          ? d.molesties.map((m) =>
              '<div style="padding:8px 0; border-bottom:1px solid var(--line)">' +
                '<b>' + esc(formatDia(m.data)) + '</b> · ' + esc(m.zona || 'zona sense indicar') +
                (m.dolor !== '' && m.dolor !== null ? ' · dolor ' + esc(m.dolor) + '/10' : '') +
                (m.limita ? ' · <span style="color:var(--vermell); font-weight:700">limita</span>' : '') +
                (m.comentari ? '<br><span class="meta">' + esc(m.comentari) + '</span>' : '') +
              '</div>').join('')
          : '<p class="meta" style="margin:0">Cap molèstia registrada.</p>') +
      '</div>';
  }).catch((e) => {
    $('#contingut').innerHTML = '<p class="buit">No s\'ha pogut carregar: ' +
      esc(String(e && e.message ? e.message : e)) + '</p>';
  });
}

/* ─────────────────────────────────────────────────────────────────────
   13. ARRENCADA
   ───────────────────────────────────────────────────────────────────── */

async function arrenca() {
  jo = llegeix(CLAUS.jo, null);
  roster = Object.assign(roster, llegeix(CLAUS.roster, {}));
  meus = llegeix(CLAUS.meus, []) || [];
  pendents = llegeix(CLAUS.pendents, []) || [];
  staff = Object.assign({ pin: '' }, llegeix(CLAUS.staff, {}));

  $('#enrere').addEventListener('click', () => {
    const r = rutaActual();
    if (r.vista === 'fitxa') ves('#/panell');
    else if (['abans', 'despres', 'resum'].indexOf(r.vista) !== -1) ves('#/inici');
    else if (history.length > 1) history.back();
    else ves('#/inici');
  });
  $('#estat-sync').addEventListener('click', () => sincronitza(true));
  $('#qui-staff').addEventListener('click', () => { obreApp('#/staff'); });
  window.addEventListener('hashchange', ruta);
  window.addEventListener('online', () => sincronitza());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronitza(); });

  if (!CONFIG.API_URL) $('#qui-error').textContent = 'Falta enganxar la URL de l\'Apps Script a CONFIG.API_URL.';

  const rutaStaff = ['staff', 'panell', 'fitxa'].indexOf(rutaActual().vista) !== -1;
  if (jo || rutaStaff) {
    obreApp();
    sincronitza();
    carregaRoster(true);
  } else {
    pintaQui();                 // amb el que hi hagi desat, perquè es vegi de seguida
    await carregaRoster(false);
    if (!jo) pintaQui();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
  }
}

arrenca();
