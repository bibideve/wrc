// Minimal zero-dependency test runner for the Onceover engine.
const O = require('../public/profile.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
}
function ok(name, cond) { eq(name, !!cond, true); }

// --- CSV parsing edge cases ---
const parsed = O.parseCSV('a,b,c\n1,"x,y",3\n2,"he said ""hi""",4\n');
eq('parses 3 data fields with embedded comma', parsed[1], ['1', 'x,y', '3']);
eq('parses escaped quotes', parsed[2][1], 'he said "hi"');
ok('drops trailing empty row', parsed.length === 3);

const crlf = O.parseCSV('a,b\r\n1,2\r\n');
eq('handles CRLF', crlf, [['a', 'b'], ['1', '2']]);

const newlineInQuotes = O.parseCSV('a,b\n"line1\nline2",x\n');
eq('newline inside quotes stays in field', newlineInQuotes[1][0], 'line1\nline2');

// --- type inference ---
const rep = O.profile(
  'id,price,active,when,city,blank\n' +
  '1,10.5,true,2021-01-01,NYC,\n' +
  '2,20,false,2021-02-01,LA,\n' +
  '3,30.25,true,2021-03-01,NYC,\n' +
  '4,,yes,2021-04-01,SF,\n'
);
eq('row count', rep.rows, 4);
eq('col count', rep.cols, 6);
const byName = {};
rep.columns.forEach(c => byName[c.name] = c);
eq('id is integer', byName.id.type, 'integer');
eq('price is number', byName.price.type, 'number');
eq('active is boolean', byName.active.type, 'boolean');
eq('when is date', byName.when.type, 'date');
eq('city is category', byName.city.type, 'category');
eq('blank is empty', byName.blank.type, 'empty');
eq('price missing pct', byName.price.missingPct, 25);
eq('city unique count', byName.city.unique, 3);

// --- numeric stats + outliers ---
const nums = O.profile('x\n' + [1,2,2,3,3,3,4,4,5,100].map(String).join('\n') + '\n');
const x = nums.columns[0];
eq('min', x.stats.min, 1);
eq('max', x.stats.max, 100);
ok('detects the 100 as an outlier', x.stats.outliers >= 1);
ok('histogram has buckets', x.histogram.length > 0);

// --- correlation: perfect positive ---
let rows = 'a,b\n';
for (let i = 1; i <= 20; i++) rows += i + ',' + (i * 2) + '\n';
const corr = O.profile(rows);
ok('finds the a/b correlation', corr.correlations.length >= 1);
eq('r is +1 for y=2x', corr.correlations[0].r, 1);

// --- quality + issues ---
const dirty = O.profile('keep,same\n1,K\n2,K\n,K\n');
ok('flags constant column', dirty.issues.some(i => /same value/i.test(i.msg)));
ok('quality below 100 when issues exist', dirty.quality < 100);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
