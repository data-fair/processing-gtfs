import { strict as assert } from 'node:assert'
import { describe, it, before, after } from 'node:test'
import path from 'node:path'
import fs from 'fs-extra'
import { fileURLToPath } from 'node:url'
import { formatGtfsTime, isoDate, loadCalendar, loadFrequencies, loadRoutes, loadStops, loadTrips, parseGtfsTime, routeName, weekDayIndex, type Reference } from '../lib/gtfs/read.ts'
import { buildStopTimesIndex, writeStopTimes } from '../lib/gtfs/stop-times.ts'
import { writeStops } from '../lib/gtfs/stops.ts'
import { writeShapes } from '../lib/gtfs/shapes.ts'
import { SCHEMAS } from '../lib/schemas.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const ALNUM = path.join(here, 'resources/alnum')
const MIDNIGHT = path.join(here, 'resources/midnight')
const FREQUENCIES = path.join(here, 'resources/frequencies')
const OUT = path.join(here, '../data/test-out')

const noopLog: any = {
  step: async () => {},
  info: async () => {},
  warning: async () => {},
  error: async () => {},
  debug: async () => {},
  task: async () => {},
  progress: async () => {}
}

const loadReference = async (dir: string): Promise<Reference> => ({
  routes: await loadRoutes(dir),
  stops: await loadStops(dir),
  trips: await loadTrips(dir),
  calendar: await loadCalendar(dir),
  frequencies: await loadFrequencies(dir)
})

const readCsv = async (file: string) => {
  const text = await fs.readFile(file, 'utf8')
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? []
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').replace(/^"|"$/g, '')]))
  })
}

before(async () => { await fs.ensureDir(OUT) })
after(async () => { await fs.remove(OUT) })

describe('lecture des tables GTFS', () => {
  it('convertit les dates GTFS en ISO', () => {
    assert.equal(isoDate('20260701'), '2026-07-01')
    assert.equal(isoDate(''), '')
  })

  it('préfère le nom court au nom long pour désigner une ligne', () => {
    assert.equal(routeName({ route_short_name: 'A', route_long_name: 'Gare - Plage' } as any), 'A')
    assert.equal(routeName({ route_short_name: '', route_long_name: 'Gare - Plage' } as any), 'Gare - Plage')
    assert.equal(routeName(undefined), '')
  })

  it('absorbe un BOM UTF-8 sans corrompre la première colonne', async () => {
    const routes = await loadRoutes(MIDNIGHT)
    assert.ok(routes.has('N1'), 'route_id doit être lisible malgré le BOM')
    assert.equal(routes.get('N1')?.route_color, '#000080')
  })

  it('préfixe la couleur de ligne par un dièse', async () => {
    const routes = await loadRoutes(ALNUM)
    assert.equal(routes.get('LIGNE-A')?.route_color, '#FF0000')
    assert.equal(routes.get('LIGNE-B')?.route_color, '', 'une couleur absente reste vide')
  })

  it('traduit les jours de circulation', async () => {
    const calendar = await loadCalendar(ALNUM)
    assert.equal(calendar.get('SERV-1')?.week, 'Lundi;Mardi;Mercredi;Jeudi;Vendredi')
    assert.equal(calendar.get('SERV-1')?.start_date, '2026-07-01')
  })
})

describe('horaires', () => {
  it('résout origine et destination même si le fichier est en ordre inversé', async () => {
    const ref = await loadReference(ALNUM)
    const { tripEnds } = await buildStopTimesIndex(ALNUM, ref, { collectStopRoutes: false }, noopLog)
    // l'ancre du cadencement suit la même règle : le départ du premier arrêt en séquence,
    // pas celui de la première ligne du fichier
    assert.deepEqual(tripEnds.get('TRIP-A1'), {
      origin: 'Gare routière',
      destination: 'Plage du Lido',
      anchor: 8 * 3600
    })
  })

  it('collecte les lignes desservant chaque arrêt, sans doublon', async () => {
    const ref = await loadReference(ALNUM)
    const { stopRoutes } = await buildStopTimesIndex(ALNUM, ref, { collectStopRoutes: true }, noopLog)
    assert.deepEqual([...(stopRoutes?.get('STOP_A12') ?? [])].sort(), ['A', 'B'])
    assert.deepEqual([...(stopRoutes?.get('STOP_B7') ?? [])], ['A'])
  })

  it('conserve les identifiants alphanumériques tels quels', async () => {
    const ref = await loadReference(ALNUM)
    const { tripEnds } = await buildStopTimesIndex(ALNUM, ref, { collectStopRoutes: false }, noopLog)
    const out = path.join(OUT, 'stop_times.csv')
    await writeStopTimes(ALNUM, ref, tripEnds, out, noopLog)
    const rows = await readCsv(out)
    assert.equal(rows.length, 4)
    assert.ok(rows.some(r => r.trip_id === 'TRIP-A1' && r.stop_id === 'STOP_A12'))
  })

  it('reporte le sens de circulation et la précision de l\'horaire', async () => {
    const ref = await loadReference(ALNUM)
    const { tripEnds } = await buildStopTimesIndex(ALNUM, ref, { collectStopRoutes: false }, noopLog)
    const out = path.join(OUT, 'stop_times_direction.csv')
    await writeStopTimes(ALNUM, ref, tripEnds, out, noopLog)
    const rows = await readCsv(out)
    const aller = rows.find(r => r.trip_id === 'TRIP-A1' && r.stop_id === 'STOP_A12')
    assert.equal(aller?.direction_id, '0', 'le sens vient de trips.txt')
    assert.equal(aller?.timepoint, '0')
    assert.equal(rows.find(r => r.trip_id === 'TRIP-B1')?.direction_id, '1')
    // un timepoint vide vaut « horaire garanti » selon la spec, il reste vide en donnée
    assert.equal(rows.find(r => r.trip_id === 'TRIP-B1')?.timepoint, '')
  })

  it("n'écrit aucun attribut d'arrêt ni de ligne dans le fichier", async () => {
    const ref = await loadReference(ALNUM)
    const { tripEnds } = await buildStopTimesIndex(ALNUM, ref, { collectStopRoutes: false }, noopLog)
    const out = path.join(OUT, 'stop_times_columns.csv')
    await writeStopTimes(ALNUM, ref, tripEnds, out, noopLog)
    const rows = await readCsv(out)
    for (const key of ['stop_lat', 'stop_lng', 'route_color', 'location_type', 'wheelchair_boarding']) {
      assert.ok(!(key in rows[0]), `${key} ne doit plus être écrit`)
    }
    assert.equal(rows[0].stop_name !== undefined, true)
  })

  it('laisse intactes les heures au-delà de 24:00:00', async () => {
    const ref = await loadReference(MIDNIGHT)
    const { tripEnds } = await buildStopTimesIndex(MIDNIGHT, ref, { collectStopRoutes: false }, noopLog)
    const out = path.join(OUT, 'stop_times_midnight.csv')
    await writeStopTimes(MIDNIGHT, ref, tripEnds, out, noopLog)
    const rows = await readCsv(out)
    const late = rows.find(r => r.stop_id === 'S2')
    assert.equal(late?.arrival_time, '25:30:00')
    assert.equal(late?.stop_destination, 'Dépôt')
  })
})

describe('arrêts', () => {
  it('produit un point par arrêt géolocalisé et ignore les autres', async () => {
    const ref = await loadReference(ALNUM)
    const { stopRoutes } = await buildStopTimesIndex(ALNUM, ref, { collectStopRoutes: true }, noopLog)
    const out = path.join(OUT, 'stops.geojson')
    await writeStops(ref, stopRoutes, out, noopLog)
    const geojson = await fs.readJson(out)
    assert.equal(geojson.type, 'FeatureCollection')
    // GARE-STATION n'a pas de coordonnées et ne doit pas produire de géométrie vide
    assert.equal(geojson.features.length, 3)
    const gare = geojson.features.find((f: any) => f.properties.stop_id === 'STOP_A12')
    assert.deepEqual(gare.geometry, { type: 'Point', coordinates: [9.4501, 42.7028] })
    assert.equal(gare.properties.routes, 'A;B')
    assert.equal(gare.properties.stop_url, 'https://exemple.fr/a12')
  })
})

describe('tracés', () => {
  it('ordonne les points par séquence et non par ordre du fichier', async () => {
    const ref = await loadReference(ALNUM)
    const out = path.join(OUT, 'shapes.geojson')
    await writeShapes(ALNUM, ref, out, noopLog)
    const geojson = await fs.readJson(out)
    const shapeA = geojson.features.find((f: any) => f.properties.shape_id === 'SHAPE-A')
    assert.deepEqual(shapeA.geometry.coordinates, [
      [9.4501, 42.7028],
      [9.455, 42.709],
      [9.4602, 42.715]
    ])
    assert.equal(shapeA.properties.route_short_name, 'A')
    assert.equal(shapeA.properties.wheelchair_boarding, '1')
    assert.equal(shapeA.properties.direction_id, '0')
  })
})

describe('schémas de sortie', () => {
  const schemas = SCHEMAS

  // direction_id is deliberately absent: despite its name it is an enum, not an identifier
  const IDENTIFIERS = ['trip_id', 'stop_id', 'route_id', 'shape_id', 'zone_id', 'parent_station']

  it('type les identifiants en chaîne, jamais en entier', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      for (const property of schema) {
        if (IDENTIFIERS.includes(property.key)) {
          assert.equal(property.type, 'string', `${name}.${property.key} doit être une chaîne`)
        }
      }
    }
  })

  it('type le sens de circulation en entier malgré son suffixe _id', () => {
    const byKey = Object.fromEntries(schemas.shapes.map(p => [p.key, p]))
    assert.equal(byKey.direction_id.type, 'integer')
    assert.equal(byKey.direction_id['x-labels']?.[1], 'Sens 2')
  })

  it('pose un libellé et une géométrie sur les arrêts', () => {
    const byKey = Object.fromEntries(schemas.stops.map(p => [p.key, p]))
    assert.equal(byKey.stop_name['x-refersTo'], 'http://www.w3.org/2000/01/rdf-schema#label')
    assert.equal(byKey.geometry['x-refersTo'], 'https://purl.org/geojson/vocab#geometry')
    assert.equal(byKey.stop_url['x-refersTo'], 'https://schema.org/WebPage')
  })

  it('pose les dates de validité en format date', () => {
    const byKey = Object.fromEntries(schemas['stop-times'].map(p => [p.key, p]))
    assert.equal(byKey.start_date.format, 'date')
    assert.equal(byKey.start_date['x-refersTo'], 'https://schema.org/startDate')
    assert.equal(byKey.end_date['x-refersTo'], 'https://schema.org/endDate')
  })

  it('pose la couleur de la ligne sur les traces', () => {
    const byKey = Object.fromEntries(schemas.shapes.map(p => [p.key, p]))
    assert.equal(byKey.route_color['x-refersTo'], 'https://schema.org/color')
  })

  it('pose les concepts arrêt et ligne du vocabulaire standard', () => {
    const stops = Object.fromEntries(schemas.stops.map(p => [p.key, p]))
    assert.equal(stops.stop_id['x-refersTo'], 'http://vocab.gtfs.org/terms#Stop')
    assert.equal(stops.routes['x-refersTo'], 'http://vocab.gtfs.org/terms#Route')
    // les mêmes concepts doivent être posés dans les horaires et les tracés : c'est ce qui rend les jeux joignables
    const stopTimes = Object.fromEntries(schemas['stop-times'].map(p => [p.key, p]))
    assert.equal(stopTimes.stop_id['x-refersTo'], 'http://vocab.gtfs.org/terms#Stop')
    assert.equal(stopTimes.route_name['x-refersTo'], 'http://vocab.gtfs.org/terms#Route')
    const shapes = Object.fromEntries(schemas.shapes.map(p => [p.key, p]))
    assert.equal(shapes.route_short_name['x-refersTo'], 'http://vocab.gtfs.org/terms#Route')
  })

  // les horaires n'embarquent plus les attributs qui décrivent l'arrêt ou la ligne :
  // ils vivent dans les jeux arrêts et tracés, que les applications lisent en parallèle
  it("ne duplique dans les horaires aucun attribut d'arrêt ni de ligne", () => {
    const keys = schemas['stop-times'].map(p => p.key)
    for (const key of ['stop_lat', 'stop_lng', 'route_color', 'location_type', 'wheelchair_boarding']) {
      assert.ok(!keys.includes(key), `${key} ne doit plus figurer dans les horaires`)
    }
    // le libellé de l'arrêt reste, sans lui chaque ligne n'est qu'un identifiant
    assert.ok(keys.includes('stop_name'))
    assert.ok(keys.includes('stop_origin'))
    assert.ok(keys.includes('stop_destination'))
  })
})

describe('calendrier des services', () => {
  it('situe une date GTFS dans la semaine, lundi en premier', () => {
    assert.equal(weekDayIndex('20260706'), 0) // lundi
    assert.equal(weekDayIndex('20260711'), 5) // samedi
    assert.equal(weekDayIndex('20260712'), 6) // dimanche
    assert.equal(weekDayIndex('pas une date'), undefined)
  })

  it('lit calendar.txt quand il est là', async () => {
    const calendar = await loadCalendar(ALNUM)
    assert.deepEqual(calendar.get('SERV-1'), {
      week: 'Lundi;Mardi;Mercredi;Jeudi;Vendredi',
      start_date: '2026-07-01',
      end_date: '2026-08-31'
    })
  })

  it('déduit la semaine et la période de calendar_dates.txt quand calendar.txt manque', async () => {
    const calendar = await loadCalendar(FREQUENCIES)
    // les deux dates ajoutées tombent un lundi et un samedi, la date retirée un mardi
    assert.deepEqual(calendar.get('SERV-DATES'), {
      week: 'Lundi;Samedi',
      start_date: '2026-07-06',
      end_date: '2026-07-11'
    })
  })

  it("ne raccourcit pas un service parce qu'une journée est annulée", async () => {
    const dir = path.join(OUT, 'exceptions')
    await fs.ensureDir(dir)
    await fs.writeFile(path.join(dir, 'calendar.txt'),
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
      'S1,1,1,1,1,1,0,0,20260701,20260831\n')
    // un lundi férié retiré et un dimanche de renfort ajouté
    await fs.writeFile(path.join(dir, 'calendar_dates.txt'),
      'service_id,date,exception_type\nS1,20260713,2\nS1,20260906,1\n')

    const calendar = await loadCalendar(dir)
    assert.deepEqual(calendar.get('S1'), {
      week: 'Lundi;Mardi;Mercredi;Jeudi;Vendredi;Dimanche',
      start_date: '2026-07-01',
      // le renfort du 6 septembre repousse la fin de validité
      end_date: '2026-09-06'
    })
  })

  it('avertit quand aucun des deux fichiers de calendrier n\'est présent', async () => {
    const dir = path.join(OUT, 'sans-calendrier')
    await fs.ensureDir(dir)
    const warnings: string[] = []
    const log: any = { ...noopLog, warning: async (msg: string) => { warnings.push(msg) } }

    const calendar = await loadCalendar(dir, log)
    assert.equal(calendar.size, 0)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /calendar_dates.txt/)
  })
})

describe('horaires cadencés', () => {
  it('convertit les heures GTFS en secondes, au-delà de minuit', () => {
    assert.equal(parseGtfsTime('06:00:00'), 21600)
    assert.equal(parseGtfsTime('25:30:00'), 91800)
    assert.equal(parseGtfsTime(''), undefined)
    assert.equal(parseGtfsTime('6h'), undefined)
    assert.equal(formatGtfsTime(21600), '06:00:00')
    assert.equal(formatGtfsTime(91800), '25:30:00')
  })

  it('ignore une fenêtre sans intervalle exploitable', async () => {
    const dir = path.join(OUT, 'frequences-vides')
    await fs.ensureDir(dir)
    await fs.writeFile(path.join(dir, 'frequencies.txt'),
      'trip_id,start_time,end_time,headway_secs,exact_times\n' +
      'T1,06:00:00,07:00:00,0,0\n' +
      'T1,06:00:00,07:00:00,,0\n' +
      'T2,pas une heure,07:00:00,600,0\n')

    const frequencies = await loadFrequencies(dir)
    assert.equal(frequencies.size, 0)
  })

  it('déploie chaque passage de référence sur toute la fenêtre de cadencement', async () => {
    const ref = await loadReference(FREQUENCIES)
    const index = await buildStopTimesIndex(FREQUENCIES, ref, { collectStopRoutes: false }, noopLog)
    const out = path.join(OUT, 'stop_times_freq.csv')
    await writeStopTimes(FREQUENCIES, ref, index.tripEnds, out, noopLog)
    const rows = await readCsv(out)

    // 2 arrêts x (3 départs de 6h à 6h30 + 1 départ à 7h) + les 2 arrêts du voyage fixe
    assert.equal(rows.length, 10)

    const first = rows.filter(r => r.trip_id === 'TRIP-FREQ' && r.stop_id === 'STOP_1')
    assert.deepEqual(first.map(r => r.departure_time), ['06:00:00', '06:10:00', '06:20:00', '07:00:00'])

    // le gabarit met 6 minutes entre les deux arrêts et repart 1 minute plus tard
    const second = rows.filter(r => r.trip_id === 'TRIP-FREQ' && r.stop_id === 'STOP_2')
    assert.deepEqual(second.map(r => r.arrival_time), ['06:06:00', '06:16:00', '06:26:00', '07:06:00'])
    assert.deepEqual(second.map(r => r.departure_time), ['06:07:00', '06:17:00', '06:27:00', '07:07:00'])

    // exact_times 0 : le véhicule tient l'intervalle, pas l'horloge
    assert.deepEqual(first.map(r => r.timepoint), ['0', '0', '0', '1'])

    // le voyage sans fenêtre de cadencement passe inchangé, minuit compris
    const fixe = rows.filter(r => r.trip_id === 'TRIP-FIXE')
    assert.deepEqual(fixe.map(r => r.arrival_time), ['23:50:00', '24:05:00'])

    // la période de circulation vient bien de calendar_dates.txt
    assert.equal(rows[0].week, 'Lundi;Samedi')
    assert.equal(rows[0].start_date, '2026-07-06')
  })
})
