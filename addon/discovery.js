/* Public title discovery and publisher metadata. Search snippets never authorize writes. */
var MetadataDiscovery = (() => {
  const publisherHosts = /^(?:www\.)?(?:openaccess\.thecvf\.com|aclanthology\.org|proceedings\.mlr\.press|nature\.com|link\.springer\.com|dl\.acm\.org|ieeexplore\.ieee\.org|onlinelibrary\.wiley\.com|pubs\.acs\.org|sciencedirect\.com|ijcai\.org)$/i;
  function pageURL(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (!["https:","http:"].includes(url.protocol) || url.port || url.username || url.password) return null;
    const host=url.hostname.toLowerCase();
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|lan|test|invalid|example)$/.test(host)
      || /(?:^|\.)(?:openalex\.org|dblp\.org)$/.test(host)) return null;
    url.protocol="https:";
    url.hash="";
    for(const key of [...url.searchParams.keys()]) if(/^utm_/.test(key)) url.searchParams.delete(key);
    if (url.hostname === "openaccess.thecvf.com") {
      url.pathname = url.pathname.replace(/\/papers\//, "/html/").replace(/\.pdf$/i, ".html");
      if (!/\/content\/.*\/html\/.*\.html$/.test(url.pathname)) return null;
    }
    if (publisherHosts.test(url.hostname)) return url.href;
    if (/^(?:iclr|icml|neurips)\.cc$/.test(url.hostname) && /\/virtual\/\d{4}\/(?:poster|oral|spotlight)\/\d+/.test(url.pathname)) return url.href;
    if (url.hostname === "openreview.net" && /^\/(?:forum|pdf)$/.test(url.pathname) && /^[\w-]+$/.test(url.searchParams.get("id") || "")) {
      return `https://openreview.net/forum?id=${encodeURIComponent(url.searchParams.get("id"))}`;
    }
    if (/^(?:papers|proceedings)\.n(eur)?ips\.cc$/.test(url.hostname)) return url.href;
    // Other publishers can expose standard citation_* metadata; no venue-name allowlist is required.
    return url.href;
  }

  function create({get, parseDocument, clean, author, titleMatches, similarity}) {
    const json = text => {
      if (/captcha|ChallengeRequiredError|anubis_challenge|verify.{0,20}browser/i.test(text)) throw new Error("来源需要人机验证，已停止请求。");
      try { return JSON.parse(text); } catch { throw new Error("来源未返回有效 JSON。"); }
    };
    async function discover(title, signal) {
      const queries = [`"${title.replace(/"/g, " ")}"`, title.includes(":") ? title.split(":")[0] : title.split(/\s+/).slice(0, 7).join(" ")];
      let links = [];
      for (const query of [...new Set(queries)]) {
        const text = await get(`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`, signal);
        const doc = parseDocument(text, "text/xml");
        if (!doc.getElementsByTagName("rss").length) throw new Error("网络搜索未返回有效结果；可能需要网站验证。");
        links = [...doc.getElementsByTagName("item")].map(node => {
          const rawURL = clean(node.getElementsByTagName("link")[0]?.textContent);
          return {url:pageURL(rawURL), title:clean(node.getElementsByTagName("title")[0]?.textContent)};
        }).filter(link => link.url && (publisherHosts.test(new URL(link.url).hostname)
          || /(?:openreview\.net|(?:iclr|icml|neurips)\.cc|proceedings\.n(eur)?ips\.cc)$/.test(new URL(link.url).hostname)
          || similarity(title,link.title)>=.7));
        if (links.length) break;
      }
      // A generic repository heading can still lead to the right paper; verify its page title later.
      return [...new Map(links.map(link => [link.url, link])).values()].sort((a,b)=>similarity(title,b.title)-similarity(title,a.title)).slice(0, 5);
    }

    async function virtualPage(url, signal) {
      const doc = parseDocument(await get(url, signal), "text/html");
      const title = clean(doc.querySelector(".event-title")?.textContent);
      if (!title) throw new Error("会议日程页未返回论文标题。");
      const links = [...doc.querySelectorAll('a[href]')].map(a => pageURL(new URL(a.getAttribute("href"),url).href)).filter(Boolean);
      return {title, links:[...new Set(links)]};
    }

    function openreviewRecord(note) {
      const value = name => {const v=note.content?.[name];return v && typeof v === "object" && !Array.isArray(v) ? v.value : v;};
      const venueid=clean(value("venueid")), venue=clean(value("venue"));
      if (note.ddate || note.replyto || note.forum && note.forum !== note.id
        || /^dblp\.org\//i.test(venueid) || /dblp\.org/i.test([note.invitation,...(note.invitations||[])].join(" "))) return null;
      const title=clean(value("title")), names=value("authors");
      if (!title || !Array.isArray(names) || !names.length) return null;
      const rejected=/submitted|submission|under review|withdrawn|rejected|desk reject/i.test(venue);
      const isJournal=venueid === "TMLR" && /^(?:Accepted by TMLR|Transactions on Machine Learning Research)/i.test(venue);
      const accepted=!!venue && !!venueid && !rejected && !/Withdrawn|Rejected|Submitted/i.test(venueid)
        && (isJournal || /\/(?:Conference|Workshop)(?:\/|$)/.test(venueid) && /\d{4}/.test(venue));
      const year=venueid.match(/\/(\d{4})\//)?.[1] || venue.match(/\b(20\d{2})\b/)?.[1]
        || (accepted && Number.isFinite(note.pdate) ? String(new Date(note.pdate).getUTCFullYear()) : "");
      const item={itemType:accepted?(isJournal?"journalArticle":"conferencePaper"):"preprint",title,creators:names.map(n=>author(n)),date:year,
        abstractNote:clean(value("abstract")),url:`https://openreview.net/forum?id=${encodeURIComponent(note.id)}`,libraryCatalog:"OpenReview"};
      if (accepted && isJournal) item.publicationTitle="Transactions on Machine Learning Research";
      else if (accepted) Object.assign(item,{conferenceName:venue,proceedingsTitle:venue.replace(/\s+(?:Poster|Oral|Spotlight|regular)$/i,"")});
      else Object.assign(item,{repository:"OpenReview",extra:`Submission status: ${venue || "not confirmed"}`});
      if (accepted && /^10\.\d{4,9}\//.test(clean(value("doi")))) item.DOI=clean(value("doi"));
      return {source:"OpenReview",item,sourceURL:item.url,resolved:true,publicationStatus:accepted?"published":"unverified",
        warnings:accepted?[]:["该 OpenReview 记录未证实正式接收，不能当作已发表论文自动补全。"]};
    }

    async function openreview(title, {year, signal} = {}) {
      const hosts=year && Number(year)<2023 ? ["api.openreview.net","api2.openreview.net"] : ["api2.openreview.net","api.openreview.net"];
      for (const host of hosts) {
        const response=json(await get(`https://${host}/notes/search?term=${encodeURIComponent(title)}&type=exact&content=title&source=forum&limit=20`,signal));
        if (!Array.isArray(response.notes)) throw new Error("OpenReview 未返回论文列表。");
        const results=response.notes.map(openreviewRecord).filter(r=>r && titleMatches(title,r.item.title));
        if (results.length) return results;
        // API 1 and 2 host different venue years. Only an empty successful result permits the other version.
      }
      return [];
    }

    async function publisher(url, title, signal) {
      const doc=parseDocument(await get(url,signal),"text/html");
      if (/captcha|anubis_challenge|verify.{0,20}browser/i.test(doc.title || "")) throw new Error("出版社页面需要人机验证，已停止请求。");
      const meta=name=>clean(doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content"));
      const paperTitle=meta("citation_title");
      if (!paperTitle || title && !titleMatches(title,paperTitle)) return null;
      const authors=[...doc.querySelectorAll('meta[name="citation_author"]')].map(m=>author(m.getAttribute("content"),true));
      if (!authors.length) return null;
      const host=new URL(url).hostname;
      const conference=meta("citation_conference_title") || meta("citation_book_title");
      const journal=meta("citation_journal_title");
      const isConference=!!conference || /^(?:proceedings\.mlr\.press|openaccess\.thecvf\.com|aclanthology\.org)$/.test(host);
      const venue=conference || journal;
      if (!venue) return null;
      const preprint=/(?:^|\.)(?:arxiv\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|osf\.io)$/.test(host);
      const unverified=/under review|submitted|withdrawn|rejected/i.test(venue);
      const item={itemType:preprint?"preprint":isConference?"conferencePaper":"journalArticle",title:paperTitle,creators:authors,
        date:meta("citation_publication_date") || meta("citation_date"),DOI:meta("citation_doi").replace(/^https?:\/\/doi\.org\//i,""),
        url,abstractNote:clean(doc.querySelector('#abstract,.abstract,.paper-abstract')?.textContent) || meta("description"),
        pages:[...new Set([meta("citation_firstpage"),meta("citation_lastpage")].filter(Boolean))].join("-"),
        volume:meta("citation_volume"),issue:meta("citation_issue"),publisher:meta("citation_publisher"),libraryCatalog:host};
      if (preprint) item.repository=host;
      else if (isConference) Object.assign(item,{proceedingsTitle:venue,conferenceName:venue});
      else item.publicationTitle=venue;
      return {source:host==="openaccess.thecvf.com"?"CVF":"Publisher",item,sourceURL:url,resolved:true,
        publicationStatus:unverified?"unverified":preprint?"preprint":"published"};
    }

    async function cvf(title, acronym, year, signal) {
      if (!/^(?:ICCV|CVPR|WACV)$/.test(acronym) || !/^20\d{2}$/.test(year)) return [];
      const url=`https://openaccess.thecvf.com/${acronym}${year}?day=all`;
      const doc=parseDocument(await get(url,signal),"text/html");
      const links=[...doc.querySelectorAll('a[href*="/html/"]')].filter(a=>titleMatches(title,a.textContent))
        .map(a=>pageURL(new URL(a.getAttribute("href"),url).href)).filter(Boolean);
      return [...new Set(links)].slice(0,2);
    }
    return {discover,virtualPage,openreview,openreviewRecord,publisher,cvf};
  }
  return {pageURL,create};
})();
if (typeof module !== "undefined") module.exports=MetadataDiscovery;
