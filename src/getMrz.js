import radiansDegrees from 'radians-degrees'
import { Matrix } from 'ml-matrix'
import { rotateDEG, translate, transform, applyToPoint, applyToPoints } from 'transformation-matrix'

const MIN_RATIO = 4
const MAX_RATIO = 12
const RECT_KERNEL = createKernel(9, 5)
const SQ_KERNEL = createKernel(19, 19)

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
 * Processes an image to extract the Machine Readable Zone (MRZ).
 *
 * @param {Image} image - The input image to process.
 * @param {Object} [options={}] - Options for processing.
 * @param {boolean} [options.debug=false] - Whether to return debugging information.
 * @param {Object} [options.out={}] - Object to store intermediate images for debugging.
 * @returns {Image|Object} - The processed MRZ image.
 */
export function getMrz(image, options) {
  try {
    return internalGetMrz(image, options)
  } catch (e) {
    return internalGetMrz(image.rotateLeft(), options)
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

  const original = image

  const images = out

  let resized = image.resize({ width: 500 }).grey()
  const originalToTreatedRatio = original.width / resized.width
  if (debug) images.resized = resized

  // Combined image processing steps
  image = resized
    .gaussianFilter({ radius: 1 })
    .blackHat({ kernel: RECT_KERNEL })
    .scharrFilter({ direction: 'x', bitDepth: 32 })
    .abs()
    .rgba8()
    .grey()
    .close({ kernel: RECT_KERNEL })
    .mask({ algorithm: 'otsu' })
    .close({ kernel: SQ_KERNEL })
    .erode({ iterations: 2 })
    .dilate({ iterations: 4 })
  if (debug) images.processed = image

  const roiManager = resized.getRoiManager()
  roiManager.fromMask(image)
  let rois = roiManager.getRois({
    minSurface: 5000
  })

  let masks = rois.map((roi) => roi.getMask())
  rois = rois.map((roi, idx) => {
    const rect = masks[idx].minimalBoundingRectangle()
    let d1 = getDistance(rect[0], rect[1])
    let d2 = getDistance(rect[1], rect[2])
    let ratio
    let pt1, pt2
    if (d2 > d1) {
      ratio = d2 / d1
      pt1 = rect[1]
      pt2 = rect[2]
    } else {
      ratio = d1 / d2
      pt1 = rect[0]
      pt2 = rect[1]
    }
    if (pt1[1] < pt2[1]) {
      ;[pt1, pt2] = [pt2, pt1]
    }

    let angle = radiansDegrees(Math.atan2(pt2[1] - pt1[1], pt2[0] - pt1[0])) % 180
    angle = -angle

    if (angle > 90) angle -= 180
    return {
      meta: {
        angle,
        ratio
      },
      roi: roi
    }
  })

  rois = rois.filter((roi) => checkRatio(roi.meta.ratio))

  masks = rois.map((roi) => roi.roi.getMask())
  if (rois.length === 0) {
    throw new Error('no roi found')
  }

  if (rois.length > 1) {
    rois.sort((a, b) => b.roi.surface - a.roi.surface)
  }

  if (debug) {
    const painted = resized.clone().paintMasks(masks, {
      distinctColor: true,
      alpha: 50
    })
    images.painted = painted
  }

  let toCrop = original

  const mrzRoi = rois[0]
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
  let mrzCropOptions
  if (Math.abs(angle) < 1) {
    mrzCropOptions = {
      x: mrzRoi.roi.minX * originalToTreatedRatio,
      y: mrzRoi.roi.minY * originalToTreatedRatio,
      width: (mrzRoi.roi.maxX - mrzRoi.roi.minX) * originalToTreatedRatio,
      height: (mrzRoi.roi.maxY - mrzRoi.roi.minY) * originalToTreatedRatio
    }
    if (regionTransform) {
      const rotated = applyToPoint(regionTransform, mrzCropOptions)
      const tmp = mrzCropOptions.width
      mrzCropOptions.width = mrzCropOptions.height
      mrzCropOptions.height = tmp
      mrzCropOptions.x = rotated.x
      mrzCropOptions.y = rotated.y - mrzCropOptions.height
    }
  } else {
    let hull = mrzRoi.roi.mask.monotoneChainConvexHull().map(([x, y]) => ({
      x: (mrzRoi.roi.minX + x) * originalToTreatedRatio,
      y: (mrzRoi.roi.minY + y) * originalToTreatedRatio
    }))

    if (regionTransform) {
      hull = applyToPoints(regionTransform, hull)
    }

    const beforeRotate = toCrop
    const afterRotate = beforeRotate.rotate(angle, {
      interpolation: 'bilinear'
    })

    const widthDiff = (afterRotate.width - beforeRotate.width) / 2
    const heightDiff = (afterRotate.height - beforeRotate.height) / 2

    const transformation = transform(translate(widthDiff, heightDiff), getRotationAround(beforeRotate, angle))

    const rotatedHull = applyToPoints(transformation, hull)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of rotatedHull) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }

    minX = Math.max(0, Math.round(minX))
    minY = Math.max(0, Math.round(minY))
    maxX = Math.min(afterRotate.width, Math.round(maxX))
    maxY = Math.min(afterRotate.height, Math.round(maxY))

    mrzCropOptions = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    }
    toCrop = afterRotate
  }

  if (mrzCropOptions.y < toCrop.height / 2) {
    toCrop = toCrop.rotate(180)
    const newXY = applyToPoint(getRotationAround(toCrop, 180), mrzCropOptions)
    mrzCropOptions.x = newXY.x - mrzCropOptions.width
    mrzCropOptions.y = newXY.y - mrzCropOptions.height
  }

  let cropped = toCrop.crop(mrzCropOptions).grey().mask({ algorithm: 'otsu' }).erode({ iterations: 2 })

  if (debug) images.crop = cropped

  return debug ? { images } : cropped
}

/**
 * Checks if the given ratio is greater than the minimum ratio and less than 12.
 * @param {number} ratio - The ratio to check.
 * @returns {boolean} True if the ratio is within the valid range, false otherwise.
 */
function checkRatio(ratio) {
  return ratio > MIN_RATIO && ratio < MAX_RATIO
}

/**
 * Calculates the Euclidean distance between two points.
 * @param {number[]} p1 - The first point as an array [x, y].
 * @param {number[]} p2 - The second point as an array [x, y].
 * @returns {number} The distance between the two points.
 */
function getDistance(p1, p2) {
  const dv = getDiffVector(p1, p2)
  return Math.sqrt(dv.get(0, 0) * dv.get(0, 0) + dv.get(0, 1) * dv.get(0, 1))
}

/**
 * Calculates the difference vector between two points.
 * @param {number[]} p1 - The first point as an array [x, y].
 * @param {number[]} p2 - The second point as an array [x, y].
 * @returns {Matrix} The difference vector as a Matrix object.
 */
function getDiffVector(p1, p2) {
  const v1 = new Matrix([p1])
  const v2 = new Matrix([p2])
  const dv = v2.sub(v1)
  return dv
}

/**
 * Applies a rotation around the center of an image.
 * @param {Object} image - The image object with width and height properties.
 * @param {number} angle - The rotation angle in degrees.
 * @returns {Matrix} The transformation matrix after applying the rotation.
 */
function getRotationAround(image, angle) {
  const middle = { x: image.width / 2, y: image.height / 2 }
  return transform(translate(middle.x, middle.y), rotateDEG(angle), translate(-middle.x, -middle.y))
}
