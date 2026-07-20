import path from 'node:path'
import fs from 'fs-extra'
import { parse } from 'csv'

export const gtfsPath = (dir: string, name: string) => path.join(dir, name)

export const hasFile = (dir: string, name: string) => fs.existsSync(gtfsPath(dir, name))

export const requireFile = (dir: string, name: string, reason: string) => {
  const file = gtfsPath(dir, name)
  if (!fs.existsSync(file)) {
    throw new Error(`Le fichier ${name} est absent de l'archive GTFS, il est nécessaire pour produire ${reason}.`)
  }
  return file
}

export type GtfsRow = Record<string, string>

/**
 * Stream a GTFS table. `bom: true` matters: a fair share of feeds ship their .txt
 * with a UTF-8 BOM, which otherwise ends up glued to the first column name.
 */
export async function * iterCsv (file: string): AsyncGenerator<GtfsRow> {
  const parser = fs.createReadStream(file, { encoding: 'utf8' })
    .pipe(parse({ columns: true, delimiter: ',', bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }))
  for await (const row of parser) yield row as GtfsRow
}

export const loadCsv = async (file: string): Promise<GtfsRow[]> => {
  const rows: GtfsRow[] = []
  for await (const row of iterCsv(file)) rows.push(row)
  return rows
}

export interface RouteRef {
  route_id: string
  route_short_name: string
  route_long_name: string
  route_desc: string
  route_type: string
  route_color: string
}

export interface StopRef {
  stop_id: string
  stop_code: string
  stop_name: string
  stop_desc: string
  stop_lat: string
  stop_lng: string
  zone_id: string
  stop_url: string
  location_type: string
  parent_station: string
  stop_timezone: string
  wheelchair_boarding: string
}

export interface TripRef {
  trip_id: string
  route_id: string
  service_id: string
  shape_id: string
  direction_id: string
  wheelchair_boarding: string
  bikes_allowed: string
}

export interface CalendarRef {
  week: string
  start_date: string
  end_date: string
}

export interface Reference {
  routes: Map<string, RouteRef>
  stops: Map<string, StopRef>
  trips: Map<string, TripRef>
  calendar: Map<string, CalendarRef>
}

const WEEK_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

/** GTFS dates are YYYYMMDD; data-fair wants ISO to type the column as a date. */
export const isoDate = (value: string) => (value ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')

/**
 * Parse a coordinate, treating a missing value as missing.
 * Number('') is 0, so a naive check lands every unpositioned stop on Null Island.
 */
export const toCoordinate = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

/** The display name of a route, short name preferred, as the GTFS spec recommends. */
export const routeName = (route?: RouteRef) => route ? (route.route_short_name || route.route_long_name) : ''

export const loadRoutes = async (dir: string): Promise<Map<string, RouteRef>> => {
  const file = requireFile(dir, 'routes.txt', 'les lignes')
  const routes = new Map<string, RouteRef>()
  for await (const line of iterCsv(file)) {
    routes.set(line.route_id, {
      route_id: line.route_id,
      route_short_name: line.route_short_name ?? '',
      route_long_name: line.route_long_name ?? '',
      route_desc: line.route_desc ?? '',
      route_type: line.route_type ?? '',
      route_color: line.route_color ? `#${line.route_color}` : ''
    })
  }
  return routes
}

export const loadStops = async (dir: string): Promise<Map<string, StopRef>> => {
  const file = requireFile(dir, 'stops.txt', 'les arrêts')
  const stops = new Map<string, StopRef>()
  for await (const line of iterCsv(file)) {
    stops.set(line.stop_id, {
      stop_id: line.stop_id,
      stop_code: line.stop_code ?? '',
      stop_name: line.stop_name ?? '',
      stop_desc: line.stop_desc ?? '',
      stop_lat: line.stop_lat ?? '',
      stop_lng: line.stop_lon ?? '',
      zone_id: line.zone_id ?? '',
      stop_url: line.stop_url ?? '',
      location_type: line.location_type ?? '',
      parent_station: line.parent_station ?? '',
      stop_timezone: line.stop_timezone ?? '',
      wheelchair_boarding: line.wheelchair_boarding ?? ''
    })
  }
  return stops
}

export const loadTrips = async (dir: string): Promise<Map<string, TripRef>> => {
  if (!hasFile(dir, 'trips.txt')) return new Map()
  const trips = new Map<string, TripRef>()
  for await (const line of iterCsv(gtfsPath(dir, 'trips.txt'))) {
    trips.set(line.trip_id, {
      trip_id: line.trip_id,
      route_id: line.route_id ?? '',
      service_id: line.service_id ?? '',
      shape_id: line.shape_id ?? '',
      direction_id: line.direction_id ?? '',
      wheelchair_boarding: line.wheelchair_accessible ?? '',
      bikes_allowed: line.bikes_allowed ?? ''
    })
  }
  return trips
}

export const loadCalendar = async (dir: string): Promise<Map<string, CalendarRef>> => {
  if (!hasFile(dir, 'calendar.txt')) return new Map()
  const calendar = new Map<string, CalendarRef>()
  for await (const line of iterCsv(gtfsPath(dir, 'calendar.txt'))) {
    const days = [line.monday, line.tuesday, line.wednesday, line.thursday, line.friday, line.saturday, line.sunday]
    calendar.set(line.service_id, {
      week: days.map((day, i) => day === '1' ? WEEK_DAYS[i] : null).filter(Boolean).join(';'),
      start_date: isoDate(line.start_date),
      end_date: isoDate(line.end_date)
    })
  }
  return calendar
}
