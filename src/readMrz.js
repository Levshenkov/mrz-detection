import { createWorker } from 'tesseract.js'
import path from 'path'

const CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
const TESS_OEM = 1

/**
 * Recognizes the MRZ (Machine Readable Zone) text from an image using Tesseract.js.
 *
 * @param {Buffer} image - The image buffer containing the MRZ to be recognized.
 * @returns {Promise<string[]>} - A promise that resolves to an array of recognized MRZ lines.
 * @throws {Error} - Throws an error if MRZ recognition fails.
 */
async function recognizeMrz(image) {
  const worker = await createWorker('mrz', TESS_OEM, {
    langPath: path.resolve('./')
  })

  try {
    await worker.setParameters({
      tessedit_char_whitelist: CHAR_WHITELIST
    })
    const {
      data: { text }
    } = await worker.recognize(image)

    return text
      .trim()
      .split('\n')
      .map((line) => line.replace(/\s+/g, ''))
  } catch (error) {
    throw new Error('MRZ recognition failed')
  } finally {
    await worker.terminate()
  }
}

/**
 * Reads the MRZ (Machine Readable Zone) from an image.
 *
 * @param {Image} image - The image containing the MRZ to be read.
 * @returns {Promise<string[]>} - A promise that resolves to an array of recognized MRZ lines.
 */
export async function readMrz(image) {
  const uint8Array = image.toBuffer()
  const buffer = Buffer.from(uint8Array)
  return await recognizeMrz(buffer)
}
