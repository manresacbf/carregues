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
    capcalera: ['id', 'nom', 'dorsal', 'equip', 'activa'],
    text: ['id', 'dorsal']
  },
  registres: {
    nom: 'Registres',
    // La clau real d'un registre no es l'id sino el trio jugadora+dia+moment:
    // vegeu desaRegistre_(). L'id nomes identifica l'enviament del mobil.
    clau: 'id',
    // nom_jugadora es nomes per poder llegir el full amb ulls humans: qui mana
    // es id_jugadora. Si canvia un nom a Jugadores, les files velles conserven
    // el que hi havia el dia que es van escriure.
    capcalera: ['id', 'id_jugadora', 'nom_jugadora', 'data', 'moment', 'son', 'fatiga', 'anim',
                'te_molestia', 'zona_molestia', 'dolor', 'limita', 'duresa',
                'minuts', 'carrega', 'comentari', 'timestamp'],
    text: ['id', 'id_jugadora', 'data', 'moment', 'te_molestia', 'limita', 'timestamp']
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
  config: {
    nom: 'Config',
    clau: 'clau',
    capcalera: ['clau', 'valor'],
    text: ['clau', 'valor']
  }
};

var CONFIG_INICIAL = [
  ['pin_staff', '1234'],
  ['equips', 'Sènior A'],
  ['llindar_carrega', '1,3'],
  // Dies que es considera que toca entrenar. Serveixen per saber quantes
  // respostes s'esperen i, per tant, per calcular el compliment.
  ['dies_recordatori', 'dl,dc,dv'],
  ['minuts_defecte', '90']
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
  ss.toast('Pestanyes preparades' + (noms ? ' · ' + noms + ' noms omplerts' : '') +
           '. Omple Jugadores i Usuaris.', 'Rendiment MCBF', 8);
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

/**
 * Qui truca. Busca el PIN a la pestanya Usuaris i, si encara es buida, el
 * pin_staff de Config continua valent com a director: aixi res no es trenca
 * mentre no s'omple.
 *
 * Retorna { ok:true, usuari:{ nom, rol, equips } }. Un director te equips
 * buit i ho veu tot; un entrenador nomes veu els equips de la seva fila.
 */
function identifica_(pin) {
  var props = PropertiesService.getScriptProperties();
  var fins = Number(props.getProperty('bloqueig_fins') || 0);
  if (fins && Date.now() < fins) {
    return { ok: false, error: 'Massa intents. Torna-ho a provar en uns minuts.' };
  }

  pin = text_(pin);
  var trobat = null;

  if (pin) {
    var usuaris = [];
    try { usuaris = files_('usuaris'); } catch (err) { usuaris = []; }   // encara sense pestanya
    usuaris.forEach(function (u) {
      if (trobat || text_(u.pin) !== pin) return;
      var rol = text_(u.rol).toLowerCase();
      var esEntrenador = rol.indexOf('entrenador') === 0;
      trobat = {
        nom: text_(u.nom) || 'Sense nom',
        rol: esEntrenador ? 'entrenador' : 'director',
        equips: esEntrenador ? llista_(u.equips) : []
      };
    });
    if (!trobat && pin === text_(configuracio_().pin_staff)) {
      trobat = { nom: 'Cos tecnic', rol: 'director', equips: [] };
    }
  }

  if (trobat) {
    props.deleteProperty('errades');
    props.deleteProperty('errades_des_de');
    props.deleteProperty('bloqueig_fins');
    return { ok: true, usuari: trobat };
  }

  var desDe = Number(props.getProperty('errades_des_de') || 0);
  var n = Number(props.getProperty('errades') || 0);
  if (!desDe || Date.now() - desDe > FINESTRA_MS) { desDe = Date.now(); n = 0; }
  n++;
  props.setProperty('errades_des_de', String(desDe));
  props.setProperty('errades', String(n));
  if (n >= MAX_ERRADES) props.setProperty('bloqueig_fins', String(Date.now() + FINESTRA_MS));
  return { ok: false, error: 'PIN' };
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
        activa: esSi_(f.activa)
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
 * Una unica fila per jugadora, dia i moment. Si el mobil reenvia el mateix
 * (cua offline, doble toc, dos dispositius), s'actualitza la fila que ja
 * hi ha en comptes d'afegir-ne una de nova.
 */
function desaRegistre_(p) {
  var idJ = text_(p.id_jugadora);
  var data = dataISO_(p.data);
  var moment = text_(p.moment);

  if (!idJ) return json_({ ok: false, error: 'Falta la jugadora.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json_({ ok: false, error: 'Data no valida: ' + data });
  if (moment !== 'abans' && moment !== 'despres') return json_({ ok: false, error: 'Moment no valid: ' + moment });

  // Nomes s'accepten registres de jugadores que existeixen i estan actives:
  // aixi el full no s'omple de files d'ids inventats.
  var jug = jugadores_('', true).filter(function (j) { return j.id === idJ; })[0];
  if (!jug) return json_({ ok: false, error: 'Aquesta jugadora no consta com a activa.' });

  var duresa = num_(p.duresa);
  var minuts = num_(p.minuts);
  // La carrega es calcula aqui, al servidor, perque els numeros del full
  // es puguin revisar sense dependre del que hagi fet el mobil.
  var carrega = (moment === 'despres' && duresa !== '' && minuts !== '') ? duresa * minuts : '';

  var fila = {
    id: text_(p.id) || Utilities.getUuid(),
    id_jugadora: idJ,
    nom_jugadora: jug.nom,
    data: data,
    moment: moment,
    son: moment === 'abans' ? num_(p.son) : '',
    fatiga: moment === 'abans' ? num_(p.fatiga) : '',
    anim: moment === 'abans' ? num_(p.anim) : '',
    te_molestia: moment === 'abans' ? siNo_(p.te_molestia) : '',
    zona_molestia: text_(p.zona_molestia),
    dolor: num_(p.dolor),
    limita: siNo_(p.limita),
    duresa: moment === 'despres' ? duresa : '',
    minuts: moment === 'despres' ? minuts : '',
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

  return json_({ ok: true, data: { id: fila.id, carrega: carrega === '' ? null : carrega, actualitzat: !!nFila } });
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
    if (r.moment !== 'despres') return;
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
    if (r.moment !== 'despres') return;
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

  return json_({ ok: true, data: { jugadora: j, setmanes: setmanes, molesties: molesties } });
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
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = text_(body.action);

    /* ---- Lectures obertes: sense pany ---- */
    if (action === 'getJugadores') {
      var conf = configuracio_();
      return json_({
        ok: true,
        data: {
          jugadores: jugadores_(text_(body.equip), true),
          equips: llista_(conf.equips),
          minuts_defecte: num_(conf.minuts_defecte) || 90,
          dies_entrenament: llista_(conf.dies_recordatori)
        }
      });
    }

    /* ---- Escriptures: aqui si, d'una en una ---- */
    if (action === 'saveRegistre' || action === 'sync') {
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(25000);
      } catch (err) {
        return json_({ ok: false, ocupat: true,
                       error: 'El full esta ocupat. Es tornara a provar tot sol.' });
      }
      try {
        if (action === 'saveRegistre') return desaRegistre_(body.payload || {});
        return sync_(body.operacions);
      } finally {
        lock.releaseLock();
      }
    }

    /* ---- La resta demana el PIN del cos tecnic (i tampoc no bloqueja) ---- */
    var qui = identifica_(body.pin_staff);
    if (!qui.ok) return json_(qui);

    switch (action) {
      case 'getPanell':   return getPanell_(body.equip, dataISO_(body.setmana), qui.usuari);
      case 'getJugadora': return getJugadoraStaff_(body.id, body.n_setmanes, qui.usuari);
      default:            return json_({ ok: false, error: 'Accio desconeguda: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Buida la cua d'un mobil: una sola espera de pany per a tots els registres. */
function sync_(operacions) {
  var resultats = (operacions || []).map(function (op) {
    var r;
    try {
      r = JSON.parse(desaRegistre_(op.payload || {}).getContent());
    } catch (err) {
      r = { ok: false, error: String(err && err.message ? err.message : err) };
    }
    return { opId: text_(op.opId), ok: !!r.ok, error: r.ok ? '' : (r.error || 'Error') };
  });
  return json_({ ok: true, data: { resultats: resultats } });
}
