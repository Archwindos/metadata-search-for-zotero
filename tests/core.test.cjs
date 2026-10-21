const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('linkedom');
const Core = require('../addon/core.js');
const parseDocument = (text, type) => new DOMParser().parseFromString(text, type);
const hash = '3767842e2ebee900236f534855aa2c36';
const official = `https://proceedings.neurips.cc/paper_files/paper/2025/hash/${hash}-Abstract-Conference.html`;
const title = 'Memory Mosaics at scale';
const searchHTML = `<ul><li>(2025) <a href="/paper_files/paper/2025/hash/${hash}-Abstract-Conference.html">${title}</a></li></ul>`;
const paperHTML = `<html><head>
  <meta name="citation_title" content="${title}"/>
  <meta name="citation_author" content="Zhang, Jianyu"/>
  <meta name="citation_author" content="Bottou, Léon"/>
  <meta name="citation_publication_date" content="2025"/>
  <meta name="citation_journal_title" content="Advances in Neural Information Processing Systems"/>
  <meta name="citation_volume" content="38"/>
  <meta name="citation_doi" content="10.52202/085713-1299"/>
</head><body><p class="paper-abstract">Networks of associative memories.</p></body></html>`;
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
<id>http://arxiv.org/abs/2507.03285v3</id><title>${title}</title><published>2025-07-04T04:23:03Z</published>
<summary>Associative memories.</summary><author><name>Jianyu Zhang</name></author><author><name>Léon Bottou</name></author>
<arxiv:doi>10.52202/085713-1299</arxiv:doi></entry></feed>`;

test('old/new NeurIPS domains and PDF URLs normalize to the correct abstract track', () => {
  for (const domain of ['papers.nips.cc', 'papers.neurips.cc', 'proceedings.neurips.cc']) {
    assert.equal(Core.neuripsURL(`https://${domain}/paper_files/paper/2025/file/${hash}-Paper-Conference.pdf`), official);
  }
  assert.match(Core.neuripsURL(`https://papers.nips.cc/paper/2017/hash/${hash}-Abstract.html`), /2017.*-Abstract.html$/);
  assert.equal(Core.neuripsURL(`https://papers.neurips.cc.evil.test/paper/2025/hash/${hash}-Abstract.html`), null);
  assert.equal(Core.neuripsURL('file:///etc/passwd'), null);
});

test('classifies identifiers without treating an unknown URL as a title', () => {
  assert.deepEqual(Core.classify('https://arxiv.org/pdf/2507.03285v3.pdf'), { kind: 'arxiv', value: '2507.03285v3' });
  assert.deepEqual(Core.classify('arXiv:hep-th/9901001v2'), { kind: 'arxiv', value: 'hep-th/9901001v2' });
  assert.deepEqual(Core.classify('https://doi.org/10.52202/085713-1299'), { kind: 'doi', value: '10.52202/085713-1299' });
  assert.deepEqual(Core.classify('https://doi.org/10.48550/arXiv.2507.03285'), { kind: 'arxiv', value: '2507.03285' });
  assert.throws(()=>Core.classify('https://dblp.org/rec/conf/nips/ZhangB25.html'), /暂不支持/);
  assert.throws(() => Core.classify('https://openreview.net/forum?id=foo'), /暂不支持/);
  assert.throws(() => Core.classify(' '), /请输入/);
});

test('Zotero 10 nested word coordinates reconstruct multiline titles and preserve spaces', () => {
  const word = (text, size, space = 1) => [0, 0, 10, 10, size, space, 0, 0, 0, 0, 0, 0, 0, text];
  const lines = [[[word('Memory', 17), word('Mosaics', 17)]], [[word('at', 17), word('scale', 17)]], [[word('Jianyu', 12), word('Zhang', 12)]], [[word('Abstract', 12)]]];
  const data = { pages: [[600, 800, [[[[0, 0, 0, 0, lines]]]]]] };
  assert.equal(Core.pdfHints(data).title, title);
});

test('user screenshot filename recovers title without venue/track tokens', () => {
  assert.equal(Core.titleFromFilename('NeurIPS-2025-memory-mosaics-at-scale-Paper-Conference.pdf'), 'memory mosaics at scale');
  assert.equal(Core.titleFromFilename(`${hash}-Paper-Conference.pdf`), '');
});

test('PDF identifiers are read from the first page header, not abstract/references', () => {
  const data = { pages: [[600, 800, ['Memory Mosaics at scale', 'Jianyu Zhang', 'Abstract', 'We cite arXiv:1706.03762.']], [600, 800, ['References', '10.1234/wrong']]] };
  const hints = Core.pdfHints(data, 'download.pdf');
  assert.equal(hints.title, title);
  assert.equal(hints.arxiv, ''); assert.equal(hints.doi, '');
  assert.equal(Core.pdfHints({ pages: [[0, 0, ['arXiv:2507.03285v1', title, 'Abstract']]] }).arxiv, '2507.03285v1');
});

test('ranking ignores title casing/accents and penalizes unrelated variants', () => {
  assert.equal(Core.similarity('Memory Mosaics at Scale', title), 1);
  assert.equal(Core.similarity('Léon Bottou', 'Leon Bottou'), 1);
  assert.ok(Core.similarity('Attention Is All You Need', 'Tensor Product Attention Is All You Need') < 1);
});

test('official paper metadata remains a conference record without invented DOI', async () => {
  const engine = Core.createEngine({ request: async () => paperHTML.replace(/<meta name="citation_doi"[^>]+>/, ''), parseDocument });
  const result = await engine.resolve({ source: 'NeurIPS', sourceURL: official });
  assert.equal(result.item.itemType, 'conferencePaper');
  assert.equal(result.item.volume, '38'); assert.equal(result.item.DOI, '');
  assert.equal(result.item.creators[1].firstName, 'Léon');
  assert.equal(result.item.conferenceName, 'NeurIPS 2025');
});

test('same-title preprint and formal versions are retained; formal ranks first', async () => {
  const request = async url => {
    if (url.includes('bing.com')) return `<rss><channel><item><title>${title}</title><link>${official}</link></item></channel></rss>`;
    if (url === official) return paperHTML;
    if (url.includes('/papers/search')) return searchHTML;
    if (url.includes('arxiv.org')) return atom;
    return JSON.stringify({ message: { items: [{ title: [title], type: 'posted-content', DOI: '10.9999/other', issued: { 'date-parts': [[2026]] } }] } });
  };
  const engine = Core.createEngine({ request, parseDocument });
  const result = await engine.search(title);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].source, 'NeurIPS');
  assert.equal(result.statuses.some(s => ['DBLP','OpenAlex'].includes(s.source)), false);
  const arxiv = result.candidates.find(c => c.source === 'arXiv');
  assert.equal(arxiv.item.itemType, 'preprint');
  assert.equal(arxiv.item.archiveID, '2507.03285v3');
  assert.equal(arxiv.item.DOI, '10.48550/arXiv.2507.03285');
  assert.match(arxiv.item.extra, /Published version DOI/);
});

test('arXiv DOI identifies the preprint without a revision suffix or published-version DOI', () => {
  const engine = Core.createEngine({request: async () => atom, parseDocument});
  const item = engine.parseArxiv(atom)[0].item;
  assert.equal(item.DOI, '10.48550/arXiv.2507.03285');
  assert.equal(item.archiveID, '2507.03285v3');
  assert.equal(item.extra, 'Published version DOI: 10.52202/085713-1299');
  assert.equal(Core.arxivDOI('hep-th/9901001v2'), '10.48550/arXiv.hep-th/9901001');
  assert.equal(Core.arxivDOI('garbage'), '');
  assert.equal(Core.arxivID('arXiv:2603.09972'), '2603.09972');
});

test('automatic match accepts case/punctuation and one long-word typo with all authors', () => {
  const item = Core.createEngine({request: async () => atom, parseDocument}).parseArxiv(atom)[0].item;
  assert.equal(Core.assessMatch({...item, title:'memory mosaics at scale.', DOI:''}, item).eligible, true);
  assert.equal(Core.assessMatch({...item, title:'Memory Mosaicz at scale'}, item).eligible, true);
  assert.equal(Core.assessMatch({...item, creators:[]}, item).eligible, false);
  assert.equal(Core.assessMatch({...item, creators:item.creators.slice(0,1)}, item).eligible, false);
  assert.equal(Core.assessMatch({...item, creators:[...item.creators].reverse()}, item).eligible, false);
  assert.equal(Core.assessMatch({...item, creators:[{creatorType:'author',firstName:'Other',lastName:'Zhang'},item.creators[1]]}, item).eligible, false);
});

test('automatic match rejects reordered title, negation, numerical changes and version conflicts', () => {
  assert.equal(Core.titleMatches('Attention Is All You Need', 'Is Attention All You Need'), false);
  assert.equal(Core.titleMatches('Memory Mosaics at scale', 'Memory Mosaics are not at scale'), false);
  assert.equal(Core.titleMatches('Experiment123 results', 'Experiment124 results'), false);
  const item = Core.createEngine({request: async () => atom, parseDocument}).parseArxiv(atom)[0].item;
  for (const changes of [{DOI:'10.1234/another'}, {archiveID:'2507.99999'}, {url:'https://arxiv.org/abs/2507.03285v2',archiveID:'2507.03285v2'}, {itemType:'conferencePaper', DOI:'10.52202/085713-1299'}]) {
    assert.equal(Core.assessMatch({...item,...changes},item).eligible,false,JSON.stringify(changes));
  }
});

test('a legacy journal item with the same arXiv URL can fill blanks but type remains a separate decision', () => {
  const item = Core.createEngine({request: async () => atom, parseDocument}).parseArxiv(atom)[0].item;
  const existing = {...item,itemType:'journalArticle',DOI:'',archiveID:''};
  assert.equal(Core.assessMatch(existing,item).eligible,true);
  assert.equal(Core.assessMatch({...existing,url:''},item).eligible,false);
  assert.equal(Core.assessMatch({...existing,itemType:'preprint',url:''},item).eligible,true);
});

test('arXiv fallback succeeds if formal providers fail', async () => {
  const engine = Core.createEngine({ request: async url => { if (url.includes('arxiv.org')) return atom; throw new Error('timeout'); }, parseDocument });
  const result = await engine.search(title);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, 'arXiv');
  assert.equal(result.statuses.filter(s => !s.ok).length, 3);
});

test('arXiv affiliations do not become part of author names', () => {
  const engine = Core.createEngine({ request: async () => atom, parseDocument });
  const withAffiliation = atom.replace('<name>Jianyu Zhang</name>', '<name>Jianyu Zhang</name><arxiv:affiliation>University</arxiv:affiliation>');
  assert.deepEqual(engine.parseArxiv(withAffiliation)[0].item.creators[0], { creatorType: 'author', firstName: 'Jianyu', lastName: 'Zhang' });
});

test('arXiv malformed responses and API errors do not look like empty successful searches', async () => {
  for (const text of ['<html>Access denied</html>', '<feed><entry><id>http://arxiv.org/api/errors#bad</id><summary>bad query</summary></entry></feed>']) {
    const engine = Core.createEngine({ request: async () => text, parseDocument });
    const result = await engine.search('arXiv:2507.03285');
    assert.equal(result.statuses[0].ok, false);
  }
});

test('queries are encoded and only valid metadata is cached', async () => {
  let calls = 0;
  const engine = Core.createEngine({ request: async url => { calls++; assert.ok(url.includes('q=A%26B%20%22title%22')); return '<ul></ul>'; }, parseDocument });
  await engine.search('A&B "title"', { providers: ['NeurIPS'] });
  await engine.search('A&B "title"', { providers: ['NeurIPS'] });
  assert.equal(calls, 1);
});

test('cancelled searches never deliver progress to the UI', async () => {
  const controller = new AbortController(); let progress = 0;
  const engine = Core.createEngine({ request: async () => { controller.abort(); return searchHTML; }, parseDocument });
  await engine.search(title, { providers: ['NeurIPS'], signal: controller.signal, onProgress: () => progress++ });
  assert.equal(progress, 0);
});

test('official BibTeX supplies author accents/pages and rejects translator attachment data', async () => {
  const html = paperHTML.replace('</body>', '<a href="/paper_files/paper/2025/file/' + hash + '-Bibtex.bib">Bibtex</a></body>');
  const engine = Core.createEngine({ request: async url => url.endsWith('.bib') ? '@inproceedings{a}' : html, parseDocument,
    importBibtex: async () => ({ title, itemType: 'bookSection', creators: [{ creatorType: 'author', firstName: 'Léon', lastName: 'Bottou' }, { creatorType: 'editor', lastName: 'Other' }], pages: '38929–38956', attachments: [{ url: 'https://evil.test' }], notes: [{}] }) });
  const result = await engine.resolve({ source: 'NeurIPS', sourceURL: official });
  assert.equal(result.item.itemType, 'conferencePaper'); assert.equal(result.item.creators.length, 1);
  assert.equal(result.item.pages, '38929–38956'); assert.equal(result.item.attachments, undefined);
});

test('arXiv journal DOI discovers a separate formal record without replacing the preprint DOI', async () => {
  const engine=Core.createEngine({parseDocument,request:async url=> url.includes('arxiv.org')?atom:JSON.stringify({message:{title:[title],type:'proceedings-article',DOI:'10.52202/085713-1299','container-title':['NeurIPS 2025']}})});
  const result=await engine.search('arXiv:2507.03285',{providers:['arXiv','Crossref']});
  assert.equal(result.candidates.length,2);
  assert.equal(result.candidates.find(c=>c.source==='arXiv').item.DOI,'10.48550/arXiv.2507.03285');
  assert.equal(result.candidates.find(c=>c.source==='Crossref').publicationStatus,'published');
});

test('a failed source is not retried through a related DOI endpoint during the same search', async () => {
  let crossrefCalls=0;
  const engine=Core.createEngine({parseDocument,request:async url=>{if(url.includes('arxiv.org')) return atom; crossrefCalls++;throw new Error('HTTP 429');}});
  await engine.search(title,{providers:['arXiv','Crossref']});
  assert.equal(crossrefCalls,1);
});

test('same DOI corroboration fills common fields and leaves inter-source conflicts for review', () => {
  const a={source:'Crossref',item:{title,itemType:'journalArticle',DOI:'10.1234/a',pages:'1-5',date:'2025'}};
  const b={source:'Publisher',item:{...a.item,pages:'2-8'}};
  const choice=Core.automaticChoice([b,a]);
  assert.equal(choice.candidate.source,'Publisher');
  assert.deepEqual(choice.candidate.autoExcludedFields,['pages']);
  assert.equal(Core.automaticChoice([a,{...b,item:{...b.item,DOI:'10.1234/b'}}]).candidate,undefined);
});

test('an explicit arXiv revision cannot be automatically filled from an unversioned index copy', () => {
  const item=Core.createEngine({parseDocument,request:async()=>atom}).parseArxiv(atom)[0].item;
  assert.equal(Core.assessMatch(item,{...item,url:'https://arxiv.org/abs/2507.03285',archiveID:'2507.03285'}).eligible,false);
});
