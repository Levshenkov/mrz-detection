// Import the required modules
const { createWorker } = require('tesseract.js')
const cv = require('opencv4nodejs')
const fs = require('fs')

// Function to perform OCR on the passport image
async function ocrPassport(imagePath) {
  // Load the input image, convert it to grayscale, and get its dimensions
  const image = cv.imread(imagePath)
  const gray = image.bgrToGray()
  const { rows: HEIGHT, cols: WIDTH } = gray

  // Initialize rectangular and square structuring elements
  const rectKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 7))
  const sqKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(21, 21))

  // Apply Gaussian blur and blackhat morphological operation
  const blurred = gray.gaussianBlur(new cv.Size(3, 3), 0)
  const blackhat = blurred.morphologyEx(rectKernel, cv.MORPH_BLACKHAT)

  // Apply gradient to highlight contours of the fonts
  const gradX = blackhat.sobel(cv.CV_32F, 1, 0)
  const absGradX = gradX.abs()
  const { minVal, maxVal } = absGradX.minMaxLoc()
  let grad = absGradX
    .sub(minVal)
    .div(maxVal - minVal)
    .mul(255)
    .convertTo(cv.CV_8U)

  grad = grad.morphologyEx(rectKernel, cv.MORPH_CLOSE)
  let thresh = grad.threshold(0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)

  thresh = thresh.morphologyEx(sqKernel, cv.MORPH_CLOSE)
  thresh = thresh.erode(new cv.Mat(), new cv.Mat(), { iterations: 2 })

  // Find contours on the binary image and sort them bottom-to-top
  const contours = thresh.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
  contours.sort((a, b) => b.boundingRect().y - a.boundingRect().y)

  // Initialize MRZ bounding box
  let mrzBox = null

  // Loop over the contours
  for (let contour of contours) {
    const rect = contour.boundingRect()
    const percentHeight = rect.height / HEIGHT
    const percentWidth = rect.width / WIDTH

    // If bounding box occupies more than 80% of width and 4% of height, assume MRZ is found
    if (percentWidth > 0.8 && percentHeight > 0.04) {
      mrzBox = rect
      break
    }
  }

  // If MRZ is not found, stop the program
  if (!mrzBox) {
    console.error('MRZ not found.')
    process.exit(0)
  }

  // Pad the bounding box to restore it after erosion
  const padX = Math.floor((mrzBox.x + mrzBox.width) * 0.03)
  const padY = Math.floor((mrzBox.y + mrzBox.height) * 0.03)
  const x = Math.max(0, mrzBox.x - padX)
  const y = Math.max(0, mrzBox.y - padY)
  const w = Math.min(WIDTH - x, mrzBox.width + padX * 2)
  const h = Math.min(HEIGHT - y, mrzBox.height + padY * 2)

  // Extract the MRZ region from the input image
  const mrz = image.getRegion(new cv.Rect(x, y, w, h))

  // Perform OCR on the MRZ region using Tesseract
  const worker = createWorker({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
  })
  await worker.load()
  await worker.loadLanguage('ocrb')
  await worker.initialize('ocrb')
  const {
    data: { text: mrzText }
  } = await worker.recognize(mrz)

  // Clean up and return the MRZ text
  await worker.terminate()
  return mrzText.replace(/\s/g, '')
}

// Main function
async function main() {
  const imagePath = process.argv[2]
  if (!imagePath || !fs.existsSync(imagePath)) {
    console.error('Please provide a valid path to the passport image.')
    process.exit(1)
  }

  const mrzText = await ocrPassport(imagePath)
  console.log('MRZ Text:', mrzText)
}

main()
