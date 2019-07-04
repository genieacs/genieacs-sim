"use strict";

function node(key, attrs = {}, value = "") {
  if (Array.isArray(value)) value = value.join("");
  let attrsStr = "";
  for (const [k, v] of Object.entries(attrs)) attrsStr += ` ${k}="${v}"`;
  if (!value) return `<${key}${attrsStr}/>`
  return `<${key}${attrsStr}>${value}</${key}>`
}

exports.node = node;
