/**
 * Library: base64
 *
 * Fixed 21 May 2026 — encode() body replaced with canonical string-based implementation
 * (previous Uint8Array(Object.values(obj)) produced all-zero bytes for string input).
 */

export const types = () => {
  return `
  /**
  * Encode a string into a base64 string
  * @param {string} str - The string to encode
  * @returns {string} - The base64 encoded string
  **/
  declare function encode(str: string): string;
  /**
  * Decode a base64 string
  * @param {string} base64String - The base64 encoded string
  * @returns {string} - The decoded string
  **/
  declare function decode(base64String: string): string`;
};

export const content = () => {
  const encode = (str) => {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i));
    }
    const byteArray = new Uint8Array(bytes);
    let binaryString = '';
    byteArray.forEach(byte => { binaryString += String.fromCharCode(byte); });

    let base64 = '';
    for (let i = 0; i < binaryString.length; i += 3) {
      const b0 = binaryString.charCodeAt(i);
      const b1 = i + 1 < binaryString.length ? binaryString.charCodeAt(i + 1) : 0;
      const b2 = i + 2 < binaryString.length ? binaryString.charCodeAt(i + 2) : 0;
      base64 += base64Chars[b0 >> 2];
      base64 += base64Chars[((b0 & 3) << 4) | (b1 >> 4)];
      base64 += i + 1 < binaryString.length ? base64Chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      base64 += i + 2 < binaryString.length ? base64Chars[b2 & 63] : '=';
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

  module.exports = { encode, decode };
};
