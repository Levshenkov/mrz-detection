import { writeFile, unlink, readFile } from 'node:fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import FileType from 'file-type'

// Import poppler only if needed (for non-EC2 environments)
let Poppler
try {
  Poppler = require('poppler') // npm poppler
} catch (err) {
  Poppler = null
}

const execAsync = promisify(exec)

/**
 * Get buffer from image file.
 * Converts PDF to image if needed.
 * @param {File} file
 * @returns {Promise.<Buffer>}
 */
export async function getFileBuffer(file, uploadPath) {
  let buffer = await file.toBuffer()
  const { mime } = await FileType.fromBuffer(buffer)

  if (mime === 'application/pdf') {
    buffer = await convertPdfToImage(buffer, {}, uploadPath)
  }

  return buffer
}

/**
 * Convert PDF buffer to image buffer using pdftoppm or npm poppler.
 * @param {Buffer} pdfBuffer - The buffer of the pdf file
 * @param {object?} options - optional conversion options
 * @returns {Promise.<Buffer>} image buffer
 */
async function convertPdfToImage(pdfBuffer, options = {}, uploadPath) {
  if (!uploadPath) {
    throw new Error('Missing config.file.uploadPath')
  }

  const date = Date.now()
  const pdfPath = path.join(uploadPath, `${date}.pdf`)
  const outputImagePath = path.join(uploadPath, `${date}`) // Without extension for pdftoppm

  // Write the PDF buffer to the file system
  await writeFile(pdfPath, pdfBuffer)

  const optionsPoppler = {
    format: 'jpeg',
    page: 1, // Convert the first page only
    ...options
  }

  // Check if `poppler-utils` (pdftoppm) is available (for EC2)
  const usePopplerUtils = await isPopplerUtilsAvailable()

  try {
    if (usePopplerUtils) {
      // EC2 instance: Use pdftoppm
      const cmd = `pdftoppm -f 1 -l 1 -${optionsPoppler.format} ${pdfPath} ${outputImagePath}`
      await execAsync(cmd)
      const imageBuffer = await readFile(`${outputImagePath}-1.jpg`)

      // Clean up the temporary files
      await unlink(pdfPath)
      await unlink(`${outputImagePath}-1.jpg`)

      return imageBuffer
    } else if (Poppler) {
      // Other environments: Use npm poppler
      const poppler = new Poppler()
      const options = {
        firstPageToConvert: 1,
        lastPageToConvert: 1,
        jpegFile: true
      }
      const output = await poppler.pdfToCairo(pdfPath, outputImagePath, options)
      const imageBuffer = await readFile(`${outputImagePath}-1.jpg`)

      // Clean up the temporary files
      await unlink(pdfPath)
      await unlink(`${outputImagePath}-1.jpg`)

      return imageBuffer
    } else {
      throw new Error('No PDF conversion method available.')
    }
  } catch (error) {
    throw new Error(`PDF to Image conversion failed: ${error.message}`)
  }
}

/**
 * Check if poppler-utils is installed (for EC2 environment)
 * @returns {Promise.<boolean>}
 */
async function isPopplerUtilsAvailable() {
  try {
    await execAsync('pdftoppm -v') // Check for pdftoppm availability
    return true
  } catch (error) {
    return false // pdftoppm not installed
  }
}
