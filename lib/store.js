'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function assertClean(text, label) {
  const marker = new RegExp('^(?:' + '<'.repeat(7) + '|' + '='.repeat(7) + '|' + '>'.repeat(7) + ')(?: |$)', 'm');
  if (marker.test(text)) throw new Error(`${label}: conflict markers detected; refusing to overwrite history`);
}

function readJSON(file) {
  const text = fs.readFileSync(file, 'utf8');
  assertClean(text, file);
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`${file}: invalid JSON; restore the last good version before updating`, { cause: error }); }
}

function readAssignment(file, name) {
  const text = fs.readFileSync(file, 'utf8');
  assertClean(text, file);
  const match = text.match(new RegExp('window\\.' + name + '\\s*=\\s*([\\s\\S]*?);(?:\\r?\\n|$)'));
  if (!match) throw new Error(`${file}: missing ${name}; refusing to reset history`);
  return JSON.parse(match[1]);
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

function writeJSON(file, data) { atomicWrite(file, JSON.stringify(data, null, 2) + '\n'); }
function fingerprint(data) { return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'); }

module.exports = { assertClean, readJSON, readAssignment, atomicWrite, writeJSON, fingerprint };
