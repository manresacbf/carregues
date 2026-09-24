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
    capcalera: ['id', 'id_jugadora', 'data', 'moment', 'son', 'fatiga', 'anim',
                'te_molestia', 'zona_molestia', 'dolor', 'limita', 'duresa',
                'minuts', 'carrega', 'comentari', 'timestamp'],
    text: ['id', 'id_jugadora', 'data', 'moment', 'te_molestia', 'limita', 'timestamp']
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
    (def.text || []).forEach(function (nomCol) {
      var i = caps.indexOf(nomCol);
      if (i !== -1) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  var conf = ss.getSheetByName(FULLS.config.nom);
  var existents = files_('config').map(function (f) { return String(f.clau || '').trim(); });
  var afegir = CONFIG_INICIAL.filter(function (c) { return existents.indexOf(c[0]) === -1; });
  if (afegir.length) conf.getRange(conf.getLastRow() + 1, 1, afegir.length, 2).setValues(afegir);

  ss.toast('Pestanyes preparades. Omple Jugadores i canvia el pin_staff.', 'Càrregues MCBF', 8);
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

function configuracio_() {
  var c = {};
  files_('config').forEach(function (f) {
    var k = text_(f.clau);
    if (k) c[k] = text_(f.valor);
  });
  return c;
}

function validaPinStaff_(pin) {
  var props = PropertiesService.getScriptProperties();
  var fins = Number(props.getProperty('bloqueig_fins') || 0);
  if (fins && Date.now() < fins) {
    return { ok: false, error: 'Massa intents. Torna-ho a provar en uns minuts.' };
  }
  var esperat = text_(configuracio_().pin_staff);
  if (!esperat) return { ok: false, error: 'No hi ha cap pin_staff a la pestanya Config.' };

  if (text_(pin) === esperat) {
    props.deleteProperty('errades');
    props.deleteProperty('errades_des_de');
    props.deleteProperty('bloqueig_fins');
    return { ok: true };
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

function registres_() {
  return files_('registres')
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

function trobaRegistre_(sh, caps, idJ, data, moment) {
  if (sh.getLastRow() < 2) return 0;
  var iJ = caps.indexOf('id_jugadora'), iD = caps.indexOf('data'), iM = caps.indexOf('moment');
  var dades = sh.getRange(2, 1, sh.getLastRow() - 1, caps.length).getValues();
  for (var i = 0; i < dades.length; i++) {
    if (text_(dades[i][iJ]) === idJ && dataISO_(dades[i][iD]) === data && text_(dades[i][iM]) === moment) {
      return i + 2;
    }
  }
  return 0;
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

function getPanell_(equip, dilluns) {
  var conf = configuracio_();
  var llindar = num_(conf.llindar_carrega) || 1.3;
  var diesEntreno = llista_(conf.dies_recordatori);
  var regs = registres_();
  var jugs = jugadores_(text_(equip), true);
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

    // Alerta taronja: fatiga alta dos dies seguits
    for (var k = 1; k < dies.length; k++) {
      var ah = perDia[dies[k - 1]].abans, av = perDia[dies[k]].abans;
      if (ah && av && Number(ah.fatiga) >= 4 && Number(av.fatiga) >= 4) {
        alertes.push({
          nivell: 'taronja',
          jugadora: j.nom,
          id_jugadora: j.id,
          titol: 'Fatiga sostinguda',
          detall: 'fatiga ' + ah.fatiga + ' i ' + av.fatiga + ' el ' + dies[k - 1] + ' i el ' + dies[k]
        });
        break;
      }
    }

    var c = ratioDe_(regs, j.id, dilluns);
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
function getJugadoraStaff_(id, nSetmanes) {
  id = text_(id);
  var n = Math.min(Math.max(Number(nSetmanes) || 8, 1), 20);
  var j = jugadores_('', false).filter(function (x) { return x.id === id; })[0];
  if (!j) return json_({ ok: false, error: 'No hi ha cap jugadora amb aquest id.' });

  var regs = registres_().filter(function (r) { return r.id_jugadora === id; });
  var avui = avuiISO_();
  var p = avui.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  var dilluns = sumaDies_(avui, -((d.getUTCDay() + 6) % 7));

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

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: 'El full esta ocupat. Torna-ho a provar.' });
  }

  try {
    var body = JSON.parse(e.postData.contents);
    var action = text_(body.action);

    // Accions obertes: nomes la llista de noms i desar el propi registre.
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
    if (action === 'saveRegistre') return desaRegistre_(body.payload || {});
    if (action === 'sync') {
      var resultats = (body.operacions || []).map(function (op) {
        var r;
        try {
          r = JSON.parse(desaRegistre_(op.payload || {}).getContent());
        } catch (err2) {
          r = { ok: false, error: String(err2 && err2.message ? err2.message : err2) };
        }
        return { opId: text_(op.opId), ok: !!r.ok, error: r.ok ? '' : (r.error || 'Error') };
      });
      return json_({ ok: true, data: { resultats: resultats } });
    }

    // A partir d'aqui, tot demana el PIN del cos tecnic.
    var pin = validaPinStaff_(body.pin_staff);
    if (!pin.ok) return json_(pin);

    switch (action) {
      case 'getPanell':   return getPanell_(body.equip, dataISO_(body.setmana));
      case 'getJugadora': return getJugadoraStaff_(body.id, body.n_setmanes);
      default:            return json_({ ok: false, error: 'Accio desconeguda: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}
