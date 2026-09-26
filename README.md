# Càrregues MCBF

PWA perquè les jugadores dels equips de rendiment diguin, en pocs segons, com
arriben a l'entrenament i com l'acaben, i perquè el cos tècnic vegi la càrrega i
l'estat de l'equip d'un cop d'ull.

App **independent** de `manresa-hub`, de `jugadores` i de `scouting`: full de
càlcul propi, desplegament d'Apps Script propi i PIN propi.

> La rajola «Com estàs?» de l'app `jugadores` continua com estava i serveix els
> seus equips. Aquesta app és per als equips de rendiment, i el text de la
> pantalla d'entrada ho diu perquè ningú ompli la que no li toca.

## Fitxers

| Fitxer | Què és |
|---|---|
| `index.html` | Marcatge, estils, mapa corporal i `CONFIG.API_URL` |
| `app.js` | Tota la lògica: cua offline, formularis, resum i panell |
| `service-worker.js` | Còpia local de l'app per obrir-la sense cobertura |
| `manifest.json` | Fa que s'instal·li com a app |
| `Codi_AppsScript.gs` | Backend: enganxa'l dins el full de càlcul |
| `icon-*.png` | Escut del club |

## Posar-ho en marxa

1. Crea un Google Sheet nou anomenat **Càrregues MCBF**.
2. **Extensions → Apps Script**, enganxa-hi `Codi_AppsScript.gs` i desa.
3. Executa la funció **`setup`** (▶). Crea les pestanyes `Jugadores`,
   `Registres` i `Config`.
4. Omple **`Jugadores`**: una fila per jugadora amb `id` (qualsevol text únic:
   `j01`, `j02`…), `nom`, `dorsal`, `equip` i `activa` = `SI`. La columna
   **`codi`** l'omple `setup()` sola: és amb què entra cada jugadora a l'app.
5. Omple **`Usuaris`**: una fila per persona del cos tècnic (vegeu *Qui veu què*).
6. A **`Config`**, repassa `tipus_sessio`, `dies_recordatori` i la resta de claus.
7. **Desplega → Nou desplegament → Aplicació web** (executant com a tu, accés
   per a qualsevol persona) i enganxa la URL `/exec` a `CONFIG.API_URL`, dins
   `index.html`.

### Les claus de `Config`

| Clau | Per a què serveix |
|---|---|
| `pin_staff` | Únic accés al panell i a les fitxes individuals |
| `equips` | Llista separada per comes; si n'hi ha més d'un, surt un selector |
| `llindar_carrega` | Ràtio a partir del qual salta l'alerta (1,3 per defecte) |
| `dies_recordatori` | Dies que es considera que toca entrenar (`dl,dc,dv`). **D'aquí surt el compliment**: les respostes esperades es compten només d'aquests dies |
| `minuts_defecte` | Minuts que surten ja posats al formulari de després |

## Publicar

Repositori: <https://github.com/manresacbf/carregues>, amb **Pages** activat
sobre `main` (arrel). Queda servida a <https://manresacbf.github.io/carregues/>.
Ha d'anar per HTTPS o el service worker no arrenca.

Instal·lar-la al mòbil: **Android** (Chrome) menú → *Instal·lar aplicació*;
**iPhone** cal **Safari** → Compartir → *Afegir a la pantalla d'inici*.

Com que Pages demana repositori públic, la URL `/exec` del full és visible.
No dona accés a res: la llista de noms és l'única cosa que es pot llegir sense
`pin_staff`, i tota la resta el demana. Val la pena, tot i això, que el
`pin_staff` sigui de 6 dígits.

## Llegir el full amb ulls humans

La pestanya `Registres` té una columna **`nom_jugadora`** que el full omple
sol en desar. Qui mana segueix sent `id_jugadora`: el nom hi és només per
poder llegir el full sense anar comparant identificadors. Si canvia un nom a
`Jugadores`, les files velles conserven el que hi havia el dia que es van
escriure.

**No hi posis fórmules (`VLOOKUP` i companyia) a mà.** Quan una jugadora
actualitza un registre, el codi reescriu la fila sencera i se't menjaria la
fórmula. Si et falta una dada al full, digues-ho i s'afegeix al codi.

Les columnes **es poden reordenar** com vulguis: tot s'hi accedeix pel nom de
la capçalera, mai per posició. I `setup()` afegeix les columnes que falten
sense moure res del que ja hi ha, així que es pot tornar a executar sempre.

## Entrar: un sol codi

No hi ha cap llista de noms a la pantalla d'entrada. Cadascú escriu el seu codi
i el full decideix què obre:

| Qui | On té el codi | Què veu |
|---|---|---|
| Jugadora | columna `codi` de `Jugadores` | les seves pantalles i el seu resum |
| Entrenador | columna `pin` de `Usuaris` | el panell del seu equip |
| Director | columna `pin` de `Usuaris`, rol `director` | el panell de tots els equips |

`setup()` genera els codis que falten, de 4 xifres, i no en repeteix cap: ni
entre jugadores ni amb els de l'staff. Per canviar-ne un, escriu-lo a mà a la
casella; per treure l'accés a algú, esborra'l.

**Escriure demana el codi de qui escriu.** El full no es fia de l'identificador
que li arriba: mira de qui és el codi i desa el registre a aquella jugadora.
Abans qualsevol podia enviar dades fent-se passar per una altra.

## Qui veu què

Cada persona del cos tècnic té el seu PIN a la pestanya **`Usuaris`**:

| Columna | Què hi va |
|---|---|
| `pin` | El seu codi d'entrada. Canviar-lo o esborrar la fila li treu l'accés |
| `nom` | Surt a dalt del panell, perquè se sàpiga amb qui s'ha entrat |
| `rol` | `director` (ho veu tot) o `entrenador` (només els seus equips) |
| `equips` | Els seus equips, separats per comes. Només compta si és `entrenador` |

Un **entrenador sense cap equip a la seva fila no veu cap jugadora**. És a
posta: val més que es quedi curt que no pas que ho obri tot per una casella
mal omplerta.

Mentre la pestanya `Usuaris` sigui buida, el `pin_staff` de `Config` continua
funcionant com a director, així que res no es trenca abans d'omplir-la.

**El filtratge es fa al servidor**, no al mòbil: `getPanell` només envia les
jugadores dels equips permesos, i `getJugadora` refusa la fitxa d'una jugadora
d'un altre equip. Si es fes al mòbil, un entrenador podria canviar la petició
i veure-ho tot igualment. Els xips de filtre del panell són comoditat visual,
no una barrera.

## Privacitat

No és només documentació: està al codi.

- **Cap crida retorna dades d'una jugadora sense `pin_staff`.** `getJugadores`
  només dona nom, dorsal i equip, i `saveRegistre` només torna la càrrega del
  registre que acaba de desar.
- Per això **«El meu resum» es calcula al mòbil**, amb els registres que aquest
  aparell ha enviat. Si hi hagués una crida «dona'm l'històric de la jugadora
  X», qualsevol podria canviar l'id i llegir les dades d'una companya, perquè
  els identificadors van dins la llista de noms. El preu d'aquesta decisió: qui
  canviï de mòbil perd el seu resum. El full i el panell ho conserven tot.
- Cap comparativa ni classificació entre jugadores a la vista de jugadora.
- El full ha de quedar **restringit** als comptes del cos tècnic de rendiment.
- L'app registra i avisa; no diagnostica ni recomana res.

## Què registra cadascú

**La jugadora**, des de la seva pantalla:

- **Abans**: son, cansament, ànim i molèstia (amb el mapa corporal si n'hi ha).
- **Després**: quin entrenament ha fet —els tipus i els seus minuts són a
  `Config` → `tipus_sessio`— i com de dur ha estat, amb cinc cares.
- **Dia de partit**: com ha anat, com de dur, molèstia i un comentari.

**L'entrenador**, des del panell:

- **Dia de partit**: els minuts de cada jugadora per trams i com ha anat el
  partit.
- **Dia d'entrenament**: com ha anat, si s'ha complert l'objectiu i un
  comentari.

Les cares de duresa es guarden **en escala 0–10** (2, 4, 6, 8, 10) encara que
la jugadora en vegi cinc: la càrrega és `duresa × minuts` i canviar l'escala
hauria partit la comparació amb les setmanes ja registrades.

## Càlculs

```
carrega_sessio  = duresa × minuts          (es calcula al servidor)
                  entrenament: els minuts del tipus de sessió
                  partit: els minuts del tram que posa l'entrenador
carrega_setmana = suma de les càrregues de dilluns a diumenge
mitjana_previa  = mitjana de les 3 setmanes anteriors
ratio           = carrega_setmana / mitjana_previa
```

Sense 3 setmanes prèvies amb dades **no es calcula el ràtio**: es diu «dades
insuficients». Una sola setmana no és una referència.

Atenció a la direcció de les escales, perquè d'aquí surt una alerta: a **son** i
**ànim**, 5 és el millor; a **fatiga**, 5 és el pitjor.

## Alertes

| Alerta | Condició | Nivell |
|---|---|---|
| Dolor que limita | `limita = SI` | Vermella |
| Fatiga sostinguda | `fatiga ≥ 4` en **dues respostes seguides** | Taronja |
| Salt de càrrega | `ratio > llindar_carrega` | Taronja |

Surten a dalt de tot del panell, abans de cap taula.

«Dues respostes seguides» i no «dos dies consecutius»: entrenant dilluns,
dimecres i divendres no hi ha mai dos dies seguits amb resposta, i l'alerta
no podria saltar mai.

Sota les alertes hi ha el bloc **Molèsties d'aquesta setmana**, que mostra
també les que no limiten: aquestes no generen alerta i, si no, només es
veurien entrant a la fitxa de cada jugadora.

## Manteniment

**Cada cop que publiquis canvis, puja el número de `VERSIO` a
`service-worker.js`**, o els mòbils ja instal·lats es quedaran amb la còpia
antiga.

Si canvies el `.gs`: **Desplega → Gestiona desplegaments → editar → Versió:
Nova versió**, i la URL `/exec` no canvia.

## Com creix el full

Amb 75 jugadores surten unes 450 files per setmana i unes 18.000 per
temporada. Prou per sota del límit de Google Sheets (10 milions de cel·les),
però sí prou per notar-ho si cada operació llegís el full sencer. Per això:

- **En desar un registre** es busca primer a les últimes 1.500 files, que és
  on cau tot el que s'escriu. Només si no s'hi troba i la data és anterior a
  aquell tram es llegeix la resta, de manera que no es perd mai la garantia
  d'una fila per jugadora, dia i moment.
- **El panell** llegeix la setmana que es mira i 4 més enrere, no tot
  l'històric. Per trobar per on començar es llegeix només la columna de
  dates: una columna en comptes de setze.
- **La fitxa individual** llegeix les setmanes que demana i 3 més, les que
  necessita el ràtio. Això acota també l'historial de molèsties que hi surt:
  amb els 8 valors per defecte, uns tres mesos enrere.

El que no s'ha tocat és que Apps Script atén les peticions d'una en una. Si
totes envien alhora en acabar l'entrenament, es fa cua; la cua del mòbil
reintenta sola i no es perd res, però algunes veuran «pendent» una estona.

## Fase posterior, anotada i no feta

El **seguiment del cicle menstrual** queda fora d'aquesta versió a posta. És
útil per llegir la fatiga, però abans el club ha de decidir qui hi té accés i
com es demana el consentiment. No s'ha afegit cap camp ni cap columna: quan
això estigui decidit, caldrà tornar a obrir el tema des de zero.
