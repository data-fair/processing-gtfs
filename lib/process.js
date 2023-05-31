const { stringify } = require('csv-stringify')
const byline = require('byline')
const fs = require('fs-extra')
const path = require('path')
const util = require('util')
const pump = util.promisify(require('pump'))
const stream = require('stream')
const GeoJSON = require('geojson')
module.exports = async (tmpDir, log) => {
  await log.step('Conversion du fichier stop_times.txt en stop_times.csv')
  const readStream = fs.createReadStream(path.join(tmpDir, 'stop_times.txt'), { encoding: 'utf8' })
  const writeStream = fs.createWriteStream(path.join(tmpDir, 'stop_times.csv'), { encoding: 'utf8' })
  const stringifier = stringify({
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
          stop_sequence: line[4]
        }
        next(null, stopTime)
      }
    }),
    stringifier,
    writeStream
  )
  console.log('Conversion terminée.')
  await log.step('Conversion du fichier stops.txt en stops.geojson')
  const readStreamStops = fs.createReadStream(path.join(tmpDir, 'stops.txt'), { encoding: 'utf8' })
  const writeStreamStops = fs.createWriteStream(path.join(tmpDir, 'stops.geojson'), { encoding: 'utf8' })
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
            stop_name: line[2],
            lat: line[4],
            lng: line[5]
          }
          stops.push(stop)
          next()
        }
      }
    })

  )
  const geojsonStops = GeoJSON.parse(stops, { Point: ['lat', 'lng'] })
  writeStreamStops.write(JSON.stringify(geojsonStops))
  console.log('Conversion terminée.')
  if (fs.existsSync(path.join(tmpDir, 'shapes.txt'))) {
    await log.step('Conversion du fichier shapes.txt en shapes.geojson')
    const readStreamStops = fs.createReadStream(path.join(tmpDir, 'shapes.txt'), { encoding: 'utf8' })
    const writeStreamStops = fs.createWriteStream(path.join(tmpDir, 'shapes.geojson'), { encoding: 'utf8' })
    const shapes = []
    await pump(
      byline.createStream(readStreamStops),
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
              shape_pt_sequence: line[3]
            }
            shapes.push(shape)
            next()
          }
        }
      })

    )
    const geojsonShapes = GeoJSON.parse(shapes, { Point: ['lat', 'lng'] })
    writeStreamStops.write(JSON.stringify(geojsonShapes))
    console.log('Conversion terminée.')
  }
}
