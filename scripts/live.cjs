const fs = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('linkedom');
const Core = require('../addon/core.js');
const engine = Core.createEngine({
  request: async (url, { signal }) => {
    const res = await fetch(url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(18000)]) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  parseDocument: (text, type) => new DOMParser().parseFromString(text, type)
});
(async () => {
  const report = {
    at: new Date().toISOString(),
    runtime: 'Node.js',
    neuripsMetadataMode: 'embedded-page-metadata-only',
    limitation: 'This runner has no Zotero BibTeX importer. Page publication dates can differ from official citation years. See native-results.json for the packaged plugin and installation-results.json for the actual library write.',
    cases: []
  };
  for (const title of ['Memory Mosaics at scale', 'Attention Is All You Need']) {
    const result = await engine.search(title);
    const official = result.candidates.find(c => c.source === 'NeurIPS' && c.score === 1);
    if (!official) throw new Error(`Official match missing: ${title}`);
    const resolved = await engine.resolve(official);
    if (!resolved.item.creators.length) throw new Error('Missing authors');
    report.cases.push({ title, statuses: result.statuses, candidates: result.candidates.map(c => ({ source: c.source, title: c.item.title, date: c.item.date, type: c.item.itemType, score: c.score })), official: resolved });
    console.log(title, resolved.item.itemType, resolved.item.creators.length, JSON.stringify(result.statuses));
  }
  const direct = await engine.search('arXiv:2507.03285');
  if (!direct.candidates.length) throw new Error('arXiv direct ID failed');
  report.arxivDirect = direct;
  fs.mkdirSync(path.resolve(__dirname, '../docs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../docs/live-results.json'), JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
