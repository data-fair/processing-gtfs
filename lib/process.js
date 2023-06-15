const { stringify } = require('csv-stringify')
const byline = require('byline')
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
    const readStreamCalendar = await fs.createReadStream(path.join(tmpDir, 'calendar.txt'), { encoding: 'utf8' })
    let serviceIdIndex, mondayIndex, tuesdayIndex, wednesdayIndex, thursdayIndex, fridayIndex, saturdayIndex, sundayIndex, startDateIndex, endDateIndex
    await pump(
      byline.createStream(readStreamCalendar),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          line = line.split(',')
          const calendarDay = function (index, day) {
            if (line[index] === '1') {
              return day
            } else {
              return null
            }
          }
          if (line[0] === 'service_id') {
            serviceIdIndex = line.indexOf('service_id')
            mondayIndex = line.indexOf('monday')
            tuesdayIndex = line.indexOf('tuesday')
            wednesdayIndex = line.indexOf('wednesday')
            thursdayIndex = line.indexOf('thursday')
            fridayIndex = line.indexOf('friday')
            saturdayIndex = line.indexOf('saturday')
            sundayIndex = line.indexOf('sunday')
            startDateIndex = line.indexOf('start_date')
            endDateIndex = line.indexOf('end_date')
            next(null, null)
          } else {
            calendar.push({
              service_id: line[serviceIdIndex],
              week: [calendarDay(mondayIndex, 'Lundi'), calendarDay(tuesdayIndex, 'Mardi'), calendarDay(wednesdayIndex, 'Mercredi'), calendarDay(thursdayIndex, 'Jeudi'), calendarDay(fridayIndex, 'Vendredi'), calendarDay(saturdayIndex, 'Samedi'), calendarDay(sundayIndex, 'Dimanche')].filter(day => day !== null).join(';'),
              start_date: line[startDateIndex].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
              end_date: line[endDateIndex].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
            })
            next(null, null)
          }
        }
      })
    )
  }
  const calendarDates = []
  if (fs.existsSync(path.join(tmpDir, 'calendar_dates.txt'))) {
    const readStreamCalendarDates = await fs.createReadStream(path.join(tmpDir, 'calendar_dates.txt'), { encoding: 'utf8' })
    let serviceIdIndex, dateIndex, exceptionTypeIndex
    await pump(
      byline.createStream(readStreamCalendarDates),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          line = line.split(',')
          if (line[0] === 'service_id') {
            serviceIdIndex = line.indexOf('service_id')
            dateIndex = line.indexOf('date')
            exceptionTypeIndex = line.indexOf('exception_type')
            next(null, null)
          } else {
            calendarDates.push({
              service_id: line[serviceIdIndex],
              date: line[dateIndex].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
              exception_type: line[exceptionTypeIndex]
            })
            next(null, null)
          }
        }
      })
    )
  }
  const trips = []
  if (fs.existsSync(path.join(tmpDir, 'trips.txt'))) {
    const readStreamTrips = await fs.createReadStream(path.join(tmpDir, 'trips.txt'), { encoding: 'utf8' })
    let shapeIndex, serviceIndex, routeIndex, tripIndex, tripHeadsignIndex, directionIndex, wheelchairIndex, bikesIndex
    await pump(
      byline.createStream(readStreamTrips),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          line = line.split(',')
          if (line[0] === 'route_id') {
            shapeIndex = line.indexOf('shape_id')
            serviceIndex = line.indexOf('service_id')
            routeIndex = line.indexOf('route_id')
            tripIndex = line.indexOf('trip_id')
            tripHeadsignIndex = line.indexOf('trip_headsign')
            directionIndex = line.indexOf('direction_id')
            wheelchairIndex = line.indexOf('wheelchair_accessible')
            bikesIndex = line.indexOf('bikes_allowed')
            next(null, null)
          } else {
            trips.push({
              shape_id: line[shapeIndex],
              service_id: line[serviceIndex],
              route_id: line[routeIndex],
              trip_id: line[tripIndex],
              trip_headsign: line[tripHeadsignIndex],
              direction_id: line[directionIndex],
              wheelchair_boarding: line[wheelchairIndex] ? line[wheelchairIndex] : '',
              bikes_allowed: line[bikesIndex] ? line[bikesIndex] : ''
            })
            next()
          }
        }
      })
    )
  }
  const readStreamStops = await fs.createReadStream(path.join(tmpDir, 'stops.txt'), { encoding: 'utf8' })
  const stops = []
  let stopIndex, stopCodeIndex, stopNameIndex, stopDescIndex, latIndex, lngIndex, zoneIndex, stopUrlIndex, locationTypeIndex, parentStationIndex, stopTimezoneIndex, wheelchairBoardingIndex
  await pump(
    byline.createStream(readStreamStops),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        line = line.split(',')
        if (line[0] === 'stop_id') {
          stopIndex = line.indexOf('stop_id')
          stopCodeIndex = line.indexOf('stop_code')
          stopNameIndex = line.indexOf('stop_name')
          stopDescIndex = line.indexOf('stop_desc')
          latIndex = line.indexOf('stop_lat')
          lngIndex = line.indexOf('stop_lon')
          zoneIndex = line.indexOf('zone_id')
          stopUrlIndex = line.indexOf('stop_url')
          locationTypeIndex = line.indexOf('location_type')
          parentStationIndex = line.indexOf('parent_station')
          stopTimezoneIndex = line.indexOf('stop_timezone')
          wheelchairBoardingIndex = line.indexOf('wheelchair_boarding')
          next(null, null)
        } else {
          const stop = {
            stop_id: line[stopIndex],
            stop_code: line[stopCodeIndex] ? line[stopCodeIndex] : '',
            stop_name: line[stopNameIndex],
            stop_desc: line[stopDescIndex] ? line[stopDescIndex] : '',
            lat: line[latIndex],
            lng: line[lngIndex],
            zone_id: line[zoneIndex] ? line[zoneIndex] : '',
            stop_url: line[stopUrlIndex] ? line[stopUrlIndex] : '',
            routes: '',
            location_type: line[locationTypeIndex] ? line[locationTypeIndex] : '',
            parent_station: line[parentStationIndex] ? line[parentStationIndex] : '',
            stop_timezone: line[stopTimezoneIndex] ? line[stopTimezoneIndex] : '',
            wheelchair_boarding: line[wheelchairBoardingIndex] ? line[wheelchairBoardingIndex] : ''
          }
          stops.push(stop)
          next()
        }
      }
    })
  )
  const readStream = await fs.createReadStream(path.join(tmpDir, 'stop_times.txt'), { encoding: 'utf8' })
  const writeStream = await fs.createWriteStream(path.join(tmpDir, 'stop_times.csv'), { encoding: 'utf8' })
  let tripIndex, arrivalIndex, departureIndex, stopTripsIndex, stopSequenceIndex, stopHeadsignIndex, pickupTypeIndex, dropOffTypeIndex
  const stringifier = await stringify({
    delimiter: ','
  })
  const stopTimes = []
  await pump(
    byline.createStream(readStream),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        line = line.split(',')
        let trip
        let dates
        let stop
        if (line[0] === 'trip_id') {
          tripIndex = line.indexOf('trip_id')
          arrivalIndex = line.indexOf('arrival_time')
          departureIndex = line.indexOf('departure_time')
          stopTripsIndex = line.indexOf('stop_id')
          stopSequenceIndex = line.indexOf('stop_sequence')
          stopHeadsignIndex = line.indexOf('stop_headsign')
          pickupTypeIndex = line.indexOf('pickup_type')
          dropOffTypeIndex = line.indexOf('drop_off_type')
        } else {
          const index = stopTimes.findIndex(stopTime => stopTime.stop_id === line[stopTripsIndex])
          if (index === -1) {
            stopTimes.push({
              stop_id: line[stopTripsIndex],
              trip_ids: [line[tripIndex]]
            })
          } else {
            stopTimes[index].trip_ids.push(line[tripIndex])
          }
          trip = trips.find(trip => trip.trip_id === line[tripIndex])
          const service_id = trip ? trip.service_id : 'service_id'
          dates = calendar.find(calendar => calendar.service_id === service_id)
          stop = stops.find(stop => stop.stop_id === line[stopTripsIndex])
          if (line[stopHeadsignIndex] === '') {
            if (trip.trip_headsign.includes(' - ')) {
              if (trip.trip_direction_id === '0') {
                line[stopHeadsignIndex] = trip.trip_headsign.split(' - ')[0]
              } else {
                line[stopHeadsignIndex] = trip.trip_headsign.split(' - ')[1]
              }
            } else {
              line[stopHeadsignIndex] = trip.trip_headsign
            }
          }
        }
        const item = {
          trip_id: line[tripIndex],
          arrival_time: line[arrivalIndex],
          departure_time: line[departureIndex],
          stop_id: line[stopTripsIndex],
          stop_name: stop ? stop.stop_name : 'stop_name',
          route_id: trip ? trip.route_id : 'route_id',
          stop_sequence: line[stopSequenceIndex],
          stop_headsign: line[stopHeadsignIndex] ? line[stopHeadsignIndex] : '',
          stop_lat: stop ? stop.lat : 'stop_lat',
          stop_lng: stop ? stop.lng : 'stop_lng',
          location_type: stop ? stop.location_type : 'location_type',
          wheelchair_boarding: stop ? stop.wheelchair_boarding : 'wheelchair_boarding',
          week: dates ? dates.week : 'week',
          start_date: dates ? dates.start_date : 'start_date',
          end_date: dates ? dates.end_date : 'end_date',
          pickup_type: line[pickupTypeIndex] ? line[pickupTypeIndex] : '',
          drop_off_type: line[dropOffTypeIndex] ? line[dropOffTypeIndex] : ''
        }
        next(null, item)
      }
    }),
    stringifier,
    writeStream
  )
  await log.info('Conversion terminée.')
  await log.info('Conversion du fichier stops.txt en stops.geojson')
  const stopRoutes = []
  stopTimes.forEach(stopTime => {
    stopRoutes.push({
      stop_id: stopTime.stop_id,
      trip_ids: stopTime.trip_ids,
      route_id: []
    })
    stopTime.trip_ids.forEach(trip_id => {
      const trip = trips.find(trip => trip.trip_id === trip_id)
      if (!stopRoutes[stopRoutes.length - 1].route_id.includes(trip.route_id)) {
        stopRoutes[stopRoutes.length - 1].route_id.push(trip.route_id)
      }
    })
  })
  const writeStreamStops = await fs.createWriteStream(path.join(tmpDir, 'stops.geojson'), { encoding: 'utf8' })
  stops.forEach(stop => {
    const index = stopRoutes.findIndex(stopRoute => stopRoute.stop_id === stop.stop_id)
    if (index !== -1) {
      stop.routes = stopRoutes[index].route_id.join(';')
    }
  })
  const geojsonStops = await GeoJSON.parse(stops, { Point: ['lat', 'lng'] })
  await writeStreamStops.write(JSON.stringify(geojsonStops, null, 2))
  await log.info('Conversion terminée.')
  const routes = []
  if (fs.existsSync(path.join(tmpDir, 'shapes.txt'))) {
    await log.info('Conversion du fichier shapes.txt en shapes.geojson')
    const readStreamShapes = await fs.createReadStream(path.join(tmpDir, 'shapes.txt'), { encoding: 'utf8' })
    if (fs.existsSync(path.join(tmpDir, 'routes.txt'))) {
      const readStreamRoutes = await fs.createReadStream(path.join(tmpDir, 'routes.txt'), { encoding: 'utf8' })
      let routeIndex, shortNameIndex, longNameIndex, descIndex, typeIndex, colorIndex
      await pump(
        byline.createStream(readStreamRoutes),
        new stream.Transform({
          objectMode: true,
          transform: (line, _, next) => {
            line = line.split(',')
            if (line[0] === 'route_id') {
              routeIndex = line.indexOf('route_id')
              shortNameIndex = line.indexOf('route_short_name')
              longNameIndex = line.indexOf('route_long_name')
              descIndex = line.indexOf('route_desc')
              typeIndex = line.indexOf('route_type')
              colorIndex = line.indexOf('route_color')
              next(null, null)
            } else {
              const route = {
                route_id: line[routeIndex],
                route_short_name: line[shortNameIndex],
                route_long_name: line[longNameIndex],
                route_desc: line[descIndex] ? line[descIndex] : '',
                route_type: line[typeIndex],
                route_color: line[colorIndex] ? `#${line[colorIndex]}` : ''
              }
              routes.push(route)
              next()
            }
          }
        })
      )
    }
    const writeStreamShapes = await fs.createWriteStream(path.join(tmpDir, 'shapes.geojson'), { encoding: 'utf8' })
    const shapes = []
    let shapeIndex, latIndex, lngIndex, shapePtSequenceIndex
    await pump(
      byline.createStream(readStreamShapes),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          line = line.split(',')
          if (line[0] === 'shape_id') {
            shapeIndex = line.indexOf('shape_id')
            latIndex = line.indexOf('shape_pt_lat')
            lngIndex = line.indexOf('shape_pt_lon')
            shapePtSequenceIndex = line.indexOf('shape_pt_sequence')
            next(null, null)
          } else {
            const index = shapes.findIndex(shape => shape.shape_id === line[0])
            if (index === -1) {
              shapes.push({
                shape_id: line[shapeIndex],
                coordinates: [
                  [parseFloat(line[lngIndex]), parseFloat(line[latIndex]), line[shapePtSequenceIndex]]
                ]
              })
            } else {
              shapes[index].coordinates.push([parseFloat(line[lngIndex]), parseFloat(line[latIndex])])
            }
            next()
          }
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
