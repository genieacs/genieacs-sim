"use strict";

const CHAR_DOUBLE_QUOTE = 34;
const CHAR_CR = 13;
const CHAR_LF = 10;
const CHAR_COMMA = 44;

// https://tools.ietf.org/html/rfc4180#section-2
function parseCsv(data) {
  const rows = [];
  let row = [];
  let field = "";
  let escapedState = false;
  let i = 0;

  function addField() {
    row.push(field);
    field = "";
  }

  function addRow() {
    rows.push(row);
    row = [];
    // Ignore empty lines
    while ([CHAR_LF, CHAR_CR].includes(data.charCodeAt(i + 1))) i++;
  }

  data = data.trim() + "\n";

  for (i; i < data.length; i++) {
    const char = data.charAt(i);
    switch (data.charCodeAt(i)) {
      case CHAR_DOUBLE_QUOTE:
        if (!escapedState) {
          // quoted field started
          if (field.length) throw new Error("Invalid CSV format");
          escapedState = true;
        } else {
          const nextChar = data.charCodeAt(i + 1);
          if (nextChar === CHAR_DOUBLE_QUOTE) {
            field += char;
            i++;
          } else if (nextChar && ![CHAR_COMMA, CHAR_CR, CHAR_LF].includes(nextChar)) {
            throw new Error("Invalid CSV format");
          } else {
            // quoted field ended
            escapedState = false;
          }
        }
        break;

      case CHAR_COMMA:
        if (!escapedState) addField();
        else field += char;
        break;

      case CHAR_CR:
      case CHAR_LF:
        if (!escapedState) {
          addField();
          addRow();
        }
        else {
          field += char;
        }
        break;

      default:
        field += char;
        break;
    }
  }

  if (escapedState) throw new Error("Invalid CSV format");
  return rows;
}

function reduce(rows, headerFirstRow = true) {
  if (headerFirstRow) {
    const headers = rows.shift();
    return rows.map(row => {
      let obj = {};
      for (let i = 0; i < headers.length; i++)
        obj[headers[i]] = row[i];
      return obj;
    });
  } else {
    return rows.map(row => {
      return Object.assign({}, row);
    });
  }
}

exports.parseCsv = parseCsv;
exports.reduce = reduce;
