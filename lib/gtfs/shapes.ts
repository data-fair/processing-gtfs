import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import { iterCsv, requireFile, toCoordinate, type Reference } from './read.ts'
import { writeFeatureCollection, type Feature } from './geojson.ts'

interface ShapePoint {
  lng: number
  lat: number
  seq: number
}

export const writeShapes = async (
  dir: string,
  ref: Reference,
  outFile: string,
  log: LogFunctions
) => {
  const file = requireFile(dir, 'shapes.txt', 'les tracés')
  await log.info('Écriture de shapes.geojson')

  const shapes = new Map<string, ShapePoint[]>()
  let index = 0
  for await (const line of iterCsv(file)) {
    const lng = toCoordinate(line.shape_pt_lon)
    const lat = toCoordinate(line.shape_pt_lat)
    if (lat === undefined || lng === undefined) continue
    const seq = Number(line.shape_pt_sequence)
    let points = shapes.get(line.shape_id)
    if (!points) { points = []; shapes.set(line.shape_id, points) }
    // every point carries its sequence: sorting on a sequence only present on the
    // first point of each shape silently leaves the geometry in file order
    points.push({ lng, lat, seq: Number.isFinite(seq) ? seq : index })
    index++
  }

  // a shape describes the path of one or more trips; any of them tells us the route
  const tripByShape = new Map<string, string>()
  for (const trip of ref.trips.values()) {
    if (trip.shape_id && !tripByShape.has(trip.shape_id)) tripByShape.set(trip.shape_id, trip.trip_id)
  }

  let orphans = 0
  function * features (): Generator<Feature> {
    for (const [shapeId, points] of shapes) {
      if (points.length < 2) continue
      points.sort((a, b) => a.seq - b.seq)
      const trip = ref.trips.get(tripByShape.get(shapeId) ?? '')
      const route = trip ? ref.routes.get(trip.route_id) : undefined
      if (!route) orphans++
      yield {
        type: 'Feature',
        properties: {
          shape_id: shapeId,
          route_id: trip?.route_id ?? '',
          route_short_name: route?.route_short_name ?? '',
          route_long_name: route?.route_long_name ?? '',
          route_desc: route?.route_desc ?? '',
          route_type: route?.route_type ?? '',
          route_color: route?.route_color ?? '',
          wheelchair_boarding: trip?.wheelchair_boarding ?? '',
          bikes_allowed: trip?.bikes_allowed ?? ''
        },
        geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) }
      }
    }
  }

  await writeFeatureCollection(outFile, features())
  if (orphans) await log.warning(`${orphans} tracés ne sont rattachés à aucune ligne.`)
}
