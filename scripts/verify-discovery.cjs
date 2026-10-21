const fs=require('node:fs');
const {DOMParser}=require('linkedom');
const Core=require('../addon/core.js');
const manifest=require('../addon/manifest.json');
const output=`docs/general-search-results-${manifest.version}.json`;
const report={at:new Date().toISOString(),version:manifest.version,runtime:'Node.js',cases:[]};
const requests=[];
const engine=Core.createEngine({
  request:async(url,{signal})=>{
    requests.push(url);
    const res=await fetch(url,{signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(18000)])});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  parseDocument:(text,type)=>new DOMParser().parseFromString(text,type)
});
const cases=[
  ['LoRA: Low-Rank Adaptation of Large Language Models','conferencePaper',/ICLR 2022/,'OpenReview'],
  ['Swin Transformer: Hierarchical Vision Transformer Using Shifted Windows','conferencePaper',/Computer Vision|ICCV/,'CVF'],
  ['A Simple Framework for Contrastive Learning of Visual Representations','conferencePaper',/Machine Learning/,'Publisher'],
  ['BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding','conferencePaper',/North American|NAACL/],
  ['Highly accurate protein structure prediction with AlphaFold','journalArticle',/Nature/],
  ['DINOv2: Learning Robust Visual Features without Supervision','journalArticle',/Transactions on Machine Learning Research/,'OpenReview']
];
(async()=>{
  for(const [title,type,venue,source] of cases){
    const start=requests.length;
    const result=await engine.search(title);
    const matches=result.candidates.filter(c=>Core.titleMatches(title,c.item.title)&&c.item.itemType===type&&c.publicationStatus==='published');
    const preferred=matches.find(c=>(!source||c.source===source)&&venue.test(c.item.proceedingsTitle||c.item.publicationTitle||''));
    report.cases.push({title,pass:!!preferred,statuses:result.statuses,discoveryURLs:result.discoveryURLs,summary:result.publicationSummary,
      requests:requests.slice(start),matchingRecords:matches,preferred});
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({title,pass:!!preferred,source:preferred?.source,venue:preferred?.item.proceedingsTitle||preferred?.item.publicationTitle,statuses:result.statuses}));
  }
  report.pass=report.cases.every(c=>c.pass)&&!requests.some(url=>/openalex\.org|dblp\.org/.test(url));
  report.removedSourcesNotRequested=!requests.some(url=>/openalex\.org|dblp\.org/.test(url));
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(!report.pass)process.exitCode=1;
})().catch(e=>{report.pass=false;report.error=e.stack;fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.error(e);process.exitCode=1;});
