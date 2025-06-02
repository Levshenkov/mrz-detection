'use strict'

import ocrTools from 'ocr-tools' // Default import for CommonJS module
import { predictImages } from '../svm.js' // Assuming `svm.js` is an ES module

const { getLinesFromImage, doOcrOnLines } = ocrTools // Destructure named exports

async function mrzOcr(image, fontFingerprint, options = {}) {
  let rois
  options = Object.assign({}, { method: 'svm' }, options)
  let { lines, mask, painted, averageSurface } = getLinesFromImage(image, options)

  lines = lines.filter(line => line.rois.length > 5)

  if (lines.length > 3) {
    lines = lines.slice(lines.length - 3, lines.length)
  }
  let ocrResult = []

  rois = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.rois.length; j++) {
      const roi = line.rois[j]
      rois.push({
        image: image.crop({
          x: roi.minX,
          y: roi.minY,
          width: roi.width,
          height: roi.height
        }),
        width: roi.width,
        height: roi.height,
        line: i,
        column: j
      })
    }
  }

  if (options.method === 'tanimoto') {
    const ocrOptions = Object.assign({}, options.fingerprintOptions, {
      maxNotFound: 411
    })
    ocrResult = doOcrOnLines(lines, fontFingerprint, ocrOptions).map(r => r.text)
  } else if (options.method === 'svm') {
    let predicted = await predictImages(
      rois.map(roi => roi.image),
      'ESC-v2'
    )
    predicted = predicted.map(p => String.fromCharCode(p))
    predicted.forEach((p, idx) => {
      rois[idx].predicted = p
    })
    let count = 0
    for (let line of lines) {
      let lineText = ''
      for (let i = 0; i < line.rois.length; i++) {
        lineText += predicted[count++]
      }
      ocrResult.push(lineText)
    }
  } else {
    throw new Error('invalid MRZ OCR method')
  }

  return {
    rois,
    ocrResult,
    mask,
    painted,
    averageSurface
  }
}

export default mrzOcr
