const csv = require('csv')
const fs = require('fs-extra')
const path = require('path')
const util = require('util')
const pump = util.promisify(require('pump'))
const stream = require('stream')
const GeoJSON = require('geojson')

module.exports = async (tmpDir, log) => {
  await log.step('Conversion des fichiers GTFS')
  await log.info('Conversion du fichier stop_times.txt en stop_times.csv')

  const calendar = []
  if (fs.existsSync(path.join(tmpDir, 'calendar.txt'))) {
    const readStreamCalendar = fs.createReadStream(path.join(tmpDir, 'calendar.txt'), { encoding: 'utf8' })
    await pump(
      readStreamCalendar,
      csv.parse({ columns: true, delimiter: ',' }),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          const calendarDays = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
          const days = [line.monday, line.tuesday, line.wednesday, line.thursday, line.friday, line.saturday, line.sunday]
          const formattedLine = {
            service_id: line.service_id,
            week: days.map((day, index) => day === '1' ? calendarDays[index] : null).filter(Boolean).join(';'),
            start_date: line.start_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            end_date: line.end_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
          }
          calendar.push(formattedLine)
          next()
        }
      })
    )
  }

  const calendarDates = []
  if (fs.existsSync(path.join(tmpDir, 'calendar_dates.txt'))) {
    const readStreamCalendarDates = fs.createReadStream(path.join(tmpDir, 'calendar_dates.txt'), { encoding: 'utf8' })
    await pump(
      readStreamCalendarDates,
      csv.parse({ columns: true, delimiter: ',' }),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          calendarDates.push({
            service_id: line.service_id,
            date: line.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            exception_type: line.exceptionType
          })
          next()
        }
      })
    )
  }

  const trips = []
  if (fs.existsSync(path.join(tmpDir, 'trips.txt'))) {
    const readStreamTrips = fs.createReadStream(path.join(tmpDir, 'trips.txt'), { encoding: 'utf8' })
    await pump(
      readStreamTrips,
      csv.parse({ columns: true, delimiter: ',' }),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          trips.push({
            shape_id: line.shape_id,
            service_id: line.service_id,
            route_id: line.route_id,
            trip_id: line.trip_id,
            trip_headsign: line.trip_headsign,
            direction_id: line.direction_id,
            wheelchair_boarding: line.wheelchair_accessible ? line.wheelchair_accessible : '',
            bikes_allowed: line.bikes_allowed ? line.bikes_allowed : ''
          })
          next()
        }
      })
    )
  }

  const routes = []
  const readStreamRoutes = fs.createReadStream(path.join(tmpDir, 'routes.txt'), { encoding: 'utf8' })
  await pump(
    readStreamRoutes,
    csv.parse({ columns: true, delimiter: ',' }),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        const route = {
          route_id: line.route_id,
          route_short_name: line.route_short_name,
          route_long_name: line.route_long_name,
          route_desc: line.route_desc ? line.route_desc : '',
          route_type: line.route_type,
          route_color: line.route_color ? `#${line.route_color}` : ''
        }
        routes.push(route)
        next()
      }
    })
  )

  const readStreamStops = fs.createReadStream(path.join(tmpDir, 'stops.txt'), { encoding: 'utf8' })
  const stops = []
  await pump(
    readStreamStops,
    csv.parse({ columns: true, delimiter: ',' }),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        const stop = {
          stop_id: line.stop_id,
          stop_code: line.stop_code ? line.stop_code : '',
          stop_name: line.stop_name,
          stop_desc: line.stop_desc ? line.stop_desc : '',
          lat: line.stop_lat,
          lng: line.stop_lon,
          zone_id: line.zone_id ? line.zone_id : '',
          stop_url: line.stop_url ? line.stop_url : '',
          routes: '',
          location_type: line.location_type ? line.location_type : '',
          parent_station: line.parent_station ? line.parent_station : '',
          stop_timezone: line.stop_timezone ? line.stop_timezone : '',
          wheelchair_boarding: line.wheelchair_boarding ? line.wheelchair_boarding : ''
        }
        stops.push(stop)
        next()
      }
    })
  )

  let readStream = fs.createReadStream(path.join(tmpDir, 'stop_times.txt'), { encoding: 'utf8' })
  const writeStream = await fs.createWriteStream(path.join(tmpDir, 'stop_times.csv'), { encoding: 'utf8' })
  const stopTimes = []
  const tripHeadsigns = []
  let currentTripHeadsign = []
  await pump(
    readStream,
    csv.parse({ columns: true, delimiter: ',' }),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        let origin, destination
        const index = stopTimes.findIndex(stopTime => stopTime.stop_id === line.stop_id)
        if (index === -1) {
          stopTimes.push({
            stop_id: line.stop_id,
            trip_ids: [line.trip_id]
          })
        } else {
          stopTimes[index].trip_ids.push(line.trip_id)
        }
        const indexHeadsign = currentTripHeadsign.findIndex(tripHeadsign => tripHeadsign.trip_id === line.trip_id)
        if (indexHeadsign === -1) {
          if (currentTripHeadsign.length > 0) {
            const stopOrigin = currentTripHeadsign[0].trip_sequence[0].stop_id
            const stopDestination = currentTripHeadsign[0].trip_sequence[currentTripHeadsign[0].trip_sequence.length - 1].stop_id
            origin = stops.find(stop => stop.stop_id === stopOrigin)
            destination = stops.find(stop => stop.stop_id === stopDestination)
            tripHeadsigns.push({
              trip_id: currentTripHeadsign[0].trip_id,
              origin_name: origin.stop_name,
              destination_name: destination.stop_name
            })
            currentTripHeadsign = []
          }
          currentTripHeadsign.push({
            trip_id: line.trip_id,
            trip_sequence: [
              {
                stop_id: line.stop_id,
                stop_sequence: line.stop_sequence
              }
            ]
          })
        } else {
          currentTripHeadsign[indexHeadsign].trip_sequence.push({
            stop_id: line.stop_id,
            stop_sequence: line.stop_sequence
          })
        }
        next()
      }
    })
  )
  readStream.close()
  readStream = fs.createReadStream(path.join(tmpDir, 'stop_times.txt'), { encoding: 'utf8' })
  await pump(
    readStream,
    csv.parse({ columns: true, delimiter: ',' }),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        let trip, dates, stop, origin, destination, route
        if (line[0] !== 'trip_id') {
          trip = trips.find(trip => trip.trip_id === line.trip_id)
          const service_id = trip ? trip.service_id : 'service_id'
          dates = calendar.find(calendar => calendar.service_id === service_id)
          stop = stops.find(stop => stop.stop_id === line.stop_id)
          origin = tripHeadsigns.find(tripHeadsign => tripHeadsign.trip_id === line.trip_id)
          destination = tripHeadsigns.find(tripHeadsign => tripHeadsign.trip_id === line.trip_id)
          route = routes.find(route => route.route_id === trip.route_id)
        }
        const item = {
          trip_id: line.trip_id,
          arrival_time: line.arrival_time,
          departure_time: line.departure_time,
          stop_id: line.stop_id,
          stop_name: stop ? stop.stop_name : 'stop_name',
          stop_sequence: line.stop_sequence,
          stop_origin: origin ? origin.origin_name : 'stop_origin',
          stop_destination: destination ? destination.destination_name : 'stop_destination',
          route_name: route ? route.route_short_name || route.route_long_name : 'route_name',
          week: dates ? dates.week : 'week',
          start_date: dates ? dates.start_date : 'start_date',
          end_date: dates ? dates.end_date : 'end_date',
          stop_lat: stop ? stop.lat : 'stop_lat',
          stop_lng: stop ? stop.lng : 'stop_lng',
          location_type: stop ? stop.location_type : 'location_type',
          wheelchair_boarding: stop ? stop.wheelchair_boarding : 'wheelchair_boarding',
          pickup_type: line.pickup_type ? line.pickup_type : '',
          drop_off_type: line.drop_off_type ? line.drop_off_type : ''
        }
        next(null, item)
      }
    }),
    csv.stringify({ header: true, quoted_string: true }),
    writeStream
  )
  await log.info('Conversion terminée.')
  await log.info('Conversion du fichier stops.txt en stops.geojson')
  const stopRoutes = []
  stopTimes.forEach(stopTime => {
    stopRoutes.push({
      stop_id: stopTime.stop_id,
      trip_ids: stopTime.trip_ids,
      routes_name: []
    })
    stopTime.trip_ids.forEach(trip_id => {
      const trip = trips.find(trip => trip.trip_id === trip_id)
      const route = routes.find(route => route.route_id === trip.route_id)
      if (!stopRoutes[stopRoutes.length - 1].routes_name.includes(route.route_short_name || route.route_long_name)) {
        stopRoutes[stopRoutes.length - 1].routes_name.push(route.route_short_name || route.route_long_name)
      }
    })
  })
  const writeStreamStops = await fs.createWriteStream(path.join(tmpDir, 'stops.geojson'), { encoding: 'utf8' })
  stops.forEach(stop => {
    const index = stopRoutes.findIndex(stopRoute => stopRoute.stop_id === stop.stop_id)
    if (index !== -1) {
      stop.routes = stopRoutes[index].routes_name.join(';')
    }
  })
  const geojsonStops = await GeoJSON.parse(stops, { Point: ['lat', 'lng'] })
  await writeStreamStops.write(JSON.stringify(geojsonStops, null, 2))
  await log.info('Conversion terminée.')

  if (fs.existsSync(path.join(tmpDir, 'shapes.txt'))) {
    await log.info('Conversion du fichier shapes.txt en shapes.geojson')
    const readStreamShapes = fs.createReadStream(path.join(tmpDir, 'shapes.txt'), { encoding: 'utf8' })
    const writeStreamShapes = await fs.createWriteStream(path.join(tmpDir, 'shapes.geojson'), { encoding: 'utf8' })
    const shapes = []
    await pump(
      readStreamShapes,
      csv.parse({ columns: true, delimiter: ',' }),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          const index = shapes.findIndex(shape => shape.shape_id === line.shape_id)
          if (index === -1) {
            shapes.push({
              shape_id: line.shape_id,
              coordinates: [
                [parseFloat(line.shape_pt_lon), parseFloat(line.shape_pt_lat), line.shape_pt_sequence]
              ]
            })
          } else {
            shapes[index].coordinates.push([parseFloat(line.shape_pt_lon), parseFloat(line.shape_pt_lat)])
          }
          next()
        }
      })
    )
    shapes.forEach(shape => {
      shape.coordinates = shape.coordinates.sort((a, b) => a[2] - b[2])
    })
    const geojsonShapes = []
    await shapes.forEach(shape => {
      const index = geojsonShapes.findIndex(geojsonShape => geojsonShape.shape_id === shape.shape_id)
      if (index === -1) {
        let route_id
        try {
          route_id = trips.find(trip => trip.shape_id === shape.shape_id).route_id
        } catch (error) {
          log.error(shape.shape_id)
          log.info(JSON.stringify(trips, null, 2))
          throw error
        }
        const wheelchair_boarding = trips.find(trip => trip.shape_id === shape.shape_id).wheelchair_boarding
        const bikes_allowed = trips.find(trip => trip.shape_id === shape.shape_id).bikes_allowed
        const route = routes.find(route => route.route_id === route_id)
        geojsonShapes.push({
          type: 'Feature',
          properties: {
            shape_id: shape.shape_id,
            route_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            route_desc: route.route_desc,
            route_type: route.route_type,
            route_color: route.route_color,
            wheelchair_boarding,
            bikes_allowed
          },
          geometry: {
            type: 'LineString',
            coordinates: shape.coordinates.map(coordinate => [coordinate[0], coordinate[1]])
          }
        })
      }
    })
    const finalObject = {
      type: 'FeatureCollection',
      features: geojsonShapes
    }
    await writeStreamShapes.write(JSON.stringify(finalObject, null, 2))
    await log.info('Conversion terminée.')
  }
}
