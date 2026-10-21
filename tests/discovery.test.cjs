const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DOMParser}=require('linkedom');
const Core=require('../addon/core.js');
const Discovery=require('../addon/discovery.js');
const parseDocument=(text,type)=>new DOMParser().parseFromString(text,type);
const title='Swin Transformer: Hierarchical Vision Transformer Using Shifted Windows';
const url='https://openaccess.thecvf.com/content/ICCV2021/html/Liu_Swin_Transformer_ICCV_2021_paper.html';
const page=`<html><head><meta name="citation_title" content="${title}"><meta name="citation_author" content="Liu, Ze"><meta name="citation_publication_date" content="2021"><meta name="citation_conference_title" content="International Conference on Computer Vision"><meta name="citation_firstpage" content="10012"><meta name="citation_lastpage" content="10022"></head><body><div id="abstract">A hierarchical vision Transformer.</div></body></html>`;
const rss=links=>`<rss><channel>${links.map(l=>`<item><title>${l.title||'Official repository'}</title><link>${l.url}</link></item>`).join('')}</channel></rss>`;
const emptyCrossref=JSON.stringify({message:{items:[]}});
function engine(responses) {
  const calls=[];
  return {calls,api:Core.createEngine({parseDocument,request:async url=>{
    calls.push(url);
    const value=responses(url);
    if(value instanceof Error) throw value;
    return value;
  }})};
}
function basic(url) {
  if(url.includes('bing.com'))return rss([]);
  if(url.includes('crossref.org'))return emptyCrossref;
  if(url.includes('arxiv.org'))return '<feed></feed>';
  if(url.includes('openreview.net'))return '{"notes":[]}';
  throw new Error('Unexpected source '+url);
}

test('default sources remove OpenAlex and DBLP and no longer have a conference-specific checkbox',()=>{
  assert.deepEqual(Core.PROVIDERS,['Web','Crossref','arXiv']);
  const fs=require('node:fs');
  const html=fs.readFileSync(require('node:path').join(__dirname,'../addon/search.xhtml'),'utf8');
  assert.doesNotMatch(html,/value="(?:OpenAlex|DBLP|NeurIPS)"/);
});

test('web discovery runs first and verifies a CVF page instead of importing its search snippet',async()=>{
  const f=engine(u=>u.includes('bing.com')?rss([{url}]):u===url?page:basic(u));
  const result=await f.api.search(title);
  assert.match(f.calls[0],/bing\.com/);
  const found=result.candidates.find(c=>c.source==='CVF');
  assert.equal(found.item.title,title);
  assert.equal(found.item.creators[0].firstName,'Ze');
  assert.equal(found.item.pages,'10012-10022');
  assert.equal(found.item.DOI,'');
  assert.equal(found.publicationStatus,'published');
  assert.equal(f.calls.some(u=>/openalex|dblp|neurips/.test(u)),false);
});

test('a search hit citing the title in an unrelated paper is rejected by the official page title',async()=>{
  const f=engine(u=>u.includes('bing.com')?rss([{title,url}]):u===url?page.replace(title,'An unrelated paper'):basic(u));
  const result=await f.api.search(title);
  assert.equal(result.candidates.length,0);
});

test('empty web discovery falls back to the specific registered CVF venue and year',async()=>{
  const f=engine(u=>u.includes('crossref.org')?JSON.stringify({message:{items:[{type:'proceedings-article',title:[title],DOI:'10.1109/example',author:[{given:'Ze',family:'Liu'}],issued:{'date-parts':[[2021]]},'container-title':['2021 IEEE/CVF International Conference on Computer Vision (ICCV)']}]}})
    :u.includes('ICCV2021?day=all')?`<a href="${url}">${title}</a>`:u===url?page:basic(u));
  const result=await f.api.search(title);
  assert.ok(result.candidates.some(c=>c.source==='CVF'&&c.item.DOI==='10.1109/example'));
  assert.ok(f.calls.some(u=>u.endsWith('/ICCV2021?day=all')));
  assert.equal(f.calls.some(u=>u.includes('neurips.cc')),false);
});

test('a publisher DOI is not filled from a record with different authors',async()=>{
  const f=engine(u=>u.includes('bing.com')?rss([{url}]):u===url?page:u.includes('crossref.org')?JSON.stringify({message:{items:[{type:'proceedings-article',title:[title],DOI:'10.1234/wrong',author:[{given:'Other',family:'Person'}],issued:{'date-parts':[[2021]]},'container-title':['ICCV 2021']}]}}):basic(u));
  const result=await f.api.search(title);
  assert.equal(result.candidates.find(c=>c.source==='CVF').item.DOI,'');
});

const loraTitle='LoRA: Low-Rank Adaptation of Large Language Models';
const accepted={id:'nZeVKeeFYf9',forum:'nZeVKeeFYf9',content:{title:loraTitle,authors:['Edward J Hu','Yelong Shen'],venue:'ICLR 2022 Poster',venueid:'ICLR.cc/2022/Conference',abstract:'Low rank adaptation.'}};
test('an ICLR schedule identifies the venue and routes old records to the official API 1 search',async()=>{
  const virtual='https://iclr.cc/virtual/2022/poster/6319';
  const f=engine(u=>u.includes('bing.com')?rss([{url:virtual}]):u===virtual?`<h2 class="event-title">${loraTitle}</h2><a href="https://openreview.net/forum?id=nZeVKeeFYf9">OpenReview</a>`
    :u.includes('api.openreview.net')?JSON.stringify({notes:[accepted]}):basic(u));
  const result=await f.api.search(loraTitle);
  const found=result.candidates.find(c=>c.source==='OpenReview');
  assert.equal(found.item.itemType,'conferencePaper');
  assert.equal(found.item.date,'2022');
  assert.equal(found.item.proceedingsTitle,'ICLR 2022');
  assert.equal(found.item.creators.length,2);
  assert.equal(f.calls.some(u=>u.includes('api2.openreview.net')),false);
  assert.equal(f.calls.some(u=>u.startsWith('https://openreview.net/forum')),false);
});

test('OpenReview API 1 is checked only after a successful empty API 2 result',async()=>{
  const f=engine(u=>u.includes('api.openreview.net')?JSON.stringify({notes:[accepted]}):basic(u));
  const result=await f.api.search(loraTitle);
  assert.ok(result.candidates.some(c=>c.source==='OpenReview'));
  assert.ok(f.calls.findIndex(u=>u.includes('api2.openreview.net'))<f.calls.findIndex(u=>u.includes('api.openreview.net')));
});

test('an OpenReview access failure never triggers the other API host as a bypass',async()=>{
  const f=engine(u=>u.includes('api2.openreview.net')?new Error('HTTP 403'):basic(u));
  const result=await f.api.search(loraTitle);
  assert.equal(result.statuses.find(s=>s.source==='OpenReview').ok,false);
  assert.equal(f.calls.some(u=>u.includes('api.openreview.net')),false);
});

test('API 2 accepted notes, rejected notes, review replies and imported DBLP records stay distinct',()=>{
  const d=Discovery.create({parseDocument,clean:Core.clean,author:Core.author,titleMatches:Core.titleMatches});
  const note={id:'modern',forum:'modern',content:{title:{value:loraTitle},authors:{value:['Ada Lovelace']},venue:{value:'ICLR 2025 Oral'},venueid:{value:'ICLR.cc/2025/Conference'}}};
  assert.equal(d.openreviewRecord(note).publicationStatus,'published');
  const withdrawn={...note,content:{...note.content,venue:{value:'ICLR 2025 Withdrawn Submission'}}};
  assert.equal(d.openreviewRecord(withdrawn).publicationStatus,'unverified');
  assert.equal(d.openreviewRecord({...note,replyto:'other'}),null);
  assert.equal(d.openreviewRecord({...note,invitations:['DBLP.org/-/Record']}),null);
});

test('a TMLR acceptance is a journal record rather than a conference or preprint',()=>{
  const d=Discovery.create({parseDocument,clean:Core.clean,author:Core.author,titleMatches:Core.titleMatches});
  const note={...accepted,pdate:1704955674482,content:{...accepted.content,venue:'Accepted by TMLR',venueid:'TMLR'}};
  const result=d.openreviewRecord(note);
  assert.equal(result.item.itemType,'journalArticle');
  assert.equal(result.publicationStatus,'published');
  assert.equal(result.item.publicationTitle,'Transactions on Machine Learning Research');
  assert.equal(result.item.date,'2024');
  assert.equal(d.openreviewRecord({...note,content:{...note.content,venue:'Submitted to TMLR'}}).publicationStatus,'unverified');
});

test('generic publisher citation metadata also discovers a journal outside the named conferences',async()=>{
  const journalURL='https://www.nature.com/articles/example';
  const html=page.replace('citation_conference_title','citation_journal_title').replace('International Conference on Computer Vision','Nature');
  const f=engine(u=>u.includes('bing.com')?rss([{url:journalURL}]):u===journalURL?html:basic(u));
  const result=await f.api.search(title);
  assert.equal(result.candidates[0].item.itemType,'journalArticle');
  assert.equal(result.candidates[0].item.publicationTitle,'Nature');
  assert.equal(f.calls.some(u=>u.includes('openreview.net')||u.includes('neurips.cc')),false);
});

test('a publisher outside the adapter host list can supply standard journal citation metadata',async()=>{
  const journalURL='https://www.jmlr.org/papers/v25/example.html';
  const html=page.replace('citation_conference_title','citation_journal_title').replace('International Conference on Computer Vision','Journal of Machine Learning Research');
  const f=engine(u=>u.includes('bing.com')?rss([{url:journalURL,title}]):u===journalURL?html:basic(u));
  const result=await f.api.search(title);
  assert.equal(result.candidates[0].item.publicationTitle,'Journal of Machine Learning Research');
  assert.equal(result.candidates[0].item.itemType,'journalArticle');
});

test('publisher links normalize PDFs and reject local paths, deceptive domains and embedded credentials',()=>{
  assert.equal(Discovery.pageURL(url.replace('/html/','/papers/').replace('.html','.pdf')),url);
  assert.equal(Discovery.pageURL('https://openaccess.thecvf.com.evil.test/content/ICCV2021/html/x.html'),null);
  assert.equal(Discovery.pageURL('http://127.0.0.1/secret'),null);
  assert.equal(Discovery.pageURL('https://user:password@www.nature.com/articles/x'),null);
  assert.equal(Discovery.pageURL('file:///C:/private'),null);
});
