function startup() { setTimeout(runTests, 0); }
async function runTests() {
  await Zotero.initializationPromise;
  const output = Zotero.Prefs.get("metadataSearchTest.output");
  if (!output) return;
  const report = { version: Zotero.version, at: new Date().toISOString(), checks: [] };
  const persist = () => IOUtils.writeUTF8(output, JSON.stringify(report, null, 2));
  const check = (name, pass, details) => {
    report.checks.push({ name, pass: !!pass, details });
    if (!pass) throw new Error(name + ": " + JSON.stringify(details));
  };
  let dialog;
  try {
    for (let i = 0; i < 100 && !Zotero.PaperMetadataSearch; i++) await Zotero.Promise.delay(200);
    const api = Zotero.PaperMetadataSearch;
    report.addonVersion = (await (ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs")).AddonManager.getAddonByID("paper-metadata-search@local.zotero")).version;
    check("Plugin startup", !!api, { menus: api?.menuIDs });
    check("Isolated data directory", Zotero.DataDirectory.dir.includes(".runtime-test"), Zotero.DataDirectory.dir);
    for (let i = 0; i < 100 && !Zotero.getMainWindow()?.ZoteroPane?.itemsView; i++) await Zotero.Promise.delay(200);
    const win = Zotero.getMainWindow();
    const engine = api.createEngine(win);
    const collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = "Metadata search verification";
    await collection.saveTx();
    const pdf = Zotero.Prefs.get("metadataSearchTest.pdf");
    const attachment = await Zotero.Attachments.importFromFile({ file: pdf, libraryID: collection.libraryID, collections: [collection.id] });
    const io = { api, itemID: attachment.id, libraryID: collection.libraryID, collectionIDs: [collection.id], opener: win };
    const filename = attachment.attachmentFilename;
    const hints = await api.getContext(io);
    report.pdfHints = hints;
    check("PDF title reconstructed from word coordinates", hints.query === "Memory Mosaics at scale", hints);
    await persist();

    // Observe native behavior now, independently of the historical failure in the screenshot.
    try {
      const native = await Zotero.RecognizeDocument._recognize(attachment);
      report.nativeRecognition = native ? { outcome: "found", item: native.toJSON() } : { outcome: "no-match" };
    } catch (e) { report.nativeRecognition = { outcome: "error", message: e.message }; }
    await persist();

    const result = await engine.search("Memory Mosaics at scale", {providers:["Crossref","arXiv"]});
    report.providers = result.statuses;
    const official = result.candidates.find(c => c.source === "Crossref" && c.item.DOI?.toLowerCase() === "10.52202/085713-1299" && c.item.itemType === "conferencePaper" && c.score === 1)
      || result.candidates.find(c => c.publicationStatus === "published" && c.item.DOI?.toLowerCase() === "10.52202/085713-1299" && c.score === 1);
    check("Formal title search across available sources", !!official, result.statuses);
    const resolved = await engine.resolve(official);
    report.resolved = JSON.parse(JSON.stringify(resolved));
    check("Official bibliography", resolved.item.itemType === "conferencePaper" && resolved.item.creators.length === 2 && resolved.item.DOI === "10.52202/085713-1299", resolved.item);
    if (!resolved.item.abstractNote) {
      // The database need not provide an abstract; use an explicit fixture solely for write/conflict tests.
      resolved.item = {...resolved.item, abstractNote:"Test fixture abstract for field protection"};
      report.writeTestFixture = "Synthetic abstract used only in isolated write/conflict checks; report.resolved preserves the actual network record.";
    }
    const arxiv = result.candidates.find(c => c.source === "arXiv" && c.score === 1);
    check("arXiv fallback title search", arxiv?.item.itemType === "preprint", arxiv?.item);
    const preprintIO = { libraryID: collection.libraryID, collectionIDs: [collection.id] };
    const preprintPlan = await api.plan(preprintIO, arxiv);
    const preprint = await api.apply(preprintIO, arxiv, preprintPlan.fields.map(f => f.name), true, preprintPlan);
    check("arXiv preprint saved with correct type", preprint.itemType === "preprint" && preprint.getField("repository") === "arXiv" && preprint.getField("archiveID").startsWith("2507.03285"), preprint.toJSON());
    await persist();

    const plan = await api.plan(io, resolved);
    const parent = await api.apply(io, resolved, plan.fields.map(f => f.name), true, plan);
    const refreshed = await Zotero.Items.getAsync(attachment.id);
    check("PDF parent created", refreshed.parentItemID === parent.id, { parentID: refreshed.parentItemID, createdID: parent.id });
    check("Collection preserved", parent.getCollections().includes(collection.id), parent.getCollections());
    check("PDF file preserved", refreshed.attachmentFilename === filename && await IOUtils.exists(await refreshed.getFilePathAsync()), refreshed.attachmentFilename);
    parent.setField("title", "User edited title");
    parent.setField("abstractNote", "User written abstract");
    await parent.saveTx();
    const fillPlan = await api.plan(io, resolved);
    check("Existing fields protected by default", !fillPlan.fields.find(f => f.name === "title").checked && !fillPlan.fields.find(f => f.name === "abstractNote").checked, fillPlan.fields);
    await api.apply(io, resolved, fillPlan.fields.filter(f => f.checked).map(f => f.name), fillPlan.creators.checked, fillPlan);
    check("Existing title and abstract preserved", parent.getField("title") === "User edited title" && parent.getField("abstractNote") === "User written abstract", parent.toJSON());
    const collisionPlan = await api.plan(io, resolved);
    parent.setField("title", "Concurrent edit"); await parent.saveTx();
    let rejected = false;
    try { await api.apply(io, resolved, ["title"], false, collisionPlan); } catch { rejected = true; }
    check("Concurrent edits protected", rejected && parent.getField("title") === "Concurrent edit");
    await persist();

    const uiAPI = Object.create(api);
    const startupQueries = [];
    uiAPI.createEngine = () => ({ search: async query => {
      startupQueries.push(query);
      return { candidates:[official], statuses:result.statuses };
    }, resolve: async () => resolved });
    // Transport was tested above; inject before opening so automatic search is deterministic.
    dialog = uiAPI.open(win, attachment.id);
    check("Dialog opened", !!dialog);
    for (let i = 0; i < 100 && !dialog.MetadataDialog?.engine; i++) await Zotero.Promise.delay(100);
    const ui = dialog.MetadataDialog;
    check("Dialog initialized", !!ui?.engine);
    await ui.ready;
    check("Limited sources and venue-specific switches are absent", [...ui.$("sources").querySelectorAll("input")].map(i=>i.value).sort().join(",") === "Crossref,Web,arXiv");
    check("Opening the PDF context automatically searches once", startupQueries.length === 1 && startupQueries[0] === "Memory Mosaics at scale", startupQueries);
    check("Candidate list rendered", ui.$("results").querySelectorAll("button").length > 0);
    await ui.select(official);
    check("Field preview rendered", ui.$("preview").querySelectorAll(".field").length >= 5 && ui.$("apply").disabled);
    check("Preview has unselected existing title", !ui.$("preview").querySelector('input[value="title"]').checked);
    const sameAuthors = ui.$("preview").querySelector('input[value="creators"]');
    sameAuthors.click();
    check("Identical authors stay checked disabled and gray when clicked", sameAuthors.checked && sameAuthors.disabled
      && sameAuthors.closest(".field").classList.contains("unchanged"));
    const differentRole = await api.plan(io, {...resolved, item:{...resolved.item,
      creators:resolved.item.creators.map((c,i)=>i ? c : {...c,creatorType:"editor"})}});
    check("Identical names with different creator roles remain a real conflict", differentRole.creators.changed);
    check("UI layout fits", ui.$("app").getBoundingClientRect().width > 700 && ui.$("preview").getBoundingClientRect().height > 100, { width: dialog.innerWidth, height: dialog.innerHeight });
    ui.$("preview").querySelector('input[value="title"]').checked = true;
    ui.$("preview").querySelector('input[value="title"]').dispatchEvent(new dialog.Event("change", {bubbles:true}));
    await ui.apply();
    check("Explicit UI overwrite saved", parent.getField("title") === "Memory Mosaics at scale" && ui.$("status").textContent.startsWith("已保存：") && ui.$("apply").disabled, ui.$("status").textContent);
    check("Saved fields immediately become checked and locked", ui.$("preview").querySelector('input[value="title"]').checked
      && ui.$("preview").querySelector('input[value="title"]').disabled);
    const nextField = ui.$("preview").querySelector('input[value="abstractNote"]');
    nextField.click();
    check("Selecting another conflict after save re-enables the update button", !ui.$("apply").disabled && ui.$("apply").textContent === "更新选中字段");
    // The second transaction must use a refreshed snapshot and remain successful if UI selection cannot run.
    const selectItem = win.ZoteroPane.selectItem;
    try {
      win.ZoteroPane.selectItem = async () => { throw new Error("Test: main window unavailable"); };
      await ui.apply();
      check("Selection failure does not report a failed save", ui.$("status").textContent.startsWith("已保存：") && ui.$("apply").disabled, ui.$("status").textContent);
      check("Second save applies the newly selected field", parent.getField("abstractNote") === resolved.item.abstractNote
        && ui.$("preview").querySelector('input[value="abstractNote"]').disabled);
    } finally { win.ZoteroPane.selectItem = selectItem; }
    await Zotero.UndoHistory.undo();
    check("Undo reverses the second save independently", parent.getField("abstractNote") === "User written abstract" && parent.getField("title") === "Memory Mosaics at scale");
    await Zotero.UndoHistory.undo();
    check("Zotero undo restores existing title", parent.getField("title") === "Concurrent edit", parent.getField("title"));
    // Restore a fresh preview of the actual current library state for the screenshot.
    await ui.select(official);
    const sourceChecks = [...ui.$("sources").querySelectorAll("input")].map(i=>i.checked);
    await ui.selectAll();
    check("Select all checks preview choices without changing sources or saving", [...ui.$("preview").querySelectorAll("input")].every(i=>i.checked)
      && JSON.stringify(sourceChecks) === JSON.stringify([...ui.$("sources").querySelectorAll("input")].map(i=>i.checked))
      && parent.getField("title") === "Concurrent edit");
    report.uiText = ui.$("app").textContent;
    // Capture the actual Gecko-rendered window if the platform supports drawSnapshot.
    try {
      const bitmap = await dialog.browsingContext.currentWindowGlobal.drawSnapshot(new dialog.DOMRect(0, 0, dialog.innerWidth, dialog.innerHeight), 1, "white");
      const canvas = dialog.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const data = canvas.toDataURL("image/png").split(",")[1];
      const bytes = Uint8Array.from(dialog.atob(data), c => c.charCodeAt(0));
      const shot = output.replace(/\.json$/, ".png");
      await IOUtils.write(shot, bytes); report.screenshot = shot;
    } catch (e) { report.screenshotError = e.message; }
    // Regression cases from the user's two arXiv records.
    const firstPaper = (await engine.search("arXiv:2603.09972", {providers:["arXiv"], discoverPublished:false})).candidates[0];
    const secondPaper = (await engine.search("arXiv:2602.02464", {providers:["arXiv"], discoverPublished:false})).candidates[0];
    report.preprintCases = [firstPaper, secondPaper];
    check("Both user papers have preprint types and arXiv DOIs", firstPaper?.item.itemType === "preprint"
      && firstPaper.item.DOI === "10.48550/arXiv.2603.09972" && secondPaper?.item.itemType === "preprint"
      && secondPaper.item.DOI === "10.48550/arXiv.2602.02464", report.preprintCases);
    const legacy = new Zotero.Item("journalArticle");
    legacy.libraryID = collection.libraryID;
    legacy.setField("title", secondPaper.item.title.toLowerCase());
    legacy.setField("url", secondPaper.item.url);
    legacy.setField("date", secondPaper.item.date);
    legacy.setField("abstractNote", "User's own abstract must remain");
    legacy.setField("issue", "Keep this issue");
    legacy.setField("extra", "User note");
    legacy.setCreators(secondPaper.item.creators);
    legacy.addToCollection(collection.id);
    legacy.addTag("Keep this tag");
    await legacy.saveTx();
    const legacyPDF = await Zotero.Attachments.importFromFile({file: pdf, parentItemID: legacy.id});
    const legacyIO = {api, itemID:legacy.id, libraryID:legacy.libraryID, opener:win};
    const originalCreators = JSON.stringify(legacy.getCreators());
    const originalTitle = legacy.getField("title");
    check("Legacy arXiv journal item matches by full authors and version", api.match(legacy, secondPaper).eligible);
    const ambiguous = await api.automaticCandidate(legacyIO, [secondPaper, {...secondPaper, source:"Other"}], engine);
    check("Matching records with the same DOI remain eligible for automatic fill", !!ambiguous.candidate);
    dialog.close();
    const legacyAPI = Object.create(api);
    let legacySearches = 0;
    legacyAPI.createEngine = () => ({search:async () => {
      legacySearches++;
      return {candidates:[secondPaper],statuses:[{source:"arXiv",ok:true,count:1}]};
    }, resolve:async c => c});
    dialog = legacyAPI.open(win, legacy.id);
    for (let i=0; i<100 && !dialog.MetadataDialog?.engine; i++) await Zotero.Promise.delay(100);
    const legacyUI = dialog.MetadataDialog;
    await legacyUI.ready;
    check("Opening an existing item automatically searches once", legacySearches === 1);
    check("Search automatically fills the missing DOI", legacy.getField("DOI") === secondPaper.item.DOI && legacyUI.$("status").textContent.includes("已自动补全"), legacyUI.$("status").textContent);
    check("Auto-fill preserves type, title, authors and conflicting abstract", legacy.itemType === "journalArticle"
      && legacy.getField("title") === originalTitle && JSON.stringify(legacy.getCreators()) === originalCreators
      && legacy.getField("abstractNote") === "User's own abstract must remain", legacy.toJSON());
    check("Type conflict requires explicit selection", legacyUI.$("preview").querySelector('input[value="itemType"]')?.checked === false);
    const again = await api.autoFill(legacyIO, secondPaper);
    check("Repeated auto-fill has no additional writes", !again.saved && !again.fields.length);
    const typeBox = legacyUI.$("preview").querySelector('input[value="itemType"]');
    typeBox.checked = true;
    typeBox.dispatchEvent(new dialog.Event("change"));
    for (let i=0; i<100 && (!legacyUI.plan?.changeType || legacyUI.$("apply").disabled); i++) await Zotero.Promise.delay(30);
    check("Type conversion preview includes arXiv fields and preservation", legacyUI.plan.changeType
      && legacyUI.$("preview").querySelector('input[value="archiveID"]')?.checked
      && legacyUI.$("preview").textContent.includes("Keep this issue"), legacyUI.$("preview").textContent);
    await legacyUI.select(secondPaper);
    await legacyUI.selectAll();
    check("Select all also includes the rebuilt type-specific fields without saving", legacyUI.plan.changeType
      && [...legacyUI.$("preview").querySelectorAll("input")].every(i=>i.checked)
      && legacyUI.$("preview").querySelector('input[value="archiveID"]')?.checked
      && legacy.itemType === "journalArticle");
    await legacyUI.apply();
    check("Explicit type correction saves a complete preprint", legacy.itemType === "preprint"
      && legacy.getField("DOI") === secondPaper.item.DOI && legacy.getField("repository") === "arXiv"
      && legacy.getField("archiveID").startsWith("2602.02464"), legacy.toJSON());
    check("Type correction preserves original extra and incompatible fields", legacy.getField("extra").includes("User note")
      && legacy.getField("extra").includes("Original issue: Keep this issue"), legacy.getField("extra"));
    check("Type correction preserves attachment collection tags and authors", legacyPDF.parentItemID === legacy.id
      && legacy.getAttachments().includes(legacyPDF.id) && legacy.getCollections().includes(collection.id)
      && legacy.getTags().some(t=>t.tag === "Keep this tag") && JSON.stringify(legacy.getCreators()) === originalCreators);
    await Zotero.UndoHistory.undo();
    check("Undo restores type and type-specific fields", legacy.itemType === "journalArticle"
      && legacy.getField("issue") === "Keep this issue" && legacy.getField("DOI") === secondPaper.item.DOI, legacy.toJSON());
    await Zotero.UndoHistory.undo();
    check("Undo also reverses automatic fill", !legacy.getField("DOI") && legacy.getField("abstractNote") === "User's own abstract must remain");
    const staleAuto = await api.plan(legacyIO, secondPaper);
    legacy.setField("DOI", "10.1234/user-choice"); await legacy.saveTx();
    let autoRejected = false;
    try { await api.apply(legacyIO, secondPaper, ["DOI"], false, staleAuto, {onlyMissing:true}); } catch { autoRejected = true; }
    check("Automatic write rejects a concurrent identifier conflict", autoRejected && legacy.getField("DOI") === "10.1234/user-choice");
    legacy.setField("DOI", ""); await legacy.saveTx();
    const staleType = await api.plan(legacyIO, secondPaper, {changeType:true});
    legacy.setField("extra", "New user note"); await legacy.saveTx();
    let typeRejected = false;
    try { await api.apply(legacyIO, secondPaper, [], false, staleType); } catch { typeRejected = true; }
    check("Type correction rejects concurrent edits to preserved fields", typeRejected && legacy.itemType === "journalArticle"
      && legacy.getField("extra") === "New user note");
    report.generalSearch = [];
    for (const [title, doi, type] of [
      ["BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding", "10.18653/v1/n19-1423", "conferencePaper"],
      ["Deep Residual Learning for Image Recognition", "10.1109/cvpr.2016.90", "conferencePaper"],
      ["Highly accurate protein structure prediction with AlphaFold", "10.1038/s41586-021-03819-2", "journalArticle"]
    ]) {
      const found = await engine.search(title, {providers:["Crossref"]});
      const record = found.candidates.find(c => c.item.DOI?.toLowerCase() === doi);
      check("Cross-venue native search: " + title, record?.item.itemType === type && record.publicationStatus === "published", found.statuses);
      report.generalSearch.push({title, statuses:found.statuses, summary:found.publicationSummary, item:record.item});
    }
    for (const [title,type,source,venue] of [
      ["LoRA: Low-Rank Adaptation of Large Language Models","conferencePaper","OpenReview",/ICLR 2022/],
      ["Swin Transformer: Hierarchical Vision Transformer Using Shifted Windows","conferencePaper","CVF",/Computer Vision/],
      ["A Simple Framework for Contrastive Learning of Visual Representations","conferencePaper",["Publisher","OpenReview"],/Machine Learning|ICML/],
      ["DINOv2: Learning Robust Visual Features without Supervision","journalArticle","OpenReview",/Transactions on Machine Learning Research/]
    ]) {
      const found=await engine.search(title);
      const record=found.candidates.find(c=>(Array.isArray(source)?source:[source]).includes(c.source) && c.item.itemType===type
        && c.publicationStatus==="published" && api.match({toJSON:()=>({...c.item})},c).eligible
        && venue.test(c.item.proceedingsTitle || c.item.publicationTitle || ""));
      check("Native title discovery and official venue: "+title, !!record, found.statuses);
      report.generalSearch.push({title,statuses:found.statuses,discoveryURLs:found.discoveryURLs,summary:found.publicationSummary,item:record?.item});
    }
    const pmlr=await engine.search("https://proceedings.mlr.press/v119/chen20j.html",{providers:[]});
    check("Generic publisher citation import reads official ICML proceedings", pmlr.candidates[0]?.item.itemType==="conferencePaper"
      && pmlr.candidates[0].item.creators.length===4 && /Machine Learning/.test(pmlr.candidates[0].item.proceedingsTitle));
    legacyUI.engine = engine;
    legacyUI.$("query").value = "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding";
    legacyUI.$("sources").querySelectorAll("input").forEach(i => i.checked = i.value === "Crossref");
    await legacyUI.search();
    check("General UI displays journal or conference venue without choosing a conference", /North American|NAACL/.test(legacyUI.$("publication-summary").textContent)
      && !legacyUI.$("sources").closest("details").open, legacyUI.$("publication-summary").textContent);
    report.generalUI = legacyUI.$("app").textContent;
    try {
      const bitmap = await dialog.browsingContext.currentWindowGlobal.drawSnapshot(new dialog.DOMRect(0,0,dialog.innerWidth,dialog.innerHeight),1,"white");
      const canvas = dialog.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
      canvas.width=bitmap.width; canvas.height=bitmap.height; canvas.getContext("2d").drawImage(bitmap,0,0);
      const bytes=Uint8Array.from(dialog.atob(canvas.toDataURL("image/png").split(",")[1]),c=>c.charCodeAt(0));
      report.generalScreenshot=output.replace(/\.json$/,"-general.png");
      await IOUtils.write(report.generalScreenshot,bytes);
    } catch(e) { report.generalScreenshotError=e.message; }
    report.pass = true;
  } catch (e) {
    report.pass = false;
    report.error = { message: e.message, stack: e.stack };
  } finally {
    await persist();
    dialog?.close();
    Services.startup.quit(Components.interfaces.nsIAppStartup.eForceQuit);
  }
}
function shutdown() {}
function install() {}
function uninstall() {}
