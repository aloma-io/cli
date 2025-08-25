/**
 * Library: example
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
* Test function
* @param {string} word - The word to test
* @returns {string} - The word with "new" added to it
**/
  declare function test(word:string):string
  /**
* Test function
* @param {string} word - The word to test
* @returns {string} - The word with "finished"
**/
  declare function test2(word:string): string
  /**
* Test function
* @param {string} word - The word to test
* @returns {string} - The word with "adding" added to it
**/
  declare function testCLI(word:string): string
  `;
};

export const content = () => {
  function test(word) {
    console.log(word, ' testing updated from the cli');
    return `new ${word}`;
  }
  const test2 = (word) => {
    console.log('received ', word);
    return 'finished';
  };
  const testCLI = (word) => {
    console.log('tsting adding a new function ', word);
    return `adding ${word}`;
  };
  module.exports = { test, test2, testCLI };
};
