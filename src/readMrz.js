import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import ocrTools from 'ocr-tools'
import mrzOcr from './internal/mrzOcr.js'
import * as symbols from './internal/symbols.js'

const ROI_OPTIONS = {
  positive: true,
  negative: false,
  minSurface: 5,
  minRatio: 0.3,
  maxRatio: 3.0,
  algorithm: 'otsu',
  randomColors: true
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const fingerprintOptions = {
  baseDir: join(__dirname, '../fontData'),
  height: 12,
  width: 12,
  minSimilarity: 0.5,
  fontName: 'ocrb',
  category: symbols.label,
  ambiguity: true
}

async function loadFontDataWithCheck(options) {
  try {
    const fontData = await ocrTools.loadFontData(options)
    return fontData
  } catch (error) {
    console.error('Error loading font data:', error)
    throw error
  }
}

const fontFingerprint = await loadFontDataWithCheck(fingerprintOptions)

export async function readMrz(image, options = {}) {
  const { ocrResult, mask, rois } = await mrzOcr(image, fontFingerprint, {
    method: 'svm',
    ROI_OPTIONS,
    fingerprintOptions
  })

  if (options.saveName) {
    mask.save(options.saveName)
  }

  return { rois, mrz: ocrResult }
}
