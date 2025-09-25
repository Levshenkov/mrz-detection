import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getFileBuffer } from '../src/pdfToImage.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pdfFilePath = path.join(__dirname, 'mock_passport.pdf')
const uploadPath = path.join(__dirname, 'output')

async function testPdfConversion() {
  try {
    const pdfBuffer = fs.readFileSync(pdfFilePath)
    const file = {
      toBuffer: async () => pdfBuffer
    }

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath)
    }
    const imageBuffer = await getFileBuffer(file, uploadPath)
    fs.writeFileSync(path.join(uploadPath, 'output_image.jpg'), imageBuffer)

    console.log('PDF successfully converted to image.')
  } catch (error) {
    console.error('Error during PDF conversion:', error)
  }
}

testPdfConversion()
