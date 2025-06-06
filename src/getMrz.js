import radiansDegrees from 'radians-degrees'
import { Matrix } from 'ml-matrix'
import { rotateDEG, translate, transform, applyToPoint, applyToPoints } from 'transformation-matrix'

const MIN_RATIO = 4
const MAX_RATIO = 12
const RECT_KERNEL = createKernel(9, 5)
const SQ_KERNEL = createKernel(19, 19)

/**
 * Processes an image to extract the Machine Readable Zone (MRZ).
 *
 * @param {Image} image - The input image to process.
 * @param {Object} [options={}] - Options for processing.
 * @param {boolean} [options.debug=false] - Whether to return debugging information.
 * @param {Object} [options.out={}] - Object to store intermediate images for debugging.
 * @returns {Image|Object} - The processed MRZ image.
 */
export function getMrz(image, options = {}) {
  try {
    return internalGetMrz(image, options)
  } catch (e) {
    const rotatedImage = image.rotateLeft()
    try {
      return internalGetMrz(rotatedImage, options)
    } catch (e) {
      const rotated180Image = rotatedImage.rotateLeft()
      return internalGetMrz(rotated180Image, options)
    }
  }
}

/**
 * Internal function to process the image for MRZ extraction.
 *
 * @param {Image} image - The input image to process.
 * @param {Object} [options={}] - Options for processing.
 * @param {boolean} [options.debug=false] - Whether to return debugging information.
 * @param {Object} [options.out={}] - Object to store intermediate images for debugging.
 * @returns {Image|Object} - The processed MRZ image or debugging information.
 * @throws {Error} - Throws an error if no ROI is found.
 */
function internalGetMrz(image, options = {}) {
  const { debug = false, out = {} } = options
  const images = out

  const original = image
  const resized = image.resize({ width: 500 })
  if (debug) images.resized = resized

  const originalToTreatedRatio = original.width / resized.width
  image = processImage(resized, images, debug)

  const roiManager = resized.getRoiManager()
  roiManager.fromMask(image)
  let rois = roiManager.getRois({ minSurface: 5000 })

  rois = extractRois(rois, images, debug, originalToTreatedRatio, original)

  if (rois.length === 0) {
    console.warn('No ROI found on initial processing')
    throw new Error('No ROI found')
  }

  const mrzRoi = rois[0]
  let { angle } = mrzRoi.meta

  const cropOptions = determineCropOptions(original, mrzRoi, angle, originalToTreatedRatio)

  const cropped = cropImage(original, cropOptions, angle, images, debug)

  return debug ? { images } : cropped
}

/**
 * Applies a filter function to an image and optionally stores the result in a debug object.
 * @param {Object} image - The image to process.
 * @param {Function} filter - The filter function to apply to the image.
 * @param {Object} [options={}] - Options to pass to the filter function.
 * @param {Object} [debugImages] - An object to store debug images.
 * @param {string} debugKey - The key to use for storing the debug image.
 * @returns {Object} - The processed image.
 */
function applyFilter(image, filter, options = {}, debugImages, debugKey) {
  const result = filter(image, options)
  if (debugImages) debugImages[debugKey] = result
  return result
}

/**
 * Processes the input image through a series of filters and optionally stores intermediate results for debugging.
 * @param {Object} image - The image to process.
 * @param {boolean} [debug=false] - Whether to store intermediate results for debugging.
 * @returns {Object} - The final processed image.
 */
function processImage(image, debug = false) {
  const debugImages = {}

  image = applyFilter(image, img => img.grey(), {}, debug ? debugImages : null, 'grey')
  image = applyFilter(image, img => img.gaussianFilter({ radius: 1 }), {}, debug ? debugImages : null, 'gaussian')
  image = applyFilter(image, img => img.blackHat({ kernel: RECT_KERNEL }), {}, debug ? debugImages : null, 'blackhat')
  image = applyFilter(
    image,
    img => img.scharrFilter({ direction: 'x', bitDepth: 32 }).abs().rgba8().grey(),
    {},
    debug ? debugImages : null,
    'scharr'
  )
  image = applyFilter(image, img => img.close({ kernel: RECT_KERNEL }), {}, debug ? debugImages : null, 'close')

  // Using 'otsu' as a fallback for 'adaptive'
  image = applyFilter(image, img => img.mask({ algorithm: 'otsu' }), {}, debug ? debugImages : null, 'otsu-mask')

  image = applyFilter(image, img => img.close({ kernel: SQ_KERNEL }), {}, debug ? debugImages : null, 'close2')
  image = applyFilter(
    image,
    img => img.erode({ iterations: 4 }).dilate({ iterations: 8 }),
    {},
    debug ? debugImages : null,
    'erode'
  )

  return image
}

/**
 * Extracts and processes Regions of Interest (ROIs) from a list, applying masks and validating their ratios.
 * Optionally paints masks on the resized image for debugging purposes.
 * @param {Array} rois - An array of ROI objects to process.
 * @param {Object} images - An object containing image data, which may include a resized image.
 * @param {boolean} [debug=false] - Whether to paint masks on the resized image for debugging.
 * @returns {Array} - An array of processed ROIs, sorted by surface area if more than one.
 */
function extractRois(rois, images, debug = false) {
  const masks = rois.map(roi => roi.getMask())

  rois = rois.map((roi, idx) => analyzeRoi(roi, masks[idx])).filter(roi => isValidRatio(roi.meta.ratio))

  if (debug) {
    const resized = images.resized
    const painted = resized.clone().paintMasks(masks, {
      distinctColor: true,
      alpha: 50
    })
    images.painted = painted
  }

  if (rois.length > 1) {
    rois.sort((a, b) => b.roi.surface - a.roi.surface)
  }

  return rois
}

/**
 * Analyzes a Region of Interest (ROI) by calculating dimensions and angle based on its mask.
 * @param {Object} roi - The ROI object to analyze.
 * @param {Object} mask - The mask associated with the ROI.
 * @returns {Object} - An object containing metadata and the original ROI.
 * @property {Object} meta - Metadata about the ROI.
 * @property {number} meta.angle - The angle of the bounding rectangle.
 * @property {number} meta.ratio - The ratio of the bounding rectangle's dimensions.
 * @property {Object} roi - The original ROI object.
 */
function analyzeRoi(roi, mask) {
  // Get the minimal bounding rectangle for the mask
  const rect = mask.minimalBoundingRectangle()

  // Calculate dimensions and ratio based on the bounding rectangle
  const [d1, d2, ratio, pt1, pt2] = calculateDimensions(rect)

  // Calculate the angle between two points
  const angle = calculateAngle(pt1, pt2)

  // Return the analysis results
  return {
    meta: { angle, ratio },
    roi: roi
  }
}

/**
 * Calculates dimensions of a bounding rectangle and its aspect ratio.
 * @param {Object} rect - The bounding rectangle represented as an array of points.
 * @returns {[number, number, number, Object, Object]} - An array containing:
 *   - `d1`: The distance between the first and second points.
 *   - `d2`: The distance between the second and third points.
 *   - `ratio`: The ratio of the two distances.
 *   - `pt1`: The point associated with the longer distance.
 *   - `pt2`: The other point associated with the longer distance.
 */
function calculateDimensions(rect) {
  const d1 = getDistance(rect[0], rect[1])
  const d2 = getDistance(rect[1], rect[2])
  const ratio = d2 > d1 ? d2 / d1 : d1 / d2
  const [pt1, pt2] = d2 > d1 ? [rect[1], rect[2]] : [rect[0], rect[1]]

  return [d1, d2, ratio, pt1, pt2]
}

/**
 * Calculates the angle between two points in degrees.
 * @param {Object} pt1 - The first point with `x` and `y` properties.
 * @param {Object} pt2 - The second point with `x` and `y` properties.
 * @returns {number} - The angle between the two points in degrees.
 */
function calculateAngle(pt1, pt2) {
  if (pt1[1] < pt2[1]) [pt1, pt2] = [pt2, pt1]

  let angle = radiansDegrees(Math.atan2(pt2[1] - pt1[1], pt2[0] - pt1[0])) % 180
  angle = -angle

  if (angle > 90) angle -= 180
  return angle
}

/**
 * Determines crop options based on the angle and ratio of the ROI.
 * @param {Object} original - The original image.
 * @param {Object} mrzRoi - The ROI with its mask and dimensions.
 * @param {number} angle - The angle of rotation required.
 * @param {number} ratio - The aspect ratio of the ROI.
 * @returns {Object} - The crop options including `x`, `y`, `width`, and `height`.
 */
function determineCropOptions(original, mrzRoi, angle, ratio) {
  if (Math.abs(angle) < 1) {
    return calculateStraightCrop(mrzRoi, ratio)
  } else {
    return calculateRotatedCrop(original, mrzRoi, angle, ratio)
  }
}

/**
 * Calculates crop options for a straight (non-rotated) ROI.
 * @param {Object} mrzRoi - The ROI with its mask and dimensions.
 * @param {number} ratio - The aspect ratio of the ROI.
 * @returns {Object} - The crop options including `x`, `y`, `width`, and `height`.
 */
function calculateStraightCrop(mrzRoi, ratio) {
  return {
    x: mrzRoi.roi.minX * ratio,
    y: mrzRoi.roi.minY * ratio,
    width: (mrzRoi.roi.maxX - mrzRoi.roi.minX) * ratio,
    height: (mrzRoi.roi.maxY - mrzRoi.roi.minY) * ratio
  }
}

/**
 * Calculates crop options for a rotated ROI.
 * @param {Object} original - The original image.
 * @param {Object} mrzRoi - The ROI with its mask and dimensions.
 * @param {number} angle - The angle of rotation required.
 * @param {number} ratio - The aspect ratio of the ROI.
 * @returns {Object} - The crop options including `x`, `y`, `width`, and `height`.
 */
function calculateRotatedCrop(original, mrzRoi, angle, ratio) {
  const hull = mrzRoi.roi.mask
    .monotoneChainConvexHull()
    .map(([x, y]) => ({ x: (mrzRoi.roi.minX + x) * ratio, y: (mrzRoi.roi.minY + y) * ratio }))

  const transformation = getRotationTransform(original, angle)
  const rotatedHull = applyToPoints(transformation, hull)

  const { minX, minY, maxX, maxY } = getBoundingBox(rotatedHull, original, angle)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

/**
 * Calculates the bounding box of a rotated convex hull.
 * @param {Array} rotatedHull - The rotated convex hull represented as an array of points.
 * @param {Object} original - The original image.
 * @param {number} angle - The angle of rotation.
 * @returns {Object} - The bounding box including `minX`, `minY`, `maxX`, and `maxY`.
 */
function getBoundingBox(rotatedHull, original, angle) {
  const afterRotate = original.rotate(angle, { interpolation: 'bilinear' })
  const widthDiff = (afterRotate.width - original.width) / 2
  const heightDiff = (afterRotate.height - original.height) / 2
  const transformation = transform(translate(widthDiff, heightDiff), getRotationAround(original, angle))
  const points = applyToPoints(transformation, rotatedHull)

  return points.reduce(
    (acc, { x, y }) => ({
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x),
      maxY: Math.max(acc.maxY, y)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )
}

/**
 * Crops an image based on the specified crop options and applies rotation if needed.
 * @param {Object} original - The original image to crop.
 * @param {Object} cropOptions - The crop options including `x`, `y`, `width`, and `height`.
 * @param {number} angle - The angle of rotation required.
 * @param {Object} images - An object to store debug images.
 * @param {boolean} [debug=false] - Whether to store the cropped image for debugging.
 * @returns {Object} - The cropped image.
 */
function cropImage(original, cropOptions, angle, images, debug = false) {
  let toCrop = original

  if (Math.abs(angle) > 45) {
    toCrop = rotateImage(toCrop, angle)
  }

  let cropped = toCrop.crop(cropOptions)

  if (cropOptions.y < toCrop.height / 2) {
    cropped = rotateAndCropImage(toCrop, cropOptions)
  }

  if (debug) images.crop = cropped

  return cropped
}

/**
 * Rotates an image based on the specified angle.
 * @param {Object} toCrop - The image to rotate.
 * @param {number} angle - The angle of rotation.
 * @returns {Object} - The rotated image.
 */
function rotateImage(toCrop, angle) {
  if (angle < 0) {
    return toCrop.rotateRight()
  } else {
    return toCrop.rotateLeft()
  }
}

/**
 * Rotates an image 180 degrees and crops it based on the crop options.
 * @param {Object} toCrop - The image to rotate and crop.
 * @param {Object} cropOptions - The crop options including `x`, `y`, `width`, and `height`.
 * @returns {Object} - The rotated and cropped image.
 */
function rotateAndCropImage(toCrop, cropOptions) {
  const rotationTransform = getRotationAround(toCrop, 180)
  const newXY = applyToPoint(rotationTransform, cropOptions)
  return toCrop.rotate(180).crop({ x: newXY.x - cropOptions.width, y: newXY.y - cropOptions.height })
}

/**
 * Creates a kernel matrix of specified width and height, filled with ones.
 * @param {number} w - The width of the kernel.
 * @param {number} h - The height of the kernel.
 * @returns {Array} - The kernel matrix.
 */
function createKernel(w, h) {
  return Array(w).fill(Array(h).fill(1))
}

/**
 * Calculates the distance between two points.
 * @param {Object} p1 - The first point with `x` and `y` properties.
 * @param {Object} p2 - The second point with `x` and `y` properties.
 * @returns {number} - The distance between the two points.
 */
function getDistance(p1, p2) {
  const dv = new Matrix([p2]).sub(new Matrix([p1]))
  return Math.hypot(dv.get(0, 0), dv.get(0, 1))
}

/**
 * Validates if the aspect ratio is within the acceptable range.
 * @param {number} ratio - The aspect ratio to validate.
 * @returns {boolean} - True if the ratio is within the acceptable range, otherwise false.
 */
function isValidRatio(ratio) {
  return ratio > MIN_RATIO && ratio < MAX_RATIO
}

/**
 * Creates a rotation transform for an image.
 * @param {Object} image - The image to rotate.
 * @param {number} angle - The angle of rotation in degrees.
 * @returns {Object} - The transformation matrix for rotation.
 */
function getRotationTransform(image, angle) {
  const center = { x: image.width / 2, y: image.height / 2 }
  return transform(translate(center.x, center.y), rotateDEG(angle), translate(-center.x, -center.y))
}
