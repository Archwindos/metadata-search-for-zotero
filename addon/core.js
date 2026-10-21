/* Shared search logic. No Zotero or Node dependency; transports/parsers are injected. */
var MetadataCore = (() => {
  "use strict";
  const Discovery = typeof MetadataDiscovery !== "undefined" ? MetadataDiscovery : require("./discovery.js");
  const PROVIDERS = ["Web", "Crossref", "arXiv"];
  const SOURCE_PRIORITY = ["CVF", "OpenReview", "NeurIPS", "Publisher", "Crossref", "arXiv"];
  const NEURIPS_HOST = /^(papers|proceedings)\.n(eur)?ips\.cc$/i;
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const normalizeTitle = value => clean(value).normalize("NFKD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  function similarity(a, b) {
    a = normalizeTitle(a); b = normalizeTitle(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const x = new Set(a.split(" ")), y = new Set(b.split(" "));
    return 2 * [...x].filter(word => y.has(word)).length / (x.size + y.size);
  }

  function arxivID(value) {
    const match = clean(value).match(/^(?:https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/|(?:https?:\/\/doi\.org\/)?10\.48550\/arxiv\.|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7}))(?:v\d+)?(?:\.pdf)?$/i);
    return match ? match[1].toLowerCase() : "";
  }

  function arxivDOI(value) {
    const id = arxivID(value);
    return id ? `10.48550/arXiv.${id}` : "";
  }

  // Matching for writes is deliberately stricter than the bag-of-words display ranking.
  function titleMatches(a, b) {
    const x = normalizeTitle(a).split(" "), y = normalizeTitle(b).split(" ");
    if (!x[0] || x.length !== y.length) return false;
    let typos = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      // Permit a single letter substitution in a long word, not added words/numbers/negation.
      if (x[i].length < 6 || x[i].length !== y[i].length || /\d/.test(x[i] + y[i])) return false;
      const changes = [...x[i]].filter((c, j) => c !== y[i][j]).length;
      if (changes !== 1 || ++typos > 1) return false;
    }
    return true;
  }

  function assessMatch(existing, incoming) {
    const fail = reason => ({ eligible: false, reason });
    if (!titleMatches(existing.title, incoming.title)) return fail("标题不够一致");
    const names = item => (item.creators || []).filter(c => c.creatorType === "author")
      .map(c => `${c.fieldMode || 0}:${normalizeTitle(c.firstName)}|${normalizeTitle(c.lastName)}`);
    const a = names(existing), b = names(incoming);
    if (!a.length || a.length !== b.length || a.some((name, i) => name !== b[i])) return fail("完整作者列表不一致或缺失");
    const doi = item => clean(item.DOI).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
    if (doi(existing) && doi(incoming) && doi(existing) !== doi(incoming)) return fail("DOI 冲突");
    const ids = item => [...new Set([item.archiveID, item.url, item.DOI,
      clean(item.extra).match(/(?:^|\s)arxiv:\s*((?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7})(?:v\d+)?)/i)?.[1]]
      .map(arxivID).filter(Boolean))];
    const x = ids(existing), y = ids(incoming);
    if (x.length > 1 || y.length > 1 || (x.length && y.length && x[0] !== y[0])) return fail("arXiv 编号冲突");
    const sameArxiv = x.length && y.length && x[0] === y[0];
    const revision = item => [item.archiveID, item.url].filter(v => arxivID(v)).map(v => clean(v).match(/v(\d+)(?:\.pdf)?$/i)?.[1]).find(Boolean);
    if (sameArxiv && revision(existing) && !revision(incoming)) return fail("来源未指明对应的 arXiv 修订版本");
    if (sameArxiv && revision(existing) && revision(incoming) && revision(existing) !== revision(incoming)) return fail("arXiv 修订版本不同");
    const sameDOI = doi(existing) && doi(existing) === doi(incoming);
    if (incoming.itemType === "preprint" && doi(existing) && !arxivID(doi(existing)) && !sameDOI) return fail("现有 DOI 指向其他发表版本");
    if (existing.itemType !== incoming.itemType && !(sameArxiv && incoming.itemType === "preprint")) return fail("文献类型或版本不同");
    // Never add a published DOI to a preprint solely on the basis of title/authors.
    if ((x.length && !y.length || y.length && !x.length && existing.itemType !== "preprint") && !sameDOI) return fail("预印本版本未能核对");
    const year = item => clean(item.date).match(/^\d{4}/)?.[0];
    if (!sameArxiv && !sameDOI && year(existing) && year(incoming) && year(existing) !== year(incoming)) return fail("年份不同且缺少共同标识符");
    return { eligible: true, reason: "标题、完整作者列表及版本信息一致" };
  }

  function author(name, comma = false) {
    name = clean(name);
    if (comma && name.includes(",")) {
      const [lastName, ...rest] = name.split(",");
      return { creatorType: "author", firstName: clean(rest.join(",")), lastName: clean(lastName) };
    }
    const parts = name.split(" ");
    return { creatorType: "author", firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
  }

  function neuripsURL(input) {
    let url;
    try { url = new URL(input); } catch { return null; }
    if (!NEURIPS_HOST.test(url.hostname) || !["https:", "http:"].includes(url.protocol)) return null;
    // Accept old /paper/ paths and current /paper_files/paper/ paths, including PDFs.
    const match = url.pathname.match(/\/(?:paper_files\/)?paper\/(\d{4})\/(?:hash|file)\/([a-f\d]{32})-(?:Abstract|Paper)(-Conference|-Datasets_and_Benchmarks)?\.(?:html|pdf)$/i);
    if (!match) return null;
    return `https://proceedings.neurips.cc/paper_files/paper/${match[1]}/hash/${match[2]}-Abstract${match[3] || ""}.html`;
  }

  function classify(input) {
    input = clean(input);
    if (!input) throw new Error("请输入论文标题、DOI、arXiv ID 或论文链接。");
    const nips = neuripsURL(input);
    if (nips) return { kind: "neurips", value: nips };
    let match = input.match(/^(?:https?:\/\/(?:www\.)?(?:export\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7})(?:v\d+)?)(?:\.pdf)?(?:[?#].*)?$/i);
    if (match) return { kind: "arxiv", value: match[1] };
    match = input.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.48550\/arxiv\.((?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7})(?:v\d+)?)$/i);
    if (match) return { kind: "arxiv", value: match[1] };
    match = input.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i);
    if (match) return { kind: "doi", value: match[1] };
    const publisher = Discovery.pageURL(input);
    if (publisher && new URL(publisher).hostname !== "openreview.net") return { kind: "publisher", value: publisher };
    if (/^https?:\/\//i.test(input)) {
      throw new Error("此链接暂不支持。请粘贴论文标题，或使用支持的会议官网、出版社、arXiv、doi.org 链接。OpenReview 链接请改用论文标题。");
    }
    return { kind: "title", value: input };
  }

  function titleFromFilename(name) {
    let title = clean(name).replace(/\.pdf$/i, "")
      .replace(/^(?:neurips|nips)[-_ ]\d{4}[-_ ]/i, "")
      .replace(/[-_ ](?:Paper)(?:[-_ ]Conference|[-_ ]Datasets_and_Benchmarks)?$/i, "")
      .replace(/[_-]+/g, " ").trim();
    return /^[a-f\d]{32}$/i.test(title.replace(/ /g, "")) || /^(?:full text|pdf|download|paper)$/i.test(title) ? "" : title;
  }

  function pdfHints(data, filename = "") {
    // Zotero 10: nested blocks/lines/words; word[13] is text, [4] font size, [5] spaceAfter.
    const lines = [];
    const isWord = value => Array.isArray(value) && value.length === 14
      && typeof value[13] === "string" && value.slice(0, 13).every(n => typeof n === "number");
    const walk = value => {
      if (typeof value === "string") lines.push({ text: clean(value), fontSize: 0 });
      else if (Array.isArray(value) && value.length && value.every(isWord)) {
        lines.push({ text: clean(value.map(w => w[13] + (w[5] ? " " : "")).join("")),
          fontSize: Math.max(...value.map(w => w[4])) });
      }
      else if (Array.isArray(value)) value.forEach(walk);
    };
    walk(data?.pages?.[0]?.[2] || []);
    const text = lines.map(line => line.text).filter(Boolean).join("\n");
    // Only inspect the first page header, never DOI/arXiv IDs in the references.
    const header = text.split(/\bAbstract\b/i)[0].slice(0, 1800);
    const arxiv = header.match(/arxiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z][a-z.-]+\/\d{7})(?:v\d+)?)/i)?.[1];
    const doi = header.match(/\b10\.\d{4,9}\/[^\s<>"']+/i)?.[0]?.replace(/[.,;)]+$/, "");
    const abstractAt = lines.findIndex(line => /^abstract\b/i.test(line.text));
    const titleLines = lines.slice(0, abstractAt >= 0 ? abstractAt : 20)
      .filter(line => line.text && !/arxiv:|https?:|^\d+$|@|^(?:neurips|nips|proceedings|published as|under review)/i.test(line.text));
    const filenameTitle = titleFromFilename(filename);
    const largest = Math.max(0, ...titleLines.slice(0, 20).map(line => line.fontSize));
    const start = largest ? titleLines.findIndex(line => line.fontSize === largest) : 0;
    const titleParts = [];
    for (let i = start; i < titleLines.length && titleParts.length < 3; i++) {
      if (largest ? titleLines[i].fontSize < largest * 0.94 : i > start) break;
      titleParts.push(titleLines[i].text);
    }
    const title = clean(titleParts.join(" ")) || filenameTitle;
    return { title, filenameTitle, arxiv: arxiv || "", doi: doi || "" };
  }

  function crossrefItem(work, stripHTML = clean) {
    const itemType = work.type === "proceedings-article" ? "conferencePaper"
      : work.type === "posted-content" ? "preprint"
      : work.type === "book-chapter" ? "bookSection"
      : ["book", "monograph", "edited-book"].includes(work.type) ? "book"
      : work.type === "journal-article" ? "journalArticle" : "document";
    const item = {
      itemType, title: clean(work.title?.[0]),
      creators: (work.author || []).map(a => a.name
        ? { creatorType: "author", lastName: a.name, fieldMode: 1 }
        : { creatorType: "author", firstName: a.given || "", lastName: a.family || "" }),
      date: (work.issued?.["date-parts"]?.[0] || []).join("-"),
      DOI: work.DOI || "", url: work.URL || "", publisher: work.publisher || "",
      pages: work.page || "", volume: work.volume || "", abstractNote: stripHTML(work.abstract || ""),
      libraryCatalog: "Crossref"
    };
    const venue = work["container-title"]?.[0] || "";
    if (itemType === "conferencePaper") Object.assign(item, { proceedingsTitle: venue, conferenceName: clean(work.event?.name) });
    else if (itemType === "bookSection") item.bookTitle = venue;
    else if (itemType === "journalArticle") Object.assign(item, { publicationTitle: venue, issue: work.issue || "", ISSN: work.ISSN?.[0] || "" });
    else if (itemType === "preprint") item.repository = work.publisher || "";
    return item;
  }

  function publicationStatus(item) {
    if (item.itemType === "preprint") return "preprint";
    if (item.itemType === "conferencePaper" && (item.proceedingsTitle || item.conferenceName)) return "published";
    if (item.itemType === "journalArticle" && item.publicationTitle) return "published";
    return "unverified";
  }

  // Group matching records by DOI only; never collapse a preprint into its journal/conference version.
  function automaticChoice(matches) {
    if (matches.length === 1) return { candidate: matches[0] };
    if (!matches.length) return { reason: "没有唯一且标题、完整作者及版本一致的候选，请手动核对。" };
    const doi = result => clean(result.item.DOI).toLowerCase();
    const key = doi(matches[0]);
    if (!key || matches.some(r => doi(r) !== key || r.item.itemType !== matches[0].item.itemType)) {
      return { reason: "多个不同版本符合匹配条件，请手动选择版本。" };
    }
    const rank = source => SOURCE_PRIORITY.includes(source) ? SOURCE_PRIORITY.indexOf(source) : SOURCE_PRIORITY.length;
    const ordered = [...matches].sort((a,b) => rank(a.source) - rank(b.source));
    const chosen = ordered[0];
    const conflicts = new Set();
    for (const name of Object.keys(chosen.item)) {
      if (["itemType", "creators", "libraryCatalog", "title", "DOI"].includes(name)) continue;
      const values = matches.map(r => clean(r.item[name])).filter(Boolean);
      const normalize = value => name === "archiveID" ? arxivID(value) || value
        : name === "url" && arxivID(value) ? arxivID(value) : value;
      if (new Set(values.map(normalize)).size > 1) conflicts.add(name);
    }
    return { candidate: { ...chosen, autoExcludedFields: [...conflicts],
      warnings: [...(chosen.warnings || []), ...(conflicts.size ? [`同一 DOI 的来源字段存在差异，以下字段不自动填入：${[...conflicts].join("、")}。可分别选择来源核对。`] : [])] } };
  }

  function createEngine({ request, parseDocument, importBibtex }) {
    const cache = new Map();
    const stripHTML = html => html ? clean(parseDocument(html, "text/html").documentElement?.textContent) : "";
    const parseJSON = text => {
      if (/anubis_challenge|not a bot|captcha|verify you are human/i.test(text)) {
        throw new Error("需要网站人机验证；未绕过验证。可暂时关闭此来源。");
      }
      try { return JSON.parse(text); } catch { throw new Error("来源未返回有效的 JSON 元数据。"); }
    };
    async function get(url, signal) {
      if (signal?.aborted) throw new Error("已取消");
      const cached = cache.get(url);
      if (cached && Date.now() - cached.time < 600000) return cached.text;
      const text = await request(url, { signal });
      if (!/anubis_challenge|not a bot|captcha/i.test(text)) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(url, { text, time: Date.now() });
      }
      return text;
    }
    const candidate = (source, item, sourceURL, extra = {}) => ({ source, item, sourceURL, publicationStatus: publicationStatus(item), ...extra });

    function parseArxiv(text) {
      const doc = parseDocument(text, "text/xml");
      if (doc.getElementsByTagName("parsererror").length || !doc.getElementsByTagName("feed").length) throw new Error("arXiv 返回的 XML 无法解析。");
      const entries = [...doc.getElementsByTagName("entry")];
      const error = entries.find(e => e.querySelector("id")?.textContent.includes("/errors"));
      if (error) throw new Error("arXiv 拒绝此查询：" + clean(error.querySelector("summary")?.textContent));
      return entries
        .map(e => {
          const field = name => clean(e.getElementsByTagName(name)[0]?.textContent);
          const id = field("id").replace(/^http:/, "https:");
          const arxivID = id.split("/abs/")[1] || "";
          const item = {
            itemType: "preprint", title: field("title"), date: field("published").slice(0, 10),
            creators: [...e.getElementsByTagName("author")].map(a => author(a.getElementsByTagName("name")[0]?.textContent)),
            abstractNote: field("summary"), url: id, repository: "arXiv",
            archiveID: arxivID, DOI: arxivDOI(arxivID), libraryCatalog: "arXiv"
          };
          // A related journal DOI is a different manifestation; preserve it as a note.
          const relatedDOI = field("arxiv:doi");
          if (relatedDOI) item.extra = `Published version DOI: ${relatedDOI}`;
          const journalReference = field("arxiv:journal_ref");
          if (journalReference) item.extra = [item.extra, `Journal reference: ${journalReference}`].filter(Boolean).join("\n");
          return candidate("arXiv", item, id, { resolved: true, relatedDOI });
        });
    }

    async function searchNeurips(title, signal) {
      const url = `https://proceedings.neurips.cc/papers/search?q=${encodeURIComponent(title)}`;
      const text = await get(url, signal);
      if (/anubis_challenge|not a bot|captcha/i.test(text)) throw new Error("NeurIPS 需要网站人机验证。");
      const doc = parseDocument(text, "text/html");
      const seen = new Set();
      return [...doc.querySelectorAll('li a[href*="/paper/"]')].map(a => {
        const sourceURL = neuripsURL(new URL(a.getAttribute("href"), url).href);
        if (!sourceURL || seen.has(sourceURL)) return null;
        seen.add(sourceURL);
        const year = sourceURL.match(/paper\/(\d{4})/)[1];
        return candidate("NeurIPS", { itemType: "conferencePaper", title: clean(a.textContent), date: year, proceedingsTitle: "Advances in Neural Information Processing Systems" }, sourceURL);
      }).filter(Boolean);
    }

    async function searchCrossref(title, signal) {
      const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=12`;
      const json = parseJSON(await get(url, signal));
      return (json.message?.items || []).map(w => candidate("Crossref", crossrefItem(w, stripHTML), `https://doi.org/${w.DOI}`, { resolved: true }))
        .filter(c => c.item.itemType !== "document");
    }

    async function lookupCrossref(doi, signal) {
      const json = parseJSON(await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, signal));
      if (!json.message?.title?.[0]) throw new Error("Crossref 没有返回完整文献记录。");
      return candidate("Crossref", crossrefItem(json.message, stripHTML), `https://doi.org/${doi}`, { resolved: true });
    }

    async function searchArxiv(title, signal) {
      const words = clean(title).replace(/["\\]/g, " ").split(/\s+/).filter(Boolean);
      // Full phrase title search preserves specificity; the user can shorten the query.
      const query = `ti:"${words.join(" ")}"`;
      return parseArxiv(await get(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=8`, signal));
    }

    async function resolveNeurips(result, signal) {
      const url = neuripsURL(result.sourceURL);
      if (!url) throw new Error("无效的 NeurIPS 论文链接。");
      const doc = parseDocument(await get(url, signal), "text/html");
      const meta = name => clean(doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content"));
      const year = url.match(/paper\/(\d{4})/)[1];
      const abstractSection = [...doc.querySelectorAll(".paper-section")]
        .find(section => /abstract/i.test(section.querySelector("h2,h3,h4")?.textContent || ""));
      const abstractText = abstractSection
        ? clean([...abstractSection.querySelectorAll("p")].map(p => p.textContent).filter(Boolean).join(" "))
        : clean(doc.querySelector(".paper-abstract")?.textContent);
      let item = {
        itemType: "conferencePaper", title: meta("citation_title"),
        creators: [...doc.querySelectorAll('meta[name="citation_author"]')].map(a => author(a.getAttribute("content"), true)),
        proceedingsTitle: meta("citation_conference_title") || meta("citation_journal_title") || "Advances in Neural Information Processing Systems",
        date: meta("citation_publication_date") || year, volume: meta("citation_volume"),
        DOI: meta("citation_doi"), pages: [meta("citation_firstpage"), meta("citation_lastpage")].filter(Boolean).join("-"),
        abstractNote: abstractText,
        conferenceName: `NeurIPS ${year}`, url, libraryCatalog: "NeurIPS Proceedings"
      };
      const warnings = [];
      const bibLink = doc.querySelector('a[href$="-Bibtex.bib"], a[href$="/bibtex"]');
      if (bibLink && importBibtex) {
        const bibURL = new URL(bibLink.getAttribute("href"), url).href;
        if (!NEURIPS_HOST.test(new URL(bibURL).hostname)) throw new Error("NeurIPS BibTeX 链接指向了不受支持的来源。");
        try {
          const imported = await importBibtex(await get(bibURL, signal));
          if (!imported?.title) throw new Error("空的 BibTeX 条目");
          if (imported.date && item.date && imported.date.slice(0, 4) !== item.date.slice(0, 4)) {
            warnings.push(`官方引用记录的年份为 ${imported.date}，页面发布日期为 ${item.date}。请核对引用日期。`);
          }
          // Official BibTeX is authoritative for bibliography; embedded data supplies omissions.
          for (const [key, value] of Object.entries(imported)) {
            if (value && (!Array.isArray(value) || value.length)) item[key] = value;
          }
          item.creators = item.creators.filter(c => c.creatorType === "author");
          Object.assign(item, { itemType: "conferencePaper", url, libraryCatalog: "NeurIPS Proceedings", conferenceName: `NeurIPS ${year}` });
          if (meta("citation_volume")) item.volume = meta("citation_volume");
        } catch (e) {
          if (signal?.aborted) throw e;
          warnings.push("官方 BibTeX 获取失败，使用官方页面的嵌入元数据。" + e.message);
        }
      }
      if (!item.title || !item.creators.length) throw new Error("NeurIPS 页面没有完整的标题及作者元数据。");
      // Keep translator-specific keys out of item.fromJSON() and library writes.
      delete item.attachments; delete item.notes; delete item.tags; delete item.itemID;
      return candidate("NeurIPS", item, url, { resolved: true, warnings });
    }

    async function search(input, { providers = PROVIDERS, signal, onProgress = () => {}, discoverPublished = true } = {}) {
      const query = classify(input);
      const state = { candidates: [], statuses: [], query, discoveryURLs: [], phase: "discovery" };
      const discovery = Discovery.create({get,parseDocument,clean,author,titleMatches,similarity});
      const seen = new Set(), unavailable = new Set();
      let referenceTitle = query.kind === "title" ? query.value : "", webLinks = [], openreviewYear;
      const family = source => source.includes("Crossref") ? "Crossref" : source.includes("NeurIPS") ? "NeurIPS"
        : source.includes("CVF") ? "CVF" : source.includes("OpenReview") ? "OpenReview" : source;
      const runJobs = tasks => Promise.all(tasks.filter(([source]) => !unavailable.has(family(source))).map(async ([source,run]) => {
        try {
          const results = await run();
          for (const result of results) {
            if (!result?.item.title) continue;
            result.score = referenceTitle ? similarity(referenceTitle,result.item.title) : 1;
            if (referenceTitle && result.score < .35) continue;
            const key = `${result.source}:${result.sourceURL}`;
            if (seen.has(key)) continue;
            seen.add(key); state.candidates.push(result);
          }
          state.statuses.push({source,ok:true,count:source === "Web" ? webLinks.length : results.length});
        } catch(e) {
          unavailable.add(family(source));
          state.statuses.push({source,ok:false,message:e.message || String(e)});
        }
        const ranks={published:0,preprint:1,unverified:2};
        const sourceRank = name => SOURCE_PRIORITY.includes(name) ? SOURCE_PRIORITY.indexOf(name) : SOURCE_PRIORITY.length;
        state.candidates.sort((a,b)=>b.score-a.score || ranks[a.publicationStatus]-ranks[b.publicationStatus] || sourceRank(a.source)-sourceRank(b.source));
        if (!signal?.aborted) onProgress(state);
      }));
      const webSearch = () => runJobs([["Web",async()=>{
        webLinks=await discovery.discover(referenceTitle,signal);
        state.discoveryURLs=webLinks.map(l=>l.url);
        return [];
      }]]);
      const titleJobs = () => [
        ...(providers.includes("Crossref") ? [["Crossref",()=>searchCrossref(referenceTitle,signal)]] : []),
        ...(providers.includes("arXiv") ? [["arXiv",()=>searchArxiv(referenceTitle,signal)]] : [])
      ];
      if (query.kind === "title") {
        if (!providers.some(p=>[...PROVIDERS,"NeurIPS"].includes(p))) throw new Error("请至少选择一个检索来源。");
        if (providers.includes("Web")) await webSearch();
        if (signal?.aborted) return state;
        state.phase="registry";
        await runJobs(titleJobs());
      } else if (query.kind === "neurips") {
        await runJobs([["NeurIPS",async()=>[await resolveNeurips(candidate("NeurIPS",{},query.value),signal)]]]);
      } else if (query.kind === "arxiv") {
        await runJobs([["arXiv",async()=>parseArxiv(await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(query.value)}`,signal))]]);
        referenceTitle=state.candidates[0]?.item.title || "";
        if (discoverPublished && referenceTitle) {
          if (providers.includes("Web")) await webSearch();
          if (!signal?.aborted && providers.includes("Crossref")) await runJobs([["Crossref",()=>searchCrossref(referenceTitle,signal)]]);
        }
      } else if (query.kind === "doi") {
        await runJobs([["Crossref",async()=>[await lookupCrossref(query.value,signal)]]]);
        referenceTitle=state.candidates[0]?.item.title || "";
      } else if (query.kind === "publisher") {
        if (/\/virtual\//.test(new URL(query.value).pathname)) {
          await runJobs([["会议日程",async()=>{
            const page=await discovery.virtualPage(query.value,signal);
            referenceTitle=page.title;webLinks=page.links.map(url=>({url}));
            openreviewYear=new URL(query.value).pathname.match(/virtual\/(\d{4})/)?.[1];
            return [];
          }]]);
        } else {
          await runJobs([["出版社官网",async()=>[await discovery.publisher(query.value,"",signal)]]]);
          referenceTitle=state.candidates[0]?.item.title || "";
        }
        if (referenceTitle && providers.includes("Crossref")) await runJobs([["Crossref",()=>searchCrossref(referenceTitle,signal)]]);
      }
      if (signal?.aborted) return state;
      const formalMatches = () => state.candidates.filter(c=>c.publicationStatus === "published" && (!referenceTitle || titleMatches(referenceTitle,c.item.title)));
      if (referenceTitle && (providers.includes("Web") && (query.kind === "title" || discoverPublished) || query.kind === "publisher")) {
        state.phase="official";
        // The web result locates the publisher. Its snippet is not a bibliographic record.
        for (const link of webLinks.filter(l=>/\/virtual\//.test(new URL(l.url).pathname)).slice(0,2)) {
          await runJobs([["会议日程",async()=>{
            const page=await discovery.virtualPage(link.url,signal);
            if (!titleMatches(referenceTitle,page.title)) return [];
            openreviewYear=new URL(link.url).pathname.match(/virtual\/(\d{4})/)?.[1];
            webLinks.push(...page.links.map(url=>({url})));
            return [];
          }]]);
        }
        if (signal?.aborted) return state;
        const officialURLs=[...new Set(webLinks.map(l=>l.url))];
        await runJobs(officialURLs.filter(url=>!new URL(url).hostname.endsWith("openreview.net") && !/\/virtual\//.test(new URL(url).pathname)).slice(0,3).map(url=>{
          const source=neuripsURL(url)?"NeurIPS 官网":new URL(url).hostname==="openaccess.thecvf.com"?"CVF 官网":`出版社官网 ${new URL(url).hostname}`;
          return [source,async()=>[neuripsURL(url)?await resolveNeurips(candidate("NeurIPS",{},url),signal):await discovery.publisher(url,referenceTitle,signal)]];
        }));
        if (signal?.aborted) return state;
        if (officialURLs.some(url=>new URL(url).hostname==="openreview.net") || !formalMatches().length) {
          await runJobs([["OpenReview",()=>discovery.openreview(referenceTitle,{year:openreviewYear,signal})]]);
        }
        if (signal?.aborted) return state;
        // If web indexing misses a page, a registered venue/year directs an exact official-index lookup.
        const cvfVenues=new Map();
        for (const record of formalMatches()) {
          const venue=record.item.conferenceName || record.item.proceedingsTitle || "";
          const acronym=/\bICCV\b|International Conference on Computer Vision/i.test(venue)?"ICCV"
            :/\bCVPR\b|Computer Vision and Pattern Recognition/i.test(venue)?"CVPR":/\bWACV\b|Winter Conference on Applications of Computer Vision/i.test(venue)?"WACV":"";
          const year=clean(record.item.date).match(/^20\d{2}/)?.[0];
          if(acronym && year && !state.candidates.some(c=>c.source==="CVF" && titleMatches(referenceTitle,c.item.title))) cvfVenues.set(acronym+year,{acronym,year});
        }
        for(const {acronym,year} of [...cvfVenues.values()].slice(0,1)) await runJobs([["CVF 官方索引",async()=>{
          const links=await discovery.cvf(referenceTitle,acronym,year,signal);
          const records=[];for(const url of links) records.push(await discovery.publisher(url,referenceTitle,signal));return records;
        }]]);
        if (formalMatches().some(c=>/neurips|nips|neural information processing/i.test(c.item.proceedingsTitle || ""))
          && !state.candidates.some(c=>c.source==="NeurIPS" && titleMatches(referenceTitle,c.item.title))) {
          await runJobs([["NeurIPS 官网",()=>searchNeurips(referenceTitle,signal)]]);
        }
      }
      if (signal?.aborted) return state;
      if (providers.includes("NeurIPS") && referenceTitle) await runJobs([["NeurIPS",()=>searchNeurips(referenceTitle,signal)]]);
      if (discoverPublished && referenceTitle && providers.includes("Crossref")) {
        const related=[...new Set(state.candidates.filter(c=>titleMatches(referenceTitle,c.item.title) && c.relatedDOI).map(c=>c.relatedDOI))].slice(0,2);
        await runJobs(related.filter(doi=>!state.candidates.some(c=>clean(c.item.DOI).toLowerCase()===doi.toLowerCase()))
          .map(doi=>["正式版 DOI / Crossref",async()=>[await lookupCrossref(doi,signal)]]));
      }
      // Supplement an official page's omitted DOI only with a unique full-author/version match.
      for(const record of state.candidates.filter(c=>["CVF","Publisher","OpenReview"].includes(c.source) && c.publicationStatus==="published" && !c.item.DOI)) {
        const matches=state.candidates.filter(c=>c.source==="Crossref" && assessMatch(record.item,c.item).eligible && c.item.DOI);
        const dois=[...new Set(matches.map(c=>c.item.DOI.toLowerCase()))];
        if(dois.length===1) {record.item.DOI=matches[0].item.DOI;record.verifiedBy="Crossref DOI + official full authors";}
      }
      const venues=[...new Set(formalMatches().map(c=>c.item.proceedingsTitle || c.item.publicationTitle || c.item.conferenceName).filter(Boolean))];
      state.phase="complete";
      state.publicationSummary=venues.length?`找到候选发表记录：${venues.slice(0,3).join("；")}。请核对作者与版本。`
        :"当前来源未找到对应的正式发表记录；这不能证明论文尚未发表。";
      return state;
    }

    async function resolve(result, { signal } = {}) {
      if (result.resolved) return result;
      if (result.source === "NeurIPS") return resolveNeurips(result, signal);
      return result;
    }

    return { search, resolve, resolveNeurips, parseArxiv, searchNeurips };
  }

  return { PROVIDERS, clean, normalizeTitle, similarity, titleMatches, assessMatch, automaticChoice, publicationStatus, arxivID, arxivDOI, author, neuripsURL, classify, titleFromFilename, pdfHints, crossrefItem, createEngine };
})();
if (typeof module !== "undefined") module.exports = MetadataCore;
