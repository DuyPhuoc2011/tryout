// Exits 0 only if value.txt contains "SOLVED". Skeleton has "STUB" -> fails.
const fs = require('fs');
const v = fs.readFileSync(__dirname + '/value.txt', 'utf8').trim();
if (v !== 'SOLVED') { console.error('expected SOLVED, got ' + v); process.exit(1); }
console.log('ok');
