/**
 * Backend de l'app "Càrregues MCBF" (equips de rendiment del Manresa CBF).
 *
 * COM POSAR-HO EN MARXA
 * ---------------------
 * 1) Crea un Google Sheet nou i anomena'l  Càrregues MCBF.
 * 2) Extensions -> Apps Script. Esborra el que hi hagi i enganxa aquest
 *    fitxer sencer. Desa.
 * 3) Tria la funcio "setup" i clica ▶ Executar. Crea les 3 pestanyes amb
 *    les capçaleres correctes i la configuracio inicial.
 * 4) Omple la pestanya Jugadores (nom, dorsal, equip, activa = SI) i,
 *    a Config, canvia el pin_staff i els dies d'entrenament.
 * 5) Desplega -> Nou desplegament -> "Aplicacio web":
 *       Executa com:  Jo (el teu compte)
 *       Qui hi te acces:  Qualsevol persona
 *    Copia la URL que acaba en /exec i enganxa-la a CONFIG.API_URL
 *    dins d'index.html.
 *
 * SI DESPRES CANVIES AQUEST CODI: Desplega -> Gestiona desplegaments ->
 * llapis -> Versio: Nova versio -> Desplega. La URL /exec no canvia.
 *
 * PRIVACITAT (§9 de les instruccions, aplicada aqui, no nomes al paper)
 * --------------------------------------------------------------------
 * - Les dades d'estat i de dolor NOMES surten d'aqui amb pin_staff
 *   correcte. No hi ha cap accio que, donat un id de jugadora, retorni
 *   el seu historic sense PIN.
 * - getJugadores nomes retorna nom, dorsal i equip: cap dada de salut.
 * - saveRegistre no retorna res d'altres jugadores, nomes la carrega
 *   calculada del registre que acaba de desar.
 */

/* ------------------------------------------------------------------ *
 *  Esquema                                                            *
 * ------------------------------------------------------------------ */

var FULLS = {
  jugadores: {
    nom: 'Jugadores',
    clau: 'id',
    // 'codi' es amb que entra la jugadora a l'app. Ha de ser unic a tot el
    // club, tambe respecte dels codis de l'staff: vegeu entrar_().
    capcalera: ['id', 'nom', 'dorsal', 'equip', 'activa', 'codi'],
    text: ['id', 'dorsal', 'codi']
  },
  registres: {
    nom: 'Registres',
    // La clau real d'un registre no es l'id sino el trio jugadora+dia+moment:
    // vegeu desaRegistre_(). L'id nomes identifica l'enviament del mobil.
    clau: 'id',
    // nom_jugadora es nomes per poder llegir el full amb ulls humans: qui mana
    // es id_jugadora. Si canvia un nom a Jugadores, les files velles conserven
    // el que hi havia el dia que es van escriure.
    // moment: 'abans' | 'despres' | 'partit'.
    // valoracio (1-5) es la cara de "com ha anat": nomes a despres i partit.
    // duresa es guarda SEMPRE en escala 0-10, encara que la jugadora triï
    // entre cinc cares, perque les setmanes velles i les noves es puguin
    // comparar: la carrega es duresa x minuts i canviar l'escala la partiria.
    capcalera: ['id', 'id_jugadora', 'nom_jugadora', 'data', 'moment', 'son', 'fatiga', 'anim',
                'te_molestia', 'zona_molestia', 'dolor', 'limita', 'valoracio', 'duresa',
                'tipus_sessio', 'minuts', 'carrega', 'comentari', 'timestamp'],
    text: ['id', 'id_jugadora', 'data', 'moment', 'te_molestia', 'limita', 'tipus_sessio', 'timestamp']
  },
  usuaris: {
    nom: 'Usuaris',
    clau: 'pin',
    // rol: 'director' (ho veu tot) o 'entrenador' (nomes els seus equips).
    // equips: llista separada per comes. Un entrenador sense equips no veu
    // res: val mes que es quedi curt que no pas que ho obri tot per error.
    capcalera: ['pin', 'nom', 'rol', 'equips'],
    text: ['pin', 'equips']
  },
  // Una fila per partit o entrenament, escrita per l'entrenador.
  sessions: {
    nom: 'Sessions',
    clau: 'id',
    capcalera: ['id', 'data', 'equip', 'tipus', 'responsable', 'valoracio',
                'objectiu', 'comentari', 'timestamp'],
    text: ['id', 'data', 'tipus', 'objectiu', 'timestamp']
  },
  // Una fila per jugadora i partit: els minuts que ha jugat.
  minuts: {
    nom: 'Minuts',
    clau: 'id',
    capcalera: ['id', 'data', 'equip', 'id_jugadora', 'nom_jugadora',
                'minuts', 'tram', 'timestamp'],
    text: ['id', 'data', 'id_jugadora', 'tram', 'timestamp']
  },
  config: {
    nom: 'Config',
    clau: 'clau',
    capcalera: ['clau', 'valor'],
    text: ['clau', 'valor']
  }
};

/* Trams de minuts que tria l'entrenador. Es guarda el tram tal com el tria
   i, per calcular la carrega, el punt mig del tram. */
var TRAMS_MINUTS = [
  { tram: '1-5',   minuts: 3 },
  { tram: '6-10',  minuts: 8 },
  { tram: '11-15', minuts: 13 },
  { tram: '16-20', minuts: 18 },
  { tram: '21-25', minuts: 23 },
  { tram: '26-30', minuts: 28 },
  { tram: '31-35', minuts: 33 },
  { tram: '36-40', minuts: 38 }
];

function minutsDelTram_(tram) {
  var t = text_(tram);
  for (var i = 0; i < TRAMS_MINUTS.length; i++) {
    if (TRAMS_MINUTS[i].tram === t) return TRAMS_MINUTS[i].minuts;
  }
  return '';
}

var CONFIG_INICIAL = [
  ['pin_staff', '1234'],
  ['equips', 'Sènior A'],
  ['llindar_carrega', '1,3'],
  // Dies que es considera que toca entrenar. Serveixen per saber quantes
  // respostes s'esperen i, per tant, per calcular el compliment.
  ['dies_recordatori', 'dl,dc,dv'],
  ['minuts_defecte', '90'],
  // Tipus d'entrenament i els minuts que val cadascun, tal com es compten
  // al club. Es toca aqui, no al codi.
  ['tipus_sessio', 'Pista:75, Físic + pista:120, Doble sessió:120, Físic + pista + tècnic:160']
];

var DIES_CODI = ['dg', 'dl', 'dm', 'dc', 'dj', 'dv', 'ds'];   // getUTCDay(): 0=diumenge

var MAX_ERRADES = 8;
var FINESTRA_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ *
 *  Preparacio del full                                                *
 * ------------------------------------------------------------------ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(FULLS).forEach(function (clau) {
    var def = FULLS[clau];
    var sh = ss.getSheetByName(def.nom) || ss.insertSheet(def.nom);
    if (String(sh.getRange(1, 1).getValue() || '').trim() === '') {
      sh.getRange(1, 1, 1, def.capcalera.length).setValues([def.capcalera]);
      sh.getRange(1, 1, 1, def.capcalera.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    var caps = capcalera_(sh);

    // Columnes noves d'una versio posterior: s'afegeixen al final, sense
    // moure res del que ja hi ha. L'ordre no importa, el codi hi accedeix
    // sempre pel nom de la capcalera.
    var falten = def.capcalera.filter(function (c) { return caps.indexOf(c) === -1; });
    if (falten.length && caps.length) {
      var nova = sh.getRange(1, caps.length + 1, 1, falten.length);
      nova.setValues([falten]);
      nova.setFontWeight('bold');
      caps = capcalera_(sh);
    }

    (def.text || []).forEach(function (nomCol) {
      var i = caps.indexOf(nomCol);
      if (i !== -1) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  var conf = ss.getSheetByName(FULLS.config.nom);
  var existents = files_('config').map(function (f) { return String(f.clau || '').trim(); });
  var afegir = CONFIG_INICIAL.filter(function (c) { return existents.indexOf(c[0]) === -1; });
  if (afegir.length) conf.getRange(conf.getLastRow() + 1, 1, afegir.length, 2).setValues(afegir);

  var noms = omplirNomsJugadores_();
  var codis = generaCodis_();
  ss.toast('Pestanyes preparades' + (noms ? ' · ' + noms + ' noms omplerts' : '') +
           (codis ? ' · ' + codis + ' codis de jugadora generats' : '') +
           '. Omple Jugadores i Usuaris.', 'Rendiment MCBF', 10);
}

/**
 * Posa el nom a les files de Registres que encara no en tinguin. S'executa
 * dins de setup(), aixi que tornar-lo a executar es sempre segur: nomes toca
 * les caselles buides.
 */
function omplirNomsJugadores_() {
  var sh = full_('registres');
  var ultima = sh.getLastRow();
  if (ultima < 2) return 0;

  var caps = capcalera_(sh);
  var iJ = caps.indexOf('id_jugadora'), iN = caps.indexOf('nom_jugadora');
  if (iJ === -1 || iN === -1) return 0;

  var noms = {};
  jugadores_('', false).forEach(function (j) { noms[j.id] = j.nom; });

  var rang = sh.getRange(2, 1, ultima - 1, caps.length);
  var dades = rang.getValues();
  var canviats = 0;
  dades.forEach(function (fila) {
    if (text_(fila[iN])) return;
    var nom = noms[text_(fila[iJ])];
    if (nom) { fila[iN] = nom; canviats++; }
  });
  if (canviats) rang.setValues(dades);
  return canviats;
}

/* ------------------------------------------------------------------ *
 *  Utilitats de full                                                  *
 * ------------------------------------------------------------------ */

function full_(clau) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FULLS[clau].nom);
  if (!sh) throw new Error('Falta la pestanya "' + FULLS[clau].nom + '". Executa setup().');
  return sh;
}

function capcalera_(sh) {
  var n = sh.getLastColumn();
  if (!n) return [];
  return sh.getRange(1, 1, 1, n).getValues()[0].map(function (v) { return String(v || '').trim(); });
}

function files_(clau) {
  var sh = full_(clau);
  if (sh.getLastRow() < 2) return [];
  var caps = capcalera_(sh);
  return sh.getRange(2, 1, sh.getLastRow() - 1, caps.length).getValues().map(function (fila) {
    var o = {};
    caps.forEach(function (nom, i) { if (nom) o[nom] = fila[i]; });
    return o;
  });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function text_(v) { return String(v === undefined || v === null ? '' : v).trim(); }

function num_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? '' : n;
}

function esSi_(v) {
  var s = text_(v).toUpperCase();
  return v === true || s === 'SI' || s === 'SÍ' || s === 'S' || s === 'TRUE' || s === 'X' || s === '1';
}

function siNo_(v) { return esSi_(v) ? 'SI' : 'NO'; }

function llista_(v) {
  return text_(v).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

/** Data com a 'YYYY-MM-DD', vingui com vingui del full. */
function dataISO_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  var s = text_(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/.test(s)) {
    var p = s.split(/[\/-]/);
    return p[2] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[0]).slice(-2);
  }
  return s;
}

/** Suma dies a una data ISO, sempre en UTC per no dependre de l'horari d'estiu. */
function sumaDies_(iso, n) {
  var p = iso.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  d.setUTCDate(d.getUTCDate() + n);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function codiDia_(iso) {
  var p = iso.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return DIES_CODI[d.getUTCDay()];
}

function avuiISO_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ------------------------------------------------------------------ *
 *  Configuracio i PIN                                                 *
 * ------------------------------------------------------------------ */

var _confCache = null;   // una sola lectura de Config per execucio

function configuracio_() {
  if (_confCache) return _confCache;
  var c = {};
  files_('config').forEach(function (f) {
    var k = text_(f.clau);
    if (k) c[k] = text_(f.valor);
  });
  _confCache = c;
  return c;
}

/* ------------------------------------------------------------------ *
 *  Entrar amb codi                                                    *
 * ------------------------------------------------------------------ */

/**
 * Un sol codi per a tothom. Es mira primer a Jugadores i despres a Usuaris,
 * i el full decideix quina pantalla obre l'app. Aixi ningu pot enviar dades
 * fent-se passar per una altra: escriure demana el codi de qui escriu.
 *
 * Retorna { ok:true, data:{ tipus, ... } } o { ok:false, error:'CODI' }.
 */
function entrar_(codi) {
  var props = PropertiesService.getScriptProperties();
  var fins = Number(props.getProperty('bloqueig_fins') || 0);
  if (fins && Date.now() < fins) {
    return json_({ ok: false, error: 'Massa intents. Torna-ho a provar en uns minuts.' });
  }

  codi = text_(codi);
  var trobat = null;

  if (codi) {
    var jug = jugadores_('', true).filter(function (j) { return j.codi === codi; })[0];
    if (jug) {
      trobat = {
        tipus: 'jugadora',
        jugadora: { id: jug.id, nom: jug.nom, dorsal: jug.dorsal, equip: jug.equip },
        tipus_sessio: tipusDeSessio_(),
        trams: TRAMS_MINUTS
      };
    } else {
      var u = usuariPerCodi_(codi);
      if (u) {
        trobat = { tipus: u.rol, usuari: u, trams: TRAMS_MINUTS };
      }
    }
  }

  if (trobat) {
    props.deleteProperty('errades');
    props.deleteProperty('errades_des_de');
    props.deleteProperty('bloqueig_fins');
    return json_({ ok: true, data: trobat });
  }

  var desDe = Number(props.getProperty('errades_des_de') || 0);
  var n = Number(props.getProperty('errades') || 0);
  if (!desDe || Date.now() - desDe > FINESTRA_MS) { desDe = Date.now(); n = 0; }
  n++;
  props.setProperty('errades_des_de', String(desDe));
  props.setProperty('errades', String(n));
  if (n >= MAX_ERRADES) props.setProperty('bloqueig_fins', String(Date.now() + FINESTRA_MS));
  return json_({ ok: false, error: 'CODI' });
}

/** L'usuari de l'staff que te aquest codi, o null. */
function usuariPerCodi_(codi) {
  var trobat = null;
  var usuaris = [];
  try { usuaris = files_('usuaris'); } catch (err) { usuaris = []; }
  usuaris.forEach(function (u) {
    if (trobat || text_(u.pin) !== codi) return;
    var rol = text_(u.rol).toLowerCase();
    var esEntrenador = rol.indexOf('entrenador') === 0;
    trobat = {
      nom: text_(u.nom) || 'Sense nom',
      rol: esEntrenador ? 'entrenador' : 'director',
      equips: esEntrenador ? llista_(u.equips) : []
    };
  });
  // El pin_staff de Config segueix valent com a director mentre Usuaris
  // estigui buida, per no deixar ningu fora.
  if (!trobat && codi === text_(configuracio_().pin_staff)) {
    trobat = { nom: 'Cos tecnic', rol: 'director', equips: [] };
  }
  return trobat;
}

/** La jugadora que te aquest codi, o null. Qualsevol escriptura hi passa. */
function jugadoraPerCodi_(codi) {
  codi = text_(codi);
  if (!codi) return null;
  return jugadores_('', true).filter(function (j) { return j.codi === codi; })[0] || null;
}

/** Tipus d'entrenament amb els seus minuts, tal com estan a Config. */
function tipusDeSessio_() {
  var cru = text_(configuracio_().tipus_sessio);
  if (!cru) cru = 'Pista:75';
  return cru.split(',').map(function (t) {
    var p = t.split(':');
    return { nom: text_(p[0]), minuts: num_(p[1]) || 0 };
  }).filter(function (t) { return t.nom && t.minuts; });
}

function minutsDelTipus_(nom) {
  nom = text_(nom);
  var t = tipusDeSessio_().filter(function (x) { return x.nom === nom; })[0];
  return t ? t.minuts : '';
}

/**
 * Codis de 4 xifres per a les jugadores que encara no en tinguin. No en
 * repeteix cap, ni dels que ja hi ha ni dels de l'staff: dos codis iguals
 * voldrien dir que una jugadora entra com una altra persona.
 */
function generaCodis_() {
  var sh = full_('jugadores');
  var caps = capcalera_(sh);
  var iCodi = caps.indexOf('codi'), iId = caps.indexOf('id');
  if (iCodi === -1 || iId === -1 || sh.getLastRow() < 2) return 0;

  var n = sh.getLastRow() - 1;
  var dades = sh.getRange(2, 1, n, caps.length).getValues();

  var usats = {};
  try {
    files_('usuaris').forEach(function (u) { if (text_(u.pin)) usats[text_(u.pin)] = true; });
  } catch (err) { /* encara sense pestanya */ }
  var pinStaff = text_(configuracio_().pin_staff);
  if (pinStaff) usats[pinStaff] = true;
  dades.forEach(function (f) { if (text_(f[iCodi])) usats[text_(f[iCodi])] = true; });

  var columna = [];
  var fets = 0;
  for (var i = 0; i < n; i++) {
    var actual = text_(dades[i][iCodi]);
    if (actual || !text_(dades[i][iId])) { columna.push([actual]); continue; }
    var codi = '';
    for (var intent = 0; intent < 500 && !codi; intent++) {
      var prova = String(Math.floor(1000 + Math.random() * 9000));
      if (!usats[prova]) codi = prova;
    }
    if (!codi) { columna.push([actual]); continue; }
    usats[codi] = true;
    columna.push([codi]);
    fets++;
  }
  if (fets) sh.getRange(2, iCodi + 1, n, 1).setValues(columna);
  return fets;
}

/* ------------------------------------------------------------------ *
 *  El que escriu l'entrenador                                         *
 * ------------------------------------------------------------------ */

/** Una fila per partit o entrenament. Clau: data + equip + tipus. */
function desaSessio_(p, usuari) {
  var data = dataISO_(p.data);
  var equip = text_(p.equip);
  var tipus = text_(p.tipus);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json_({ ok: false, error: 'Data no valida.' });
  if (tipus !== 'partit' && tipus !== 'entrenament') return json_({ ok: false, error: 'Tipus no valid.' });
  var permesos = equipsPermesos_(usuari);
  if (permesos && permesos.indexOf(equip) === -1) {
    return json_({ ok: false, error: "Aquest equip no es teu." });
  }

  var sh = full_('sessions');
  var caps = capcalera_(sh);
  var fila = {
    id: text_(p.id) || Utilities.getUuid(),
    data: data,
    equip: equip,
    tipus: tipus,
    responsable: usuari ? usuari.nom : '',
    valoracio: num_(p.valoracio),
    objectiu: tipus === 'entrenament' ? siNo_(p.objectiu) : '',
    comentari: text_(p.comentari),
    timestamp: new Date().toISOString()
  };
  var valors = caps.map(function (c) { return fila[c] === undefined ? '' : fila[c]; });

  var nFila = trobaPerClaus_(sh, caps, [['data', data], ['equip', equip], ['tipus', tipus]]);
  if (nFila) sh.getRange(nFila, 1, 1, caps.length).setValues([valors]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, caps.length).setValues([valors]);

  return json_({ ok: true, data: { id: fila.id, actualitzat: !!nFila } });
}

/**
 * Minuts jugats per cada jugadora en un partit. Despres d'escriure'ls,
 * recalcula la carrega de les jugadores que ja havien contestat el partit:
 * la carrega d'un partit surt de creuar la seva duresa amb aquests minuts,
 * i les dues meitats no arriben alhora.
 */
function desaMinuts_(p, usuari) {
  var data = dataISO_(p.data);
  var equip = text_(p.equip);
  var llista = p.minuts || [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json_({ ok: false, error: 'Data no valida.' });
  var permesos = equipsPermesos_(usuari);
  if (permesos && permesos.indexOf(equip) === -1) {
    return json_({ ok: false, error: "Aquest equip no es teu." });
  }

  var sh = full_('minuts');
  var caps = capcalera_(sh);
  var jugs = {};
  jugadores_('', false).forEach(function (j) { jugs[j.id] = j; });

  var escrites = 0;
  llista.forEach(function (m) {
    var idJ = text_(m.id_jugadora);
    var tram = text_(m.tram);
    if (!idJ || !jugs[idJ]) return;

    var fila = {
      id: text_(m.id) || Utilities.getUuid(),
      data: data,
      equip: equip,
      id_jugadora: idJ,
      nom_jugadora: jugs[idJ].nom,
      minuts: tram ? minutsDelTram_(tram) : '',
      tram: tram,
      timestamp: new Date().toISOString()
    };
    var valors = caps.map(function (c) { return fila[c] === undefined ? '' : fila[c]; });
    var nFila = trobaPerClaus_(sh, caps, [['data', data], ['id_jugadora', idJ]]);
    if (nFila) sh.getRange(nFila, 1, 1, caps.length).setValues([valors]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, caps.length).setValues([valors]);
    escrites++;
  });

  var recalculades = recalculaCarregaPartit_(data);
  return json_({ ok: true, data: { escrites: escrites, recalculades: recalculades } });
}

/** Posa minuts i carrega a les files de partit d'aquell dia. */
function recalculaCarregaPartit_(data) {
  var sh = full_('registres');
  if (sh.getLastRow() < 2) return 0;
  var caps = capcalera_(sh);
  var iData = caps.indexOf('data'), iMoment = caps.indexOf('moment'),
      iJug = caps.indexOf('id_jugadora'), iDuresa = caps.indexOf('duresa'),
      iMinuts = caps.indexOf('minuts'), iCarrega = caps.indexOf('carrega');
  if ([iData, iMoment, iJug, iDuresa, iMinuts, iCarrega].indexOf(-1) !== -1) return 0;

  var minutsPerJug = {};
  files_('minuts').forEach(function (m) {
    if (dataISO_(m.data) === data) minutsPerJug[text_(m.id_jugadora)] = num_(m.minuts);
  });

  var rang = sh.getRange(2, 1, sh.getLastRow() - 1, caps.length);
  var dades = rang.getValues();
  var canviades = 0;
  dades.forEach(function (f) {
    if (dataISO_(f[iData]) !== data || text_(f[iMoment]) !== 'partit') return;
    var mins = minutsPerJug[text_(f[iJug])];
    if (mins === undefined || mins === '') return;
    var duresa = num_(f[iDuresa]);
    f[iMinuts] = mins;
    f[iCarrega] = (duresa === '' ? '' : duresa * mins);
    canviades++;
  });
  if (canviades) rang.setValues(dades);
  return canviades;
}

/** Numero de fila que compleix totes les parelles columna/valor. */
function trobaPerClaus_(sh, caps, parelles) {
  if (sh.getLastRow() < 2) return 0;
  var dades = sh.getRange(2, 1, sh.getLastRow() - 1, caps.length).getValues();
  for (var i = 0; i < dades.length; i++) {
    var totes = true;
    for (var k = 0; k < parelles.length; k++) {
      var col = caps.indexOf(parelles[k][0]);
      if (col === -1) { totes = false; break; }
      var valor = dades[i][col];
      var esperat = parelles[k][1];
      var iguals = (parelles[k][0] === 'data')
        ? (dataISO_(valor) === esperat)
        : (text_(valor) === esperat);
      if (!iguals) { totes = false; break; }
    }
    if (totes) return i + 2;
  }
  return 0;
}

/**
 * Equips que pot veure aquest usuari. null vol dir tots; una llista buida,
 * cap. El filtratge es fa AQUI, al servidor: si es fes al mobil, qualsevol
 * podria canviar la peticio i veure els altres equips igualment.
 */
function equipsPermesos_(usuari) {
  return (usuari && usuari.rol === 'director') ? null : ((usuari && usuari.equips) || []);
}

/* ------------------------------------------------------------------ *
 *  Lectures                                                           *
 * ------------------------------------------------------------------ */

function jugadores_(equip, nomesActives) {
  return files_('jugadores')
    .filter(function (f) { return text_(f.id) && text_(f.nom); })
    .filter(function (f) { return !nomesActives || esSi_(f.activa); })
    .filter(function (f) { return !equip || text_(f.equip) === equip; })
    .map(function (f) {
      return {
        id: text_(f.id),
        nom: text_(f.nom),
        dorsal: text_(f.dorsal),
        equip: text_(f.equip),
        activa: esSi_(f.activa),
        // Nomes per a entrar_(): cap resposta de l'API l'ha de portar mai.
        codi: text_(f.codi)
      };
    });
}

/**
 * Registres del full. Amb 'desDe' (YYYY-MM-DD) nomes llegeix les files a
 * partir d'aquella data: amb 75 jugadores el full arriba a unes 18.000 files
 * per temporada i llegir-les totes per pintar una setmana no te sentit.
 *
 * Per trobar per on comencar es llegeix NOMES la columna de dates (una
 * columna en comptes de setze) i es busca la primera fila que hi entra.
 * Es busca de principi a fi a posta: si la cua d'un mobil puja un registre
 * endarrerit, les files no queden perfectament ordenades, i parant al primer
 * canvi ens deixariem files bones.
 */
function registresDesDe_(desDe) {
  var sh = full_('registres');
  var ultima = sh.getLastRow();
  if (ultima < 2) return [];

  var caps = capcalera_(sh);
  var inici = 2;

  if (desDe) {
    var iData = caps.indexOf('data');
    if (iData !== -1) {
      var dates = sh.getRange(2, iData + 1, ultima - 1, 1).getValues();
      inici = ultima + 1;
      for (var i = 0; i < dates.length; i++) {
        if (dataISO_(dates[i][0]) >= desDe) { inici = i + 2; break; }
      }
      if (inici > ultima) return [];
    }
  }

  return sh.getRange(inici, 1, ultima - inici + 1, caps.length).getValues().map(function (fila) {
    var o = {};
    caps.forEach(function (nom, k) { if (nom) o[nom] = fila[k]; });
    return o;
  });
}

function registres_(desDe) {
  return registresDesDe_(desDe)
    .filter(function (f) { return text_(f.id_jugadora) && dataISO_(f.data); })
    .map(function (f) {
      return {
        id: text_(f.id),
        id_jugadora: text_(f.id_jugadora),
        data: dataISO_(f.data),
        moment: text_(f.moment),
        son: num_(f.son),
        fatiga: num_(f.fatiga),
        anim: num_(f.anim),
        te_molestia: esSi_(f.te_molestia),
        zona_molestia: text_(f.zona_molestia),
        dolor: num_(f.dolor),
        limita: esSi_(f.limita),
        duresa: num_(f.duresa),
        minuts: num_(f.minuts),
        carrega: num_(f.carrega) || 0,
        comentari: text_(f.comentari),
        timestamp: text_(f.timestamp)
      };
    });
}

/* ------------------------------------------------------------------ *
 *  Escriptura de registres                                            *
 * ------------------------------------------------------------------ */

/**
 * Una unica fila per jugadora, dia i moment ('abans', 'despres', 'partit').
 * Si el mobil reenvia el mateix (cua offline, doble toc, dos dispositius),
 * s'actualitza la fila que ja hi ha en comptes d'afegir-ne una de nova.
 *
 * De qui es el registre ho diu el CODI, no el mobil: aixi ningu pot enviar
 * dades fent-se passar per una altra jugadora.
 */
function desaRegistre_(p, codi) {
  var jug = jugadoraPerCodi_(codi);
  if (!jug) return json_({ ok: false, error: 'CODI' });

  var idJ = jug.id;
  var data = dataISO_(p.data);
  var moment = text_(p.moment);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json_({ ok: false, error: 'Data no valida: ' + data });
  if (['abans', 'despres', 'partit'].indexOf(moment) === -1) {
    return json_({ ok: false, error: 'Moment no valid: ' + moment });
  }

  // La duresa arriba ja en escala 0-10 encara que la jugadora triï cares:
  // canviar l'escala partiria la comparacio amb les setmanes velles.
  var duresa = (moment === 'abans') ? '' : num_(p.duresa);
  var tipus = (moment === 'despres') ? text_(p.tipus_sessio) : '';
  var minuts = '';
  var carrega = '';

  if (moment === 'despres') {
    minuts = tipus ? minutsDelTipus_(tipus) : num_(p.minuts);
    if (minuts === '' || minuts === undefined) minuts = num_(p.minuts);
    if (duresa !== '' && minuts !== '') carrega = duresa * minuts;
  } else if (moment === 'partit') {
    // Els minuts els posa l'entrenador, i poden arribar abans o despres
    // que la jugadora contesti: si encara no hi son, la carrega queda en
    // blanc i desaMinuts_() la reomple quan arribin.
    minuts = minutsJugatsDe_(idJ, data);
    if (duresa !== '' && minuts !== '') carrega = duresa * minuts;
  }

  var fila = {
    id: text_(p.id) || Utilities.getUuid(),
    id_jugadora: idJ,
    nom_jugadora: jug.nom,
    data: data,
    moment: moment,
    son: moment === 'abans' ? num_(p.son) : '',
    fatiga: moment === 'abans' ? num_(p.fatiga) : '',
    anim: moment === 'abans' ? num_(p.anim) : '',
    te_molestia: (moment === 'abans' || moment === 'partit') ? siNo_(p.te_molestia) : '',
    zona_molestia: text_(p.zona_molestia),
    dolor: num_(p.dolor),
    limita: siNo_(p.limita),
    valoracio: moment === 'abans' ? '' : num_(p.valoracio),
    duresa: duresa,
    tipus_sessio: tipus,
    minuts: minuts,
    carrega: carrega,
    comentari: text_(p.comentari),
    timestamp: text_(p.timestamp) || new Date().toISOString()
  };

  var sh = full_('registres');
  var caps = capcalera_(sh);
  var valors = caps.map(function (n) { return fila[n] === undefined ? '' : fila[n]; });

  var nFila = trobaRegistre_(sh, caps, idJ, data, moment);
  if (nFila) sh.getRange(nFila, 1, 1, caps.length).setValues([valors]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, caps.length).setValues([valors]);

  return json_({
    ok: true,
    data: { id: fila.id, carrega: carrega === '' ? null : carrega,
            minuts: minuts === '' ? null : minuts, actualitzat: !!nFila }
  });
}

/** Minuts que ha jugat una jugadora un dia, si l'entrenador ja els ha posat. */
function minutsJugatsDe_(idJ, data) {
  var trobat = '';
  try {
    files_('minuts').forEach(function (m) {
      if (text_(m.id_jugadora) === idJ && dataISO_(m.data) === data) trobat = num_(m.minuts);
    });
  } catch (err) { /* encara sense pestanya */ }
  return trobat;
}

/* Files que es miren de cop abans de plantejar-se llegir el full sencer.
   Amb 75 jugadores son unes 3 setmanes de registres. */
var FINESTRA_FILES = 1500;

function cercaRegistre_(sh, caps, primera, ultima, idJ, data, moment) {
  if (ultima < primera) return 0;
  var iJ = caps.indexOf('id_jugadora'), iD = caps.indexOf('data'), iM = caps.indexOf('moment');
  var dades = sh.getRange(primera, 1, ultima - primera + 1, caps.length).getValues();
  for (var i = 0; i < dades.length; i++) {
    if (text_(dades[i][iJ]) === idJ && dataISO_(dades[i][iD]) === data && text_(dades[i][iM]) === moment) {
      return i + primera;
    }
  }
  return 0;
}

/**
 * Fila d'un registre, si ja hi es. Mira primer l'ultim tram del full, que es
 * on cau tot el que s'escriu: un registre sempre es d'avui o de fa pocs dies.
 * Nomes si no el troba I la data que busquem es mes antiga que aquell tram,
 * llegeix la resta. Aixi el cas de cada dia costa el mateix tant si el full
 * te 200 files com si en te 20.000, i no es perd mai la garantia d'una sola
 * fila per jugadora, dia i moment.
 */
function trobaRegistre_(sh, caps, idJ, data, moment) {
  var ultima = sh.getLastRow();
  if (ultima < 2) return 0;

  var inici = Math.max(2, ultima - FINESTRA_FILES + 1);
  var trobat = cercaRegistre_(sh, caps, inici, ultima, idJ, data, moment);
  if (trobat || inici === 2) return trobat;

  // Queda full per mirar: nomes val la pena si el registre es anterior a
  // la data mes antiga del tram que ja hem recorregut.
  var iD = caps.indexOf('data');
  var mesAntiga = '';
  sh.getRange(inici, iD + 1, ultima - inici + 1, 1).getValues().forEach(function (f) {
    var d = dataISO_(f[0]);
    if (d && (!mesAntiga || d < mesAntiga)) mesAntiga = d;
  });
  if (mesAntiga && data >= mesAntiga) return 0;

  return cercaRegistre_(sh, caps, 2, inici - 1, idJ, data, moment);
}

/* ------------------------------------------------------------------ *
 *  Calculs de carrega                                                 *
 * ------------------------------------------------------------------ */

/** Suma de carregues d'una jugadora entre dues dates (incloses). */
function carregaEntre_(regs, idJ, desDe, finsA) {
  var t = 0, hiHaDades = false;
  regs.forEach(function (r) {
    if (r.id_jugadora !== idJ) return;
    if (r.data < desDe || r.data > finsA) return;
    if (r.moment !== 'despres' && r.moment !== 'partit') return;
    hiHaDades = true;
    t += Number(r.carrega) || 0;
  });
  return { total: t, hiHaDades: hiHaDades };
}

/**
 * Carrega de cada jugadora i cada setmana, en UNA sola passada pels
 * registres. Abans, el panell demanava el ratio jugadora per jugadora i
 * cada ratio recorria la llista sencera quatre vegades: amb 57 jugadores
 * son 228 passades per pintar una setmana.
 *
 * Retorna { idJugadora: { dillunsISO: carrega } }.
 */
function carreguesPerSetmana_(regs) {
  var index = {};
  regs.forEach(function (r) {
    // El partit compta com una sessio mes: la seva carrega surt de la
    // duresa que posa la jugadora pels minuts que posa l'entrenador.
    if (r.moment !== 'despres' && r.moment !== 'partit') return;
    var dl = dillunsDe_(r.data);
    if (!dl) return;
    var meu = index[r.id_jugadora] || (index[r.id_jugadora] = {});
    meu[dl] = (meu[dl] || 0) + (Number(r.carrega) || 0);
  });
  return index;
}

/** Dilluns de la setmana d'una data ISO, sempre en UTC. */
function dillunsDe_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  var p = iso.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return sumaDies_(iso, -((d.getUTCDay() + 6) % 7));
}

/**
 * El mateix que ratioDe_, pero llegint de l'index. Una setmana que no hi
 * consta es una setmana sense cap sessio registrada: no compta com a
 * referencia, igual que abans.
 */
function ratioAmbIndex_(index, idJ, dilluns) {
  var meu = index[idJ] || {};
  var setmana = meu[dilluns] || 0;
  var previes = [];
  for (var k = 1; k <= 3; k++) {
    var ini = sumaDies_(dilluns, -7 * k);
    if (meu[ini] !== undefined) previes.push(meu[ini]);
  }
  if (previes.length < 3) {
    return { carrega_setmana: setmana, mitjana_previa: null, ratio: null, motiu: 'dades insuficients' };
  }
  var mitjana = (previes[0] + previes[1] + previes[2]) / 3;
  return {
    carrega_setmana: setmana,
    mitjana_previa: Math.round(mitjana),
    ratio: mitjana > 0 ? Math.round((setmana / mitjana) * 100) / 100 : null,
    motiu: mitjana > 0 ? '' : 'sense carrega previa'
  };
}

/**
 * ratio = carrega d'aquesta setmana / mitjana de les 3 anteriors.
 * Amb menys de 3 setmanes previes amb dades no es calcula: una sola
 * setmana no es una referencia.
 */
function ratioDe_(regs, idJ, dilluns) {
  var setmana = carregaEntre_(regs, idJ, dilluns, sumaDies_(dilluns, 6)).total;
  var previes = [];
  for (var k = 1; k <= 3; k++) {
    var ini = sumaDies_(dilluns, -7 * k);
    var r = carregaEntre_(regs, idJ, ini, sumaDies_(ini, 6));
    if (r.hiHaDades) previes.push(r.total);
  }
  if (previes.length < 3) {
    return { carrega_setmana: setmana, mitjana_previa: null, ratio: null, motiu: 'dades insuficients' };
  }
  var mitjana = (previes[0] + previes[1] + previes[2]) / 3;
  return {
    carrega_setmana: setmana,
    mitjana_previa: Math.round(mitjana),
    ratio: mitjana > 0 ? Math.round((setmana / mitjana) * 100) / 100 : null,
    motiu: mitjana > 0 ? '' : 'sense càrrega prèvia'
  };
}

/* ------------------------------------------------------------------ *
 *  Panell del cos tecnic                                              *
 * ------------------------------------------------------------------ */

function getPanell_(equip, dilluns, usuari) {
  var conf = configuracio_();
  var llindar = num_(conf.llindar_carrega) || 1.3;
  var diesEntreno = llista_(conf.dies_recordatori);
  // La setmana que es mira i les 3 anteriors (pel ratio), amb un marge.
  var regs = registres_(sumaDies_(dilluns, -28));
  var indexCarregues = carreguesPerSetmana_(regs);
  // Nomes les jugadores que aquest usuari pot veure. Un entrenador sense
  // equips a la seva fila no en veu cap.
  var permesos = equipsPermesos_(usuari);
  var jugs = jugadores_(text_(equip), true).filter(function (j) {
    return !permesos || permesos.indexOf(j.equip) !== -1;
  });
  var avui = avuiISO_();

  var dies = [];
  for (var i = 0; i < 7; i++) dies.push(sumaDies_(dilluns, i));

  // Dies en que s'esperen respostes: els d'entrenament que ja han passat.
  var diesEsperats = dies.filter(function (d) {
    return (!diesEntreno.length || diesEntreno.indexOf(codiDia_(d)) !== -1) && d <= avui;
  });

  var alertes = [];
  var sensResposta = [];
  var rebuts = 0;

  var filesJug = jugs.map(function (j) {
    var meus = regs.filter(function (r) { return r.id_jugadora === j.id; });
    var perDia = {};
    dies.forEach(function (d) { perDia[d] = { abans: null, despres: null }; });

    meus.forEach(function (r) {
      if (perDia[r.data]) perDia[r.data][r.moment === 'despres' ? 'despres' : 'abans'] = r;
    });

    // Compliment
    var teuRebuts = 0;
    diesEsperats.forEach(function (d) {
      if (perDia[d].abans) teuRebuts++;
      if (perDia[d].despres) teuRebuts++;
    });
    rebuts += teuRebuts;
    if (teuRebuts === 0 && diesEsperats.length) sensResposta.push(j.nom);

    // Alerta vermella: dolor que limita
    dies.forEach(function (d) {
      var a = perDia[d].abans;
      if (a && a.limita) {
        alertes.push({
          nivell: 'vermella',
          jugadora: j.nom,
          id_jugadora: j.id,
          titol: 'Dolor que limita',
          detall: (a.zona_molestia || 'zona sense indicar') +
                  (a.dolor !== '' ? ' · dolor ' + a.dolor + '/10' : '') + ' · ' + d
        });
      }
    });

    // Alerta taronja: fatiga alta dos cops seguits.
    // Compara respostes consecutives, NO dies consecutius del calendari:
    // entrenant dilluns, dimecres i divendres no hi ha mai dos dies seguits
    // amb resposta, i l'alerta no podria saltar mai.
    var ambResposta = dies.filter(function (d) { return perDia[d].abans; });
    for (var k = 1; k < ambResposta.length; k++) {
      var ah = perDia[ambResposta[k - 1]].abans, av = perDia[ambResposta[k]].abans;
      if (Number(ah.fatiga) >= 4 && Number(av.fatiga) >= 4) {
        alertes.push({
          nivell: 'taronja',
          jugadora: j.nom,
          id_jugadora: j.id,
          titol: 'Fatiga sostinguda',
          detall: 'cansament ' + ah.fatiga + ' i ' + av.fatiga + ' (' + ambResposta[k - 1] + ' i ' + ambResposta[k] + ')'
        });
        break;
      }
    }

    var c = ratioAmbIndex_(indexCarregues, j.id, dilluns);
    if (c.ratio !== null && c.ratio > llindar) {
      alertes.push({
        nivell: 'taronja',
        jugadora: j.nom,
        id_jugadora: j.id,
        titol: 'Salt de càrrega',
        detall: 'ratio ' + c.ratio + ' (llindar ' + llindar + ')'
      });
    }

    var cel = dies.map(function (d) {
      var a = perDia[d].abans, p = perDia[d].despres;
      return {
        data: d,
        carrega: p ? (Number(p.carrega) || 0) : null,
        duresa: p ? p.duresa : null,
        minuts: p ? p.minuts : null,
        fatiga: a ? a.fatiga : null,
        son: a ? a.son : null,
        molestia: !!(a && a.te_molestia),
        // La zona i el dolor viatgen amb la cel·la perque el panell pugui
        // dir on fa mal sense haver d'obrir la fitxa de cada jugadora.
        zona: (a && a.te_molestia) ? a.zona_molestia : '',
        dolor: (a && a.te_molestia) ? a.dolor : null,
        limita: !!(a && a.limita),
        te_abans: !!a,
        te_despres: !!p
      };
    });

    return {
      id: j.id, nom: j.nom, dorsal: j.dorsal, equip: j.equip,
      dies: cel,
      carrega_setmana: c.carrega_setmana,
      mitjana_previa: c.mitjana_previa,
      ratio: c.ratio,
      motiu_ratio: c.motiu
    };
  });

  var esperats = jugs.length * diesEsperats.length * 2;

  return json_({
    ok: true,
    data: {
      setmana: dilluns,
      usuari: usuari,
      dies: dies,
      dies_esperats: diesEsperats,
      llindar: llindar,
      equips: llista_(conf.equips),
      jugadores: filesJug,
      // Primer les vermelles: son les que demanen una decisio avui mateix.
      alertes: alertes.sort(function (a, b) { return a.nivell === b.nivell ? 0 : (a.nivell === 'vermella' ? -1 : 1); }),
      compliment: {
        esperats: esperats,
        rebuts: rebuts,
        percentatge: esperats ? Math.round((rebuts / esperats) * 100) : null,
        sense_resposta: sensResposta
      }
    }
  });
}

/** Serie historica d'una jugadora. Nomes amb pin_staff. */
function getJugadoraStaff_(id, nSetmanes, usuari) {
  id = text_(id);
  var n = Math.min(Math.max(Number(nSetmanes) || 8, 1), 20);
  var j = jugadores_('', false).filter(function (x) { return x.id === id; })[0];
  if (!j) return json_({ ok: false, error: 'No hi ha cap jugadora amb aquest id.' });

  // Sense aquesta comprovacio, un entrenador podria demanar la fitxa de
  // qualsevol jugadora del club posant-hi l'id a ma.
  var permesos = equipsPermesos_(usuari);
  if (permesos && permesos.indexOf(j.equip) === -1) {
    return json_({ ok: false, error: "Aquesta jugadora no es d'un equip teu." });
  }

  var avui = avuiISO_();
  var p = avui.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  var dilluns = sumaDies_(avui, -((d.getUTCDay() + 6) % 7));

  // Les setmanes que es demanen i 3 mes, que son les que necessita el ratio.
  // L'historial de molesties queda acotat a aquesta mateixa finestra.
  var regs = registres_(sumaDies_(dilluns, -7 * (n + 3)))
    .filter(function (r) { return r.id_jugadora === id; });

  var setmanes = [];
  for (var k = n - 1; k >= 0; k--) {
    var ini = sumaDies_(dilluns, -7 * k);
    var fi = sumaDies_(ini, 6);
    var dins = regs.filter(function (r) { return r.data >= ini && r.data <= fi; });
    var fat = dins.filter(function (r) { return r.moment === 'abans' && r.fatiga !== ''; });
    var son = dins.filter(function (r) { return r.moment === 'abans' && r.son !== ''; });
    var mitjana = function (arr, camp) {
      if (!arr.length) return null;
      var t = 0;
      arr.forEach(function (r) { t += Number(r[camp]); });
      return Math.round((t / arr.length) * 10) / 10;
    };
    var c = ratioDe_(regs, id, ini);
    setmanes.push({
      setmana: ini,
      carrega: c.carrega_setmana,
      ratio: c.ratio,
      fatiga: mitjana(fat, 'fatiga'),
      son: mitjana(son, 'son'),
      sessions: dins.filter(function (r) { return r.moment === 'despres'; }).length
    });
  }

  var molesties = regs
    .filter(function (r) { return r.te_molestia; })
    .sort(function (a, b) { return b.data.localeCompare(a.data); })
    .slice(0, 30)
    .map(function (r) {
      return { data: r.data, zona: r.zona_molestia, dolor: r.dolor, limita: r.limita, comentari: r.comentari };
    });

  // Sense el codi: es el que fa servir per entrar i no ha de viatjar mai.
  var fitxa = { id: j.id, nom: j.nom, dorsal: j.dorsal, equip: j.equip, activa: j.activa };
  return json_({ ok: true, data: { jugadora: fitxa, setmanes: setmanes, molesties: molesties } });
}

/* ------------------------------------------------------------------ *
 *  Entrada HTTP                                                       *
 * ------------------------------------------------------------------ */

function doGet() {
  return ContentService
    .createTextOutput('Càrregues MCBF — servei intern. Cal fer servir l\'app.')
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Una sola porta d'entrada.
 *
 * El pany (LockService) NOMES envolta les escriptures. Abans l'agafava tot,
 * i obrir el panell —que son uns 7 segons— deixava clavades totes les
 * jugadores que en aquell moment enviaven el seu registre. Amb 12 enviaments
 * alhora, l'ultim trigava 28 segons i un es perdia per temps d'espera.
 *
 * Quan el pany no s'allibera a temps es retorna 'ocupat', que el mobil
 * distingeix d'un error de debo: manté el registre a la cua i ho torna a
 * provar sol una estona despres, sense dir res a la jugadora.
 */
/**
 * Una sola porta d'entrada.
 *
 * El pany (LockService) NOMES envolta les escriptures. Abans l'agafava tot,
 * i obrir el panell —que son uns 7 segons— deixava clavades totes les
 * jugadores que en aquell moment enviaven el seu registre.
 *
 * Quan el pany no s'allibera a temps es retorna 'ocupat', que el mobil
 * distingeix d'un error de debo: manté el registre a la cua i ho torna a
 * provar sol una estona despres, sense dir res a la jugadora.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = text_(body.action);
    var codi = text_(body.codi || body.pin_staff);

    /* ---- Entrar: l'unica accio que no demana res previ ---- */
    if (action === 'entrar') return entrar_(codi);

    /* ---- El que escriu la jugadora ---- */
    if (action === 'saveRegistre' || action === 'sync') {
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(25000);
      } catch (err) {
        return json_({ ok: false, ocupat: true,
                       error: 'El full esta ocupat. Es tornara a provar tot sol.' });
      }
      try {
        if (action === 'saveRegistre') return desaRegistre_(body.payload || {}, codi);
        return sync_(body.operacions, codi);
      } finally {
        lock.releaseLock();
      }
    }

    /* ---- La resta demana ser del cos tecnic ---- */
    var usuari = usuariPerCodi_(codi);
    if (!usuari) return json_({ ok: false, error: 'CODI' });

    if (action === 'saveSessio' || action === 'saveMinuts') {
      var pany = LockService.getScriptLock();
      try {
        pany.waitLock(25000);
      } catch (err) {
        return json_({ ok: false, ocupat: true,
                       error: 'El full esta ocupat. Torna-ho a provar.' });
      }
      try {
        if (action === 'saveSessio') return desaSessio_(body.payload || {}, usuari);
        return desaMinuts_(body.payload || {}, usuari);
      } finally {
        pany.releaseLock();
      }
    }

    switch (action) {
      case 'getPanell':   return getPanell_(body.equip, dataISO_(body.setmana), usuari);
      case 'getJugadora': return getJugadoraStaff_(body.id, body.n_setmanes, usuari);
      case 'getPartit':   return getPartit_(dataISO_(body.data), text_(body.equip), usuari);
      default:            return json_({ ok: false, error: 'Accio desconeguda: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Buida la cua d'un mobil: una sola espera de pany per a tots els registres. */
function sync_(operacions, codi) {
  var resultats = (operacions || []).map(function (op) {
    var r;
    try {
      r = JSON.parse(desaRegistre_(op.payload || {}, codi).getContent());
    } catch (err) {
      r = { ok: false, error: String(err && err.message ? err.message : err) };
    }
    return { opId: text_(op.opId), ok: !!r.ok, error: r.ok ? '' : (r.error || 'Error') };
  });
  return json_({ ok: true, data: { resultats: resultats } });
}

/**
 * El que l'entrenador necessita per a la pantalla de partit d'un dia: les
 * seves jugadores i els minuts que ja hi hagi posats, per poder corregir-los
 * en comptes de tornar a començar.
 */
function getPartit_(data, equip, usuari) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json_({ ok: false, error: 'Data no valida.' });
  var permesos = equipsPermesos_(usuari);
  if (permesos && permesos.indexOf(equip) === -1) {
    return json_({ ok: false, error: "Aquest equip no es teu." });
  }

  var jugs = jugadores_(equip, true).map(function (j) {
    return { id: j.id, nom: j.nom, dorsal: j.dorsal, equip: j.equip };
  });

  var trams = {};
  try {
    files_('minuts').forEach(function (m) {
      if (dataISO_(m.data) === data) trams[text_(m.id_jugadora)] = text_(m.tram);
    });
  } catch (err) { /* encara sense pestanya */ }

  var sessio = null;
  try {
    files_('sessions').forEach(function (s) {
      if (dataISO_(s.data) === data && text_(s.equip) === equip && text_(s.tipus) === 'partit') {
        sessio = { valoracio: num_(s.valoracio), comentari: text_(s.comentari) };
      }
    });
  } catch (err) { /* encara sense pestanya */ }

  return json_({ ok: true, data: { data: data, equip: equip, jugadores: jugs,
                                   trams: trams, sessio: sessio, llista_trams: TRAMS_MINUTS } });
}
