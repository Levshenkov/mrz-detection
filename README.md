# MRZ Parsing Package

## Package Overview

This package offers a streamlined solution for extracting and parsing Machine Readable Zone (MRZ) data from images. It's designed for use cases involving identity documents like passports, visas, and ID cards. The package leverages the power of `tesseract.js`, along with the `image-js` and `mrz` libraries, to accurately detect and interpret MRZ data. `tesseract.js` enhances the package's capabilities by providing optical character recognition (OCR) to extract text from images, making it a valuable tool for developers working in fields like security, travel, or document processing.

## Key Features

- **Image Loading and Processing**: Uses `image-js` to load and manipulate images, allowing for robust image processing capabilities.
- **MRZ Detection**: The `getMrz` function identifies the MRZ portion of an image, isolating the relevant area for further processing.
- **MRZ Reading**: The `readMrz` function extracts the raw MRZ lines from the detected area, ensuring that the data is ready for parsing.
- **MRZ Parsing**: The `mrz` library is utilized to parse the extracted MRZ lines into a structured format, making it easier to work with the data programmatically.
- **Error Handling**: The package includes comprehensive error handling, ensuring that any issues during image processing or MRZ extraction are caught and logged.

## Dependencies
The package relies on the following dependencies:

- image-js: For image loading and manipulation.
- mrz: For parsing MRZ lines into structured data.

### Usage Example:

### Usage

```
import { Image } from 'image-js'
import { parse } from 'mrz';
import { getMrz } from '../src/getMrz.js'
import { readMrz } from '../src/readMrz.js'

const scanMRZ = async (id) => {
  try {
    const img = await Image.load(id)
    const mrzImg = getMrz(img);
    const mrz = await readMrz(mrzImg)
    console.log('MRZ LINES:', mrz)
    const parsedMrz = parse(mrz)
    console.log('PARSED MRZ INFO:', parsedMrz)
  } catch (error) {
    console.error('Error scanning MRZ:', error)
  }
}

scanMRZ('path/to/your/image.png')
```

## Running MRZ Scanning from Docker

You can run MRZ scanning directly inside the Docker container using a script. Here’s how:

1. **Create a script (e.g., `scan.js`)** in your project root that calls the MRZ scanning function:

   ```js
   // scan.js
   import { scanMRZ } from './src/scanMRZ.js'

   // Pass the image path as a command-line argument
   const imagePath = process.argv[2] || '/data/image.png'
   scanMRZ(imagePath)
   ```

2. **Build the Docker image** (if you haven’t already):

   ```sh
   docker build -t mrz-detection .
   ```

3. **Run the container and mount your image file**:

   ```sh
   docker run --rm -v /path/to/your/image.png:/data/image.png mrz-detection node scan.js /data/image.png
   ```

   - Replace `/path/to/your/image.png` with the path to your image on your machine.
   - `/data/image.png` is the path inside the container.

This will execute the MRZ scan on your image inside the Docker container and print the results to your terminal.