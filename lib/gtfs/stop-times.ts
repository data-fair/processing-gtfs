import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import fs from 'fs-extra'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { stringify } from 'csv'
import { iterCsv, requireFile, routeName, type Reference } from './read.ts'

export interface TripEnds {
  origin: string
  destination: string
}

export interface StopTimesIndex {
  /** first and last stop name of each trip, used as origin / destination */
  tripEnds: Map<string, TripEnds>
  /** distinct route names serving each stop, only collected when the stops dataset is wanted */
  stopRoutes?: Map<string, Set<string>>
}

/**
 * First pass over stop_times.txt.
 *
 * Origin and destination of a trip are only known once all its rows have been seen, so
 * they cannot be resolved while writing. This pass keeps one small entry per trip rather
 * than the whole table, which is what makes the file streamable at any size.
 */
export const buildStopTimesIndex = async (
  dir: string,
  ref: Reference,
  options: { collectStopRoutes: boolean },
  log: LogFunctions
): Promise<StopTimesIndex> => {
  const file = requireFile(dir, 'stop_times.txt', 'les horaires')
  await log.info('Indexation de stop_times.txt')

  const bounds = new Map<string, { minSeq: number, maxSeq: number, origin: string, destination: string }>()
  const stopRoutes = options.collectStopRoutes ? new Map<string, Set<string>>() : undefined

  let index = 0
  for await (const line of iterCsv(file)) {
    const seq = Number(line.stop_sequence)
    const order = Number.isFinite(seq) ? seq : index
    index++

    const current = bounds.get(line.trip_id)
    if (!current) {
      bounds.set(line.trip_id, { minSeq: order, maxSeq: order, origin: line.stop_id, destination: line.stop_id })
    } else {
      if (order < current.minSeq) { current.minSeq = order; current.origin = line.stop_id }
      if (order > current.maxSeq) { current.maxSeq = order; current.destination = line.stop_id }
    }

    if (stopRoutes) {
      const trip = ref.trips.get(line.trip_id)
      const name = routeName(trip && ref.routes.get(trip.route_id))
      if (name) {
        let names = stopRoutes.get(line.stop_id)
        if (!names) { names = new Set(); stopRoutes.set(line.stop_id, names) }
        names.add(name)
      }
    }
  }

  const tripEnds = new Map<string, TripEnds>()
  for (const [tripId, b] of bounds) {
    tripEnds.set(tripId, {
      origin: ref.stops.get(b.origin)?.stop_name ?? '',
      destination: ref.stops.get(b.destination)?.stop_name ?? ''
    })
  }

  return { tripEnds, stopRoutes }
}

/** Second pass: write the denormalised table. */
export const writeStopTimes = async (
  dir: string,
  ref: Reference,
  tripEnds: Map<string, TripEnds>,
  outFile: string,
  log: LogFunctions
) => {
  const file = requireFile(dir, 'stop_times.txt', 'les horaires')
  await log.info('Écriture de stop_times.csv')

  async function * rows () {
    for await (const line of iterCsv(file)) {
      const trip = ref.trips.get(line.trip_id)
      const route = trip ? ref.routes.get(trip.route_id) : undefined
      const dates = trip ? ref.calendar.get(trip.service_id) : undefined
      const stop = ref.stops.get(line.stop_id)
      const ends = tripEnds.get(line.trip_id)
      yield {
        trip_id: line.trip_id,
        // times may exceed 24:00:00 (25:30:00 is 1.30am the next day) for services
        // running past midnight: they are not clock times and must stay strings
        arrival_time: line.arrival_time ?? '',
        departure_time: line.departure_time ?? '',
        stop_id: line.stop_id,
        stop_name: stop?.stop_name ?? '',
        stop_sequence: line.stop_sequence ?? '',
        stop_origin: ends?.origin ?? '',
        stop_destination: ends?.destination ?? '',
        route_name: routeName(route),
        route_color: route?.route_color ?? '',
        week: dates?.week ?? '',
        start_date: dates?.start_date ?? '',
        end_date: dates?.end_date ?? '',
        stop_lat: stop?.stop_lat ?? '',
        stop_lng: stop?.stop_lng ?? '',
        location_type: stop?.location_type ?? '',
        wheelchair_boarding: stop?.wheelchair_boarding ?? '',
        pickup_type: line.pickup_type ?? '',
        drop_off_type: line.drop_off_type ?? ''
      }
    }
  }

  await pipeline(
    Readable.from(rows()),
    stringify({ header: true, quoted_string: true }),
    fs.createWriteStream(outFile, { encoding: 'utf8' })
  )
}
