/* CSV Parser - written by Jacob Rowe-Lane.  Huge inspiration credit to Zaid Abdulla and the genieacs-sim project */

"use strict";

const CHAR_DOUBLE_QUOTE = 34; // Char code for double quotes
const CHAR_CR = 13; // Carriage return
const CHAR_LF = 10; // Line feed
const CHAR_COMMA = 44; // Comma

/* Based off https://tools.ietf.org/html/rfc4180#section-2 standard.  Again, credit to Zaid Abdulla */
function parseCSVFromString(data) {
	const lines = []; // All "rows" in the CSV
	let row = []; // Individual row, ephermeral
	let field = ""; // Element of row

	let escapedQuote = false; // Toggle on double quotes
	let i = 0; // Global iterator
	let l = 0; // Line iterator
	let c = 0; //Character iterator

	function addFieldToRow() {
		row.push(field); // Push field into row
		field = ""; // Reset field
		c = 0; // Reset character iterator
	}

	function addRow() {
		lines.push(row); // Add row to lines
		row = []; // Reset row
		l++; // Iterate line (error messages)
		while ([CHAR_LF, CHAR_CR].includes(data.charCodeAt(i + 1))) i++; // If next character is CR or LF, ignore and increment i
	}

	data = data.trim() + "\n"; // Remove whitespace, add newline to the end

	for (i; i < data.length; i++) {  // Iterate through all characters
		const current_char = data.charAt(i);  //Select character of iterator
		c++;  // Iterate character counter
		switch(data.charCodeAt(i)) {  // Switch on current character
			case CHAR_DOUBLE_QUOTE:  // Double quote
      if (!escapedQuote) {
        if (field.length) {
            console.log(lines);
						throw new Error ("Invalid CSV formatting: Double Quote bad placement @ row: " + l + ", character: " + c); // Double quotes can only appear inside a field if enclosed inside double quotes
					}
					escapedQuote = true;  //  Flip to escaped
			}
			else {
				const nextChar = data.charCodeAt(i + 1);
				if (nextChar === CHAR_DOUBLE_QUOTE) {  // Double quotes must be escaped with prior double quotes
					field += current_char;
					i++; // Additional iteration to avoid errors or double quoting
					/* Variation from Zaid's code - whilst CR, LF, Commas and DQs must only appear inside an escaped field if they wish to be represented, any other character is allowed to
					co-exist hence further checking is not necessary */
				} else {
					escapedQuote = false;  // Flip to normal
				}
			}
			break;

			case CHAR_COMMA: // Usually signifies new field
				if(!escapedQuote) { //  If not inside a quote then push field to row
          addFieldToRow();
        } else field += current_char;  //  Otherwise it exists inside an escaped quote and should be interpreted literally
				break;

      case CHAR_CR:
        if(escapedQuote){
					field += current_char; //  Variation from Zaid - fields can contain CR characters if in escaped state according to RFC
				}
				break;

      case CHAR_LF:
				if(!escapedQuote){  //  Signifies end of line, add field to row and push row to line
					addFieldToRow();
					addRow();
				} else field += current_char;  //  In escaped state, treat as literal
				break;

      default:
				field += current_char;  //  No special character, treat as literal
				break;
    }
  }

  if(escapedQuote) {
      throw new Error("Invalid CSV: Finished parsing, left hanging escaped state");
    }
    return lines;
}

function reduceParsed(parsedCSV, headers = true) {  // Maps every entry to a header category
	if (headers) {
		const headersArray = parsedCSV.shift();  // If first line is a header line (as indicated by headers boolean), shift first value of array parsedCSV into headersArray
		return parsedCSV.map(item => { // Map function - takes "item" as the current element being processed and passes it into arrow function
			let retObj = {}; // Declare object, K V array
			for (let i = 0; i < headersArray.length; i++) { // headersArray is a nested array.  Each "i" represents an entire field, not a character
				retObj[headersArray[i]] = item[i]; // item is also a nested array, this sets the key of retObj to the header value at position "i" in the local loop and assigns it to the value at item position "i"
    }
			return retObj; // Return
		});
  } else {
			return parsedCSV.map(item => { // Similar to above, but headerArray doesn't exist.  No iterator required as mapping an array to an object has default behavior of mapping every array item numerically, e.g.  zero'th entry has key of 0 and value of array at position 0
				return Object.assign({}, item);
			});
  }
}

exports.parseCsv = parseCSVFromString;
exports.reduce = reduceParsed; // Exports both functions to be called externally