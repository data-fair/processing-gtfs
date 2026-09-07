import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
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

/** One service window of frequencies.txt, in seconds since the start of the service day. */
export interface FrequencyRef {
  start: number
  end: number
  headway: number
  exactTimes: boolean
}

export interface Reference {
  routes: Map<string, RouteRef>
  stops: Map<string, StopRef>
  trips: Map<string, TripRef>
  calendar: Map<string, CalendarRef>
  frequencies: Map<string, FrequencyRef[]>
}

const WEEK_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

/** GTFS dates are YYYYMMDD; data-fair wants ISO to type the column as a date. */
export const isoDate = (value: string) => (value ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')

/** Which day of the week a YYYYMMDD date falls on, Monday first to match WEEK_DAYS. */
export const weekDayIndex = (value: string): number | undefined => {
  const parts = /^(\d{4})(\d{2})(\d{2})$/.exec(value ?? '')
  if (!parts) return undefined
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  if (Number.isNaN(date.getTime())) return undefined
  return (date.getUTCDay() + 6) % 7
}

/**
 * GTFS times are H:MM:SS counted from the start of the service day, so 25:30:00 is
 * 1.30am the next day. Seconds are the only form arithmetic can be done in.
 */
export const parseGtfsTime = (value: string | undefined): number | undefined => {
  const parts = /^(\d+):([0-5]\d):([0-5]\d)$/.exec((value ?? '').trim())
  if (!parts) return undefined
  return Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3])
}

/** Back to H:MM:SS, keeping hours past 24 rather than wrapping them to the next day. */
export const formatGtfsTime = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : ''
  const abs = Math.abs(Math.round(seconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}:${pad(abs % 60)}`
}

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

interface ServiceSpan {
  days: Set<number>
  /** raw YYYYMMDD, which compares correctly as a string */
  start?: string
  end?: string
}

/**
 * Days of operation and validity span of every service.
 *
 * calendar.txt is optional in the standard: a feed may define all of its services
 * through calendar_dates.txt alone, and reading calendar.txt only left those with an
 * empty week and no validity dates. An added date (exception_type 1) therefore brings
 * in its own weekday and widens the span. A removed date (exception_type 2) is a
 * single-day hole: it neither drops the weekday nor shortens the service, so a feed
 * that cancels one Monday for a holiday still reads as running on Mondays.
 */
export const loadCalendar = async (dir: string, log?: LogFunctions): Promise<Map<string, CalendarRef>> => {
  const spans = new Map<string, ServiceSpan>()
  const spanOf = (serviceId: string) => {
    let span = spans.get(serviceId)
    if (!span) { span = { days: new Set() }; spans.set(serviceId, span) }
    return span
  }
  const widen = (span: ServiceSpan, date: string) => {
    if (!/^\d{8}$/.test(date ?? '')) return
    if (!span.start || date < span.start) span.start = date
    if (!span.end || date > span.end) span.end = date
  }

  const hasCalendar = hasFile(dir, 'calendar.txt')
  if (hasCalendar) {
    for await (const line of iterCsv(gtfsPath(dir, 'calendar.txt'))) {
      const span = spanOf(line.service_id)
      const days = [line.monday, line.tuesday, line.wednesday, line.thursday, line.friday, line.saturday, line.sunday]
      days.forEach((day, i) => { if (day === '1') span.days.add(i) })
      widen(span, line.start_date)
      widen(span, line.end_date)
    }
  }

  let addedDates = 0
  const hasDates = hasFile(dir, 'calendar_dates.txt')
  if (hasDates) {
    for await (const line of iterCsv(gtfsPath(dir, 'calendar_dates.txt'))) {
      if (line.exception_type !== '1') continue
      const span = spanOf(line.service_id)
      const day = weekDayIndex(line.date)
      if (day !== undefined) span.days.add(day)
      widen(span, line.date)
      addedDates++
    }
  }

  if (!hasCalendar && !hasDates) {
    await log?.warning('Ni calendar.txt ni calendar_dates.txt : les jours de circulation et la période de validité des horaires resteront vides.')
  } else if (!hasCalendar) {
    await log?.info(`calendar.txt est absent : les jours de circulation sont déduits des ${addedDates} dates ajoutées par calendar_dates.txt.`)
  }

  const calendar = new Map<string, CalendarRef>()
  for (const [serviceId, span] of spans) {
    calendar.set(serviceId, {
      week: [...span.days].sort((a, b) => a - b).map(day => WEEK_DAYS[day]).join(';'),
      start_date: isoDate(span.start ?? ''),
      end_date: isoDate(span.end ?? '')
    })
  }
  return calendar
}

/**
 * The frequency windows of every trip that has some. A window with no usable headway
 * describes nothing and would loop forever, so it is dropped rather than expanded.
 */
export const loadFrequencies = async (dir: string): Promise<Map<string, FrequencyRef[]>> => {
  const frequencies = new Map<string, FrequencyRef[]>()
  if (!hasFile(dir, 'frequencies.txt')) return frequencies
  for await (const line of iterCsv(gtfsPath(dir, 'frequencies.txt'))) {
    const start = parseGtfsTime(line.start_time)
    const end = parseGtfsTime(line.end_time)
    const headway = Number(line.headway_secs)
    if (start === undefined || end === undefined || !Number.isFinite(headway) || headway <= 0) continue
    const windows = frequencies.get(line.trip_id) ?? []
    // exact_times 1 means the departures really are at those times, 0 that the vehicle
    // only keeps the headway
    windows.push({ start, end, headway, exactTimes: line.exact_times === '1' })
    frequencies.set(line.trip_id, windows)
  }
  return frequencies
}
