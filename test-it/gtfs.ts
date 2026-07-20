import { strict as assert } from 'node:assert'
import { describe, it, before, after } from 'node:test'
import path from 'node:path'
import fs from 'fs-extra'
import { fileURLToPath } from 'node:url'
import { isoDate, loadCalendar, loadRoutes, loadStops, loadTrips, routeName, type Reference } from '../lib/gtfs/read.ts'
import { buildStopTimesIndex, writeStopTimes } from '../lib/gtfs/stop-times.ts'
import { writeStops } from '../lib/gtfs/stops.ts'
import { writeShapes } from '../lib/gtfs/shapes.ts'
import { buildSchemas } from '../lib/schemas.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const ALNUM = path.join(here, 'resources/alnum')
const MIDNIGHT = path.join(here, 'resources/midnight')
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
  calendar: await loadCalendar(dir)
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
    assert.deepEqual(tripEnds.get('TRIP-A1'), { origin: 'Gare routière', destination: 'Plage du Lido' })
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
    assert.equal(rows.find(r => r.stop_id === 'STOP_A12')?.route_color, '#FF0000')
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
  })
})

describe('schémas de sortie', () => {
  const schemas = buildSchemas()

  it('type les identifiants en chaîne, jamais en entier', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      for (const property of schema) {
        if (/(^|_)id$|parent_station/.test(property.key)) {
          assert.equal(property.type, 'string', `${name}.${property.key} doit être une chaîne`)
        }
      }
    }
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
    assert.equal(byKey.route_color['x-refersTo'], 'https://schema.org/color')
  })

  it("n'ajoute les concepts privés que s'ils sont configurés", () => {
    const base = Object.fromEntries(buildSchemas().stops.map(p => [p.key, p]))
    assert.equal(base.stop_id['x-refersTo'], undefined)
    const custom = buildSchemas({ stopConcept: 'arret', routeConcept: 'ligne-de-bus' })
    const byKey = Object.fromEntries(custom.stops.map(p => [p.key, p]))
    assert.equal(byKey.stop_id['x-refersTo'], 'arret')
    assert.equal(byKey.routes['x-refersTo'], 'ligne-de-bus')
    // le même concept d'arrêt doit être posé dans les horaires : c'est ce qui rend les deux jeux joignables
    const stopTimes = Object.fromEntries(custom['stop-times'].map(p => [p.key, p]))
    assert.equal(stopTimes.stop_id['x-refersTo'], 'arret')
  })
})
