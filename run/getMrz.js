/**
 * Port of the python script by Adrian Rosebrock:
 * https://www.pyimagesearch.com/2015/11/30/detecting-machine-readable-zones-in-passport-images/
 */

import radiansDegrees from 'radians-degrees'
import { Matrix } from 'ml-matrix'
import { rotateDEG, translate, transform, applyToPoint, applyToPoints } from 'transformation-matrix'

const RECT_KERNEL = getRectKernel(9, 5)
const SQ_KERNEL = getRectKernel(19, 19)
const MIN_RATIO = 7
const MAX_RATIO = 14

/**
 * Generates a rectangular kernel used for morphological operations.
 * @param {number} width - Width of the kernel.
 * @param {number} height - Height of the kernel.
 * @returns {number[][]} Rectangular kernel matrix.
 */
function getRectKernel(width, height) {
  return Array.from({ length: width }, () => Array(height).fill(1))
}

/**
 * Main function to extract the MRZ (Machine Readable Zone) from an image.
 * @param {object} image - The input image object.
 * @param {object} options - Optional parameters.
 * @param {boolean} [options.debug=false] - Flag to enable debug mode.
 * @param {object} [options.out={}] - Object to store intermediate images if debug is enabled.
 * @returns {object} The cropped image containing the MRZ, or debug images if debug mode is enabled.
 */
export function getMrz(image, options = {}) {
  try {
    return internalGetMrz(image, options)
  } catch (e) {
    return internalGetMrz(image.rotateLeft(), options)
  }
}

/**
 * Internal function to handle the extraction of the MRZ with image processing.
 * @param {object} image - The input image object.
 * @param {object} options - Optional parameters.
 * @returns {object} The cropped MRZ image or debug images.
 */
function internalGetMrz(image, options) {
  const { debug = false, out = {} } = options

  const original = image
  const images = out

  image = applyImageProcessing(image, debug, images)
  const originalToTreatedRatio = original.width / image.width

  const rois = getRois(image, debug, images)
  const mrzRoi = filterRois(rois)

  let toCrop = original
  const regionTransform = rotateImageToCrop(toCrop, mrzRoi, originalToTreatedRatio)

  const mrzCropOptions = calculateCropOptions(mrzRoi, originalToTreatedRatio, regionTransform, toCrop)

  toCrop = applyFinalRotation(toCrop, mrzCropOptions)
  const cropped = cropMrz(toCrop, mrzCropOptions, debug, images)

  return debug ? { images } : cropped
}

/**
 * Applies a series of image processing steps to prepare the image for MRZ extraction.
 * @param {object} image - The input image object.
 * @param {boolean} debug - Flag to enable debug mode.
 * @param {object} images - Object to store intermediate images if debug is enabled.
 * @returns {object} Processed image.
 */
function applyImageProcessing(image, debug, images) {
  const processImage = (img, operation, key) => {
    img = operation(img)
    if (debug) images[key] = img
    return img
  }

  image = processImage(image.resize({ width: 500 }), img => img.grey(), 'resized')
  image = processImage(image.gaussianFilter({ radius: 1 }), img => img, 'grey')
  image = processImage(image.blackHat({ kernel: RECT_KERNEL }), img => img, 'blackhat')
  image = processImage(image.scharrFilter({ direction: 'x', bitDepth: 32 }).abs().rgba8().grey(), img => img, 'scharr')
  image = processImage(image.close({ kernel: RECT_KERNEL }), img => img, 'close')
  image = processImage(image.mask({ algorithm: 'otsu' }), img => img, 'mask')
  image = processImage(image.close({ kernel: SQ_KERNEL }), img => img, 'close2')
  image = processImage(image.erode({ iterations: 4 }).dilate({ iterations: 8 }), img => img, 'erode')

  return image
}

/**
 * Extracts regions of interest (ROIs) from the processed image.
 * @param {object} image - The processed image.
 * @param {boolean} debug - Flag to enable debug mode.
 * @param {object} images - Object to store intermediate images if debug is enabled.
 * @returns {object[]} Array of ROIs with metadata.
 */
function getRois(image, debug, images) {
  const roiManager = image.getRoiManager()
  roiManager.fromMask(image)

  let rois = roiManager.getRois({ minSurface: 5000 })
  let masks = rois.map(roi => roi.getMask())

  rois = rois.map((roi, idx) => {
    const rect = masks[idx].minimalBoundingRectangle()
    const [d1, d2] = [getDistance(rect[0], rect[1]), getDistance(rect[1], rect[2])]
    const [pt1, pt2, ratio] = d2 > d1 ? [rect[1], rect[2], d2 / d1] : [rect[0], rect[1], d1 / d2]

    const angle = -radiansDegrees(Math.atan2(pt2[1] - pt1[1], pt2[0] - pt1[0])) % 180
    return { meta: { angle: angle > 90 ? angle - 180 : angle, ratio }, roi }
  })

  if (debug) {
    const painted = image.clone().paintMasks(masks, { distinctColor: true, alpha: 50 })
    images.painted = painted
  }

  return rois
}

/**
 * Filters the ROIs to find the most likely MRZ region.
 * @param {object[]} rois - Array of ROIs with metadata.
 * @returns {object} The ROI with the highest probability of being the MRZ.
 */
function filterRois(rois) {
  rois = rois.filter(roi => checkRatio(roi.meta.ratio))

  if (rois.length === 0) {
    throw new Error('no roi found')
  }

  return rois.length > 1 ? rois.sort((a, b) => b.roi.surface - a.roi.surface)[0] : rois[0]
}

/**
 * Rotates the image to align the MRZ region horizontally.
 * @param {object} toCrop - The original image to be cropped.
 * @param {object} mrzRoi - The ROI containing the MRZ.
 * @param {number} originalToTreatedRatio - Ratio between original and processed image dimensions.
 * @returns {object} The transform applied to rotate the region, if needed.
 */
function rotateImageToCrop(toCrop, mrzRoi) {
  let angle = mrzRoi.meta.angle
  let regionTransform

  if (Math.abs(angle) > 45) {
    if (angle < 0) {
      toCrop = toCrop.rotateRight()
      angle += 90
      regionTransform = transform(translate(toCrop.width, 0), rotateDEG(90))
    } else {
      toCrop = toCrop.rotateLeft()
      angle -= 90
      regionTransform = transform(translate(0, toCrop.height), rotateDEG(-90))
    }
  }

  return regionTransform
}

/**
 * Calculates the cropping options for the MRZ region.
 * @param {object} mrzRoi - The ROI containing the MRZ.
 * @param {number} originalToTreatedRatio - Ratio between original and processed image dimensions.
 * @param {object} regionTransform - The transform applied to rotate the region, if needed.
 * @param {object} toCrop - The image to be cropped.
 * @returns {object} Crop options for the MRZ region.
 */
function calculateCropOptions(mrzRoi, originalToTreatedRatio, regionTransform, toCrop) {
  let mrzCropOptions

  if (Math.abs(mrzRoi.meta.angle) < 1) {
    mrzCropOptions = {
      x: mrzRoi.roi.minX * originalToTreatedRatio,
      y: mrzRoi.roi.minY * originalToTreatedRatio,
      width: (mrzRoi.roi.maxX - mrzRoi.roi.minX) * originalToTreatedRatio,
      height: (mrzRoi.roi.maxY - mrzRoi.roi.minY) * originalToTreatedRatio
    }

    if (regionTransform) {
      const rotated = applyToPoint(regionTransform, mrzCropOptions)
      ;[mrzCropOptions.x, mrzCropOptions.y, mrzCropOptions.width, mrzCropOptions.height] = [
        rotated.x,
        rotated.y - mrzCropOptions.height,
        mrzCropOptions.height,
        mrzCropOptions.width
      ]
    }
  } else {
    const hull = calculateConvexHull(mrzRoi, originalToTreatedRatio, regionTransform, toCrop)
    const { minX, minY, maxX, maxY } = hull

    mrzCropOptions = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    }
  }

  return mrzCropOptions
}

/**
 * Calculates the convex hull of the MRZ region for cropping.
 * @param {object} mrzRoi - The ROI containing the MRZ.
 * @param {number} originalToTreatedRatio - Ratio between original and processed image dimensions.
 * @param {object} regionTransform - The transform applied to rotate the region, if needed.
 * @param {object} toCrop - The image to be cropped.
 * @returns {object} Object with minX, minY, maxX, and maxY values of the convex hull.
 */
function calculateConvexHull(mrzRoi, originalToTreatedRatio, regionTransform, toCrop) {
  let points = mrzRoi.roi.points.map(pt => ({ x: pt[0] * originalToTreatedRatio, y: pt[1] * originalToTreatedRatio }))
  if (regionTransform) points = applyToPoints(regionTransform, points)

  const matrix = new Matrix(points.map(pt => [pt.x, pt.y]))
  const hullPoints = new Matrix(matrix.convexHull())

  const minX = hullPoints.minColumn(0)
  const minY = hullPoints.minColumn(1)
  const maxX = hullPoints.maxColumn(0)
  const maxY = hullPoints.maxColumn(1)

  return { minX, minY, maxX, maxY }
}

/**
 * Applies the final rotation to the image before cropping.
 * @param {object} toCrop - The image to be cropped.
 * @param {object} mrzCropOptions - Cropping options for the MRZ region.
 * @returns {object} Rotated image, if necessary.
 */
function applyFinalRotation(toCrop, mrzCropOptions) {
  if (mrzCropOptions.angle) {
    toCrop = toCrop.rotate(mrzCropOptions.angle)
  }
  return toCrop
}

/**
 * Crops the image to the MRZ region.
 * @param {object} toCrop - The image to be cropped.
 * @param {object} mrzCropOptions - Cropping options for the MRZ region.
 * @param {boolean} debug - Flag to enable debug mode.
 * @param {object} images - Object to store intermediate images if debug is enabled.
 * @returns {object} Cropped image.
 */
function cropMrz(toCrop, mrzCropOptions, debug, images) {
  const cropped = toCrop.crop(mrzCropOptions)
  if (debug) images.cropped = cropped
  return cropped
}

/**
 * Checks if the ratio is within the expected range for the MRZ.
 * @param {number} ratio - The ratio to check.
 * @returns {boolean} True if the ratio is valid, otherwise false.
 */
function checkRatio(ratio) {
  return ratio > MIN_RATIO && ratio < MAX_RATIO
}

/**
 * Calculates the Euclidean distance between two points.
 * @param {number[]} point1 - First point as [x, y].
 * @param {number[]} point2 - Second point as [x, y].
 * @returns {number} The distance between the two points.
 */
function getDistance([x1, y1], [x2, y2]) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
