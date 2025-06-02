import { getNumberToLetterHeightRatio } from './util/rois.js'

export function getRoiStats(rois) {
  return {
    numberToLetterHeightRatio: getNumberToLetterHeightRatio(rois)
  }
}
