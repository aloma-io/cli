/**
 * Library: base64
 * 
 * Edit the types and content below.
 * The types should be a function that returns type definitions.
 * The content should be JavaScript code with function implementations and exports.
 * 
 * Example:
 * types = () => {
 *   return "function processData(data: any): any";
 * };
 * 
 * content = () => {
 *   const processData = (data) => {
 *     return data.map(item => ({ ...item, processed: true }));
 *   };
 *   module.exports = { processData };
 * };
 */

export const types = () => {
  return `
  /**
  * Encode an object into a base64 string
  * @param {object} obj - The object to encode
  * @returns {string} - The base64 encoded string
  **/
  declare function encode(obj: any): string;
  /**
  * Decode a base64 string
  * @param {string} base64String - The base64 encoded string
  * @returns {string} - The decoded string
  **/
  declare function decode(base64String: string): string`;
};

export const content = () => {
const encode = (obj) => {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const byteArray = new Uint8Array(Object.values(obj));
  let binaryString = '';

  // Convert each byte to a binary string
  for (let i = 0; i < byteArray.length; i++) {
    binaryString += byteArray[i].toString(2).padStart(8, '0');
  }

  let base64 = '';

  // Convert binary string to Base64
  for (let i = 0; i < binaryString.length; i += 6) {
    const binarySegment = binaryString.substr(i, 6);
    const decimalValue = parseInt(binarySegment, 2);
    base64 += base64Chars[decimalValue];
  }

  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  return base64;
};

  function decode(base64String) {
    const base64 = base64String.replace(/=+$/, '');
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const binary = [];
    for (let i = 0; i < base64.length; i++) {
      const index = base64Chars.indexOf(base64[i]);
      const binaryString = index.toString(2).padStart(6, '0');
      binary.push(binaryString);
    }
    const binaryString = binary.join('');
    const byteLength = Math.ceil(binaryString.length / 8);
    const bytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      const byteString = binaryString.substr(i * 8, 8);
      bytes[i] = parseInt(byteString, 2);
    }
    let decodedString = '';
    for (let i = 0; i < bytes.length; i++) {
      decodedString += String.fromCharCode(bytes[i]);
    }
    return decodedString;
  }
module.exports = { encode, decode }
};
