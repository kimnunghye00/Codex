import fs from 'node:fs';
for (const file of ['production-audit.json','full-audit.json']) {
  const data = JSON.parse(fs.readFileSync('qa-reports/' + file, 'utf8'));
  if (data.error || !data.metadata?.vulnerabilities) throw Error('Audit report incomplete: ' + file);
  const v = data.metadata.vulnerabilities;
  console.log(file, JSON.stringify(v));
  const lines = ['### ' + file, '', '| Severity | Count |', '| --- | ---: |', ...['critical','high','moderate','low','total'].map(k => '| ' + k + ' | ' + v[k] + ' |'), '', 'Remaining packages: ' + Object.keys(data.vulnerabilities ?? {}).join(', '), ''];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  if (v.high || v.critical) process.exitCode = 1;
}
