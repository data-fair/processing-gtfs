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
  const readStream = await fs.createReadStream(path.join(tmpDir, 'stop_times.txt'), { encoding: 'utf8' })
  const writeStream = await fs.createWriteStream(path.join(tmpDir, 'stop_times.csv'), { encoding: 'utf8' })
  const stringifier = await stringify({
    delimiter: ','
  })
  await pump(
    byline.createStream(readStream),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        line = line.split(',')
        const stopTime = {
          trip_id: line[0],
          arrival_time: line[1],
          departure_time: line[2],
          stop_id: line[3],
          stop_sequence: line[4],
          stop_headsign: line[5] ? line[5] : '',
          pickup_type: line[6] ? line[6] : '',
          drop_off_type: line[7] ? line[7] : '',
          shape_dist_traveled: line[8] ? line[8] : ''
        }
        next(null, stopTime)
      }
    }),
    stringifier,
    writeStream
  )
  await log.info('Conversion terminée.')
  await log.info('Conversion du fichier stops.txt en stops.geojson')
  const readStreamStops = await fs.createReadStream(path.join(tmpDir, 'stops.txt'), { encoding: 'utf8' })
  const writeStreamStops = await fs.createWriteStream(path.join(tmpDir, 'stops.geojson'), { encoding: 'utf8' })
  const stops = []
  await pump(
    byline.createStream(readStreamStops),
    new stream.Transform({
      objectMode: true,
      transform: (line, _, next) => {
        line = line.split(',')
        if (line[0] === 'stop_id') {
          next(null, null)
        } else {
          const stop = {
            stop_id: line[0],
            stop_code: line[1] ? line[1] : '',
            stop_name: line[2],
            stop_desc: line[3] ? line[3] : '',
            lat: line[4],
            lng: line[5],
            zone_id: line[6] ? line[6] : '',
            stop_url: line[7] ? line[7] : '',
            location_type: line[8] ? line[8] : '',
            parent_station: line[9] ? line[9] : '',
            stop_timezone: line[10] ? line[10] : '',
            wheelchair_boarding: line[11] ? line[11] : ''
          }
          stops.push(stop)
          next()
        }
      }
    })

  )
  const geojsonStops = await GeoJSON.parse(stops, { Point: ['lat', 'lng'] })
  await writeStreamStops.write(JSON.stringify(geojsonStops, null, 2))
  await log.info('Conversion terminée.')
  const trips = []
  const routes = []
  if (fs.existsSync(path.join(tmpDir, 'shapes.txt'))) {
    await log.info('Conversion du fichier shapes.txt en shapes.geojson')
    const readStreamShapes = await fs.createReadStream(path.join(tmpDir, 'shapes.txt'), { encoding: 'utf8' })
    if (fs.existsSync(path.join(tmpDir, 'trips.txt'))) {
      const readStreamTrips = await fs.createReadStream(path.join(tmpDir, 'trips.txt'), { encoding: 'utf8' })
      await pump(
        byline.createStream(readStreamTrips),
        new stream.Transform({
          objectMode: true,
          transform: (line, _, next) => {
            line = line.split(',')
            if (line[0] === 'route_id') {
              next(null, null)
            } else {
              const index = trips.findIndex(trip => trip.shape_id === line[7])
              if (index === -1) {
                trips.push({
                  shape_id: line[7],
                  route_id: line[0],
                  wheelchair_boarding: line[8] ? line[8] : ''
                })
              }
              next()
            }
          }
        })
      )
    }
    if (fs.existsSync(path.join(tmpDir, 'routes.txt'))) {
      const readStreamRoutes = await fs.createReadStream(path.join(tmpDir, 'routes.txt'), { encoding: 'utf8' })
      await pump(
        byline.createStream(readStreamRoutes),
        new stream.Transform({
          objectMode: true,
          transform: (line, _, next) => {
            line = line.split(',')
            if (line[0] === 'route_id') {
              next(null, null)
            } else {
              const route = {
                route_id: line[0],
                route_short_name: line[2],
                route_long_name: line[3],
                route_desc: line[4] ? line[4] : '',
                route_type: line[5],
                route_color: line[7] ? line[7] : ''
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
    await pump(
      byline.createStream(readStreamShapes),
      new stream.Transform({
        objectMode: true,
        transform: (line, _, next) => {
          line = line.split(',')
          if (line[0] === 'shape_id') {
            next(null, null)
          } else {
            const index = shapes.findIndex(shape => shape.shape_id === line[0])
            if (index === -1) {
              shapes.push({
                shape_id: line[0],
                coordinates: [
                  [parseFloat(line[2]), parseFloat(line[1]), line[3]]
                ]
              })
            } else {
              shapes[index].coordinates.push([parseFloat(line[2]), parseFloat(line[1])])
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
        const route_id = trips.find(trip => trip.shape_id === shape.shape_id).route_id
        const wheelchair_boarding = trips.find(trip => trip.shape_id === shape.shape_id).wheelchair_boarding
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
            wheelchair_boarding
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
