const MRZ = { symbols: [], label: 'mrz' }

// Populate the symbols array with character codes for digits and uppercase letters
for (let i = '0'.charCodeAt(0); i <= '9'.charCodeAt(0); i++) {
  MRZ.symbols.push(i)
}
for (let i = 'A'.charCodeAt(0); i <= 'Z'.charCodeAt(0); i++) {
  MRZ.symbols.push(i)
}

// Add the '<' character code
MRZ.symbols.push('<'.charCodeAt(0))

// Export the MRZ object
export default MRZ
