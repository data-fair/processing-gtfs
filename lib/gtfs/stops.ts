import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import { toCoordinate, type Reference } from './read.ts'
import { writeFeatureCollection, type Feature } from './geojson.ts'

export const writeStops = async (
  ref: Reference,
  stopRoutes: Map<string, Set<string>> | undefined,
  outFile: string,
  log: LogFunctions
) => {
  await log.info('Écriture de stops.geojson')

  let skipped = 0
  function * features (): Generator<Feature> {
    for (const stop of ref.stops.values()) {
      const lat = toCoordinate(stop.stop_lat)
      const lng = toCoordinate(stop.stop_lng)
      // stations and generic nodes may legitimately carry no coordinates
      if (lat === undefined || lng === undefined) { skipped++; continue }
      yield {
        type: 'Feature',
        properties: {
          stop_id: stop.stop_id,
          stop_code: stop.stop_code,
          stop_name: stop.stop_name,
          stop_desc: stop.stop_desc,
          zone_id: stop.zone_id,
          stop_url: stop.stop_url,
          routes: [...(stopRoutes?.get(stop.stop_id) ?? [])].join(';'),
          location_type: stop.location_type,
          parent_station: stop.parent_station,
          stop_timezone: stop.stop_timezone,
          wheelchair_boarding: stop.wheelchair_boarding
        },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      }
    }
  }

  await writeFeatureCollection(outFile, features())
  if (skipped) await log.warning(`${skipped} arrêts sans coordonnées ont été ignorés.`)
}
