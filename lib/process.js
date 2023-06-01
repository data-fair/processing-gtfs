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
  if (fs.existsSync(path.join(tmpDir, 'shapes.txt'))) {
    await log.info('Conversion du fichier shapes.txt en shapes.geojson')
    const readStreamShapes = await fs.createReadStream(path.join(tmpDir, 'shapes.txt'), { encoding: 'utf8' })
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
            const shape = {
              shape_id: line[0],
              lat: line[1],
              lng: line[2],
              shape_pt_sequence: line[3],
              shape_dist_traveled: line[4] ? line[4] : ''
            }
            shapes.push(shape)
            next()
          }
        }
      })

    )
    const geojsonShapes = await GeoJSON.parse(shapes, { Point: ['lat', 'lng'] })
    await writeStreamShapes.write(JSON.stringify(geojsonShapes, null, 2))
    await log.info('Conversion terminée.')
  }
}
