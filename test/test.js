import { expect } from 'chai'
import { Image } from 'image-js'
import { parse } from 'mrz'
import { getMrz } from '../src/getMrz.js'
import { readMrz } from '../src/readMrz.js'

const scanMRZ = async (id) => {
  try {
    const img = await Image.load(id)
    const mrzImg = getMrz(img)
    const mrz = await readMrz(mrzImg)
    return parse(mrz)
  } catch (initialError) {
    console.error('Initial error reading MRZ:', initialError)
  }
}

describe('scanMRZ', () => {
  it('should process MRZ and return parsed information', async () => {
    const result = await scanMRZ('test/mock_passport.jpg')
    console.log(result)

    expect(result).to.be.an('object')
    expect(result).to.have.property('format')
    expect(result).to.have.property('details')
    expect(result).to.have.property('fields')
    expect(result).to.have.property('valid')
  })
})
