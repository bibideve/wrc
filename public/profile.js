// Onceover — the actual engine. Runs in the browser AND in Node (for tests).
// No dependencies. Parses CSV, infers types, computes real statistics.
(function (root) {
  'use strict';

  // ---- CSV parser (handles quotes, embedded commas, newlines, "" escapes) ----
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    // Normalize line endings is unsafe inside quotes, so we walk char-by-char.
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          row.push(field); field = '';
        } else if (c === '\n') {
          row.push(field); field = '';
          rows.push(row); row = [];
        } else if (c === '\r') {
          // swallow; handle \r\n and lone \r
          if (text[i + 1] === '\n') i++;
          row.push(field); field = '';
          rows.push(row); row = [];
        } else {
          field += c;
        }
      }
    }
    // flush trailing field/row if file doesn't end in newline
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    // drop a trailing fully-empty row (common from final newline)
    while (rows.length && rows[rows.length - 1].every(function (v) { return v === ''; })) {
      rows.pop();
    }
    return rows;
  }

  // ---- type detection helpers ----
  function isBlank(v) { return v === null || v === undefined || String(v).trim() === ''; }

  function looksInteger(v) { return /^-?\d{1,15}$/.test(v); }
  function looksFloat(v) { return /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v); }
  function looksBool(v) {
    return /^(true|false|yes|no|y|n|0|1|t|f)$/i.test(v);
  }
  function normalizeBool(v) {
    return /^(true|yes|y|1|t)$/i.test(v) ? 'true' : 'false';
  }
  // ISO-ish dates, US/EU slashes — kept conservative on purpose.
  function looksDate(v) {
    if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(v)) return true;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) return true;
    return false;
  }

  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  function quantile(sorted, q) {
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }
  function stddev(a, m) {
    if (a.length < 2) return 0;
    const v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1);
    return Math.sqrt(v);
  }

  function round(n, d) {
    if (!isFinite(n)) return n;
    const p = Math.pow(10, d == null ? 4 : d);
    return Math.round(n * p) / p;
  }

  // ---- per-column profiling ----
  function profileColumn(name, values) {
    const total = values.length;
    let missing = 0;
    const nonBlank = [];
    for (let i = 0; i < total; i++) {
      if (isBlank(values[i])) missing++;
      else nonBlank.push(String(values[i]).trim());
    }
    const present = nonBlank.length;

    // unique
    const seen = new Map();
    for (let i = 0; i < nonBlank.length; i++) {
      const k = nonBlank[i];
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const unique = seen.size;

    // type voting across present values
    let nInt = 0, nFloat = 0, nBool = 0, nDate = 0;
    const boolKinds = new Set();
    for (let i = 0; i < nonBlank.length; i++) {
      const v = nonBlank[i];
      if (looksInteger(v)) nInt++;
      if (looksFloat(v)) nFloat++;
      if (looksBool(v)) { nBool++; boolKinds.add(normalizeBool(v)); }
      if (looksDate(v)) nDate++;
    }
    const p = present || 1;
    let type = 'text';
    if (present === 0) type = 'empty';
    else if (nInt / p >= 0.95) type = 'integer';
    else if (nFloat / p >= 0.95) type = 'number';
    else if (nDate / p >= 0.95) type = 'date';
    // booleans may be written true/false/yes/no/1/0 — collapse to 2 real values
    else if (nBool / p >= 0.95 && boolKinds.size <= 2) type = 'boolean';
    else if (unique > 0 && unique <= Math.max(20, present * 0.5) && unique < present) type = 'category';
    else type = 'text';

    const col = {
      name: name,
      type: type,
      total: total,
      present: present,
      missing: missing,
      missingPct: round((missing / (total || 1)) * 100, 1),
      unique: unique,
      uniquePct: round((unique / (present || 1)) * 100, 1)
    };

    if (type === 'integer' || type === 'number') {
      const nums = [];
      for (let i = 0; i < nonBlank.length; i++) {
        const f = parseFloat(nonBlank[i]);
        if (isFinite(f)) nums.push(f);
      }
      nums.sort(function (a, b) { return a - b; });
      const m = mean(nums);
      const q1 = quantile(nums, 0.25);
      const q3 = quantile(nums, 0.75);
      const iqr = q3 - q1;
      const lo = q1 - 1.5 * iqr;
      const hi = q3 + 1.5 * iqr;
      let outliers = 0;
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] < lo || nums[i] > hi) outliers++;
      }
      col.stats = {
        min: round(nums[0]), max: round(nums[nums.length - 1]),
        mean: round(m), median: round(quantile(nums, 0.5)),
        std: round(stddev(nums, m)),
        q1: round(q1), q3: round(q3),
        outliers: outliers,
        zeros: nums.filter(function (x) { return x === 0; }).length,
        negatives: nums.filter(function (x) { return x < 0; }).length
      };
      col.histogram = histogram(nums);
      col._nums = nums; // used for correlations, stripped before JSON if needed
    } else {
      // top values
      const top = Array.from(seen.entries())
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, 8)
        .map(function (e) { return { value: e[0], count: e[1], pct: round((e[1] / present) * 100, 1) }; });
      col.top = top;
      // length stats for free-text
      let minLen = Infinity, maxLen = 0, sumLen = 0;
      for (let i = 0; i < nonBlank.length; i++) {
        const L = nonBlank[i].length;
        if (L < minLen) minLen = L;
        if (L > maxLen) maxLen = L;
        sumLen += L;
      }
      col.text = { minLen: present ? minLen : 0, maxLen: maxLen, avgLen: present ? round(sumLen / present, 1) : 0 };
    }
    return col;
  }

  function histogram(sortedNums, bins) {
    bins = bins || 12;
    const min = sortedNums[0];
    const max = sortedNums[sortedNums.length - 1];
    const out = [];
    if (min === max) {
      out.push({ from: min, to: max, count: sortedNums.length });
      return out;
    }
    const width = (max - min) / bins;
    const counts = new Array(bins).fill(0);
    for (let i = 0; i < sortedNums.length; i++) {
      let b = Math.floor((sortedNums[i] - min) / width);
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      counts[b]++;
    }
    for (let b = 0; b < bins; b++) {
      out.push({ from: round(min + b * width), to: round(min + (b + 1) * width), count: counts[b] });
    }
    return out;
  }

  // ---- Pearson correlation among numeric columns ----
  function correlations(columns) {
    const numeric = columns.filter(function (c) { return c._nums && c._nums.length > 2; });
    const pairs = [];
    for (let i = 0; i < numeric.length; i++) {
      for (let j = i + 1; j < numeric.length; j++) {
        const r = pearson(numeric[i]._nums, numeric[j]._nums);
        if (r !== null && Math.abs(r) >= 0.5) {
          pairs.push({ a: numeric[i].name, b: numeric[j].name, r: round(r, 2) });
        }
      }
    }
    pairs.sort(function (x, y) { return Math.abs(y.r) - Math.abs(x.r); });
    return pairs.slice(0, 10);
  }

  // Correlate by row alignment; only over rows where both present.
  function pearson(xa, ya) {
    const n = Math.min(xa.length, ya.length);
    if (n < 3) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const x = xa[i], y = ya[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; k++;
    }
    if (k < 3) return null;
    const cov = sxy - (sx * sy) / k;
    const dx = Math.sqrt(sxx - (sx * sx) / k);
    const dy = Math.sqrt(syy - (sy * sy) / k);
    if (dx === 0 || dy === 0) return null;
    return cov / (dx * dy);
  }

  // For correlation we need aligned per-row numeric arrays, not the sorted ones.
  // So we recompute aligned numeric vectors here using the raw matrix.
  function alignedNumeric(headers, matrix, colIndex) {
    const out = [];
    for (let r = 0; r < matrix.length; r++) {
      const v = matrix[r][colIndex];
      const f = isBlank(v) ? NaN : parseFloat(String(v).trim());
      out.push(isFinite(f) ? f : NaN);
    }
    return out;
  }

  // ---- top-level: profile a parsed matrix ----
  function profile(text) {
    const rows = parseCSV(text);
    if (rows.length === 0) {
      return { error: 'No rows found.' };
    }
    const headers = rows[0].map(function (h, i) {
      const t = String(h).trim();
      return t === '' ? ('column_' + (i + 1)) : t;
    });
    const body = rows.slice(1);
    const columns = [];
    for (let c = 0; c < headers.length; c++) {
      const colValues = body.map(function (r) { return r[c] === undefined ? '' : r[c]; });
      columns.push(profileColumn(headers[c], colValues));
    }

    // correlations using row-aligned vectors (handles missing per-row)
    const numericIdx = [];
    for (let c = 0; c < headers.length; c++) {
      if (columns[c].type === 'integer' || columns[c].type === 'number') numericIdx.push(c);
    }
    const aligned = {};
    numericIdx.forEach(function (c) { aligned[c] = alignedNumeric(headers, body, c); });
    const corrPairs = [];
    for (let i = 0; i < numericIdx.length; i++) {
      for (let j = i + 1; j < numericIdx.length; j++) {
        const ci = numericIdx[i], cj = numericIdx[j];
        // pairwise complete observations
        const xa = [], ya = [];
        for (let r = 0; r < body.length; r++) {
          const x = aligned[ci][r], y = aligned[cj][r];
          if (isFinite(x) && isFinite(y)) { xa.push(x); ya.push(y); }
        }
        const r = pearson(xa, ya);
        if (r !== null && Math.abs(r) >= 0.5) {
          corrPairs.push({ a: headers[ci], b: headers[cj], r: round(r, 2), n: xa.length });
        }
      }
    }
    corrPairs.sort(function (x, y) { return Math.abs(y.r) - Math.abs(x.r); });

    // strip internal arrays
    columns.forEach(function (c) { delete c._nums; });

    // data-quality score: penalize missingness, constant columns, dupes
    const score = qualityScore(columns, body.length);

    return {
      rows: body.length,
      cols: headers.length,
      cells: body.length * headers.length,
      columns: columns,
      correlations: corrPairs.slice(0, 12),
      issues: collectIssues(columns, body.length),
      quality: score
    };
  }

  function qualityScore(columns, nrows) {
    if (columns.length === 0) return 0;
    let penalty = 0;
    columns.forEach(function (c) {
      penalty += (c.missingPct / 100) * 0.5;          // missing data hurts
      if (c.unique <= 1 && c.present > 0) penalty += 0.6; // constant column
      if (c.type === 'empty') penalty += 1;
    });
    const per = penalty / columns.length;
    let s = Math.max(0, Math.min(100, Math.round(100 - per * 100)));
    return s;
  }

  function collectIssues(columns, nrows) {
    const issues = [];
    columns.forEach(function (c) {
      if (c.type === 'empty') {
        issues.push({ sev: 'high', col: c.name, msg: 'Column is completely empty.' });
      } else if (c.missingPct >= 50) {
        issues.push({ sev: 'high', col: c.name, msg: c.missingPct + '% of values are missing.' });
      } else if (c.missingPct > 0) {
        issues.push({ sev: 'low', col: c.name, msg: c.missing + ' missing value' + (c.missing === 1 ? '' : 's') + ' (' + c.missingPct + '%).' });
      }
      if (c.unique <= 1 && c.present > 0) {
        issues.push({ sev: 'med', col: c.name, msg: 'Every row has the same value — column adds no information.' });
      }
      if (c.stats && c.stats.outliers > 0) {
        issues.push({ sev: 'med', col: c.name, msg: c.stats.outliers + ' statistical outlier' + (c.stats.outliers === 1 ? '' : 's') + ' (1.5×IQR).' });
      }
      if (c.stats && c.stats.negatives > 0 && /age|count|qty|quantity|price|amount|total/i.test(c.name)) {
        issues.push({ sev: 'med', col: c.name, msg: c.stats.negatives + ' negative value' + (c.stats.negatives === 1 ? '' : 's') + ' in a field that should not be negative.' });
      }
    });
    // duplicate-ish: high-cardinality columns that look like IDs but have dupes
    return issues;
  }

  const API = { parseCSV: parseCSV, profile: profile, profileColumn: profileColumn };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Onceover = API;
})(typeof window !== 'undefined' ? window : this);
