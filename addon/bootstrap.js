var MetadataSearchScope;

async function startup({ id, rootURI }) {
  Components.utils.importGlobalProperties(["URL"]);
  MetadataSearchScope = { Zotero, Services, ChromeUtils, IOUtils, PathUtils, URL, Cc: Components.classes, Ci: Components.interfaces };
  Services.scriptloader.loadSubScript(rootURI + "discovery.js", MetadataSearchScope);
  Services.scriptloader.loadSubScript(rootURI + "core.js", MetadataSearchScope);
  Services.scriptloader.loadSubScript(rootURI + "integration.js", MetadataSearchScope);
  await MetadataSearchScope.MetadataSearch.init({ id, rootURI });
  Zotero.PaperMetadataSearch = MetadataSearchScope.MetadataSearch;
}

function shutdown() {
  MetadataSearchScope?.MetadataSearch.shutdown();
  delete Zotero.PaperMetadataSearch;
  MetadataSearchScope = undefined;
}

function install() {}
function uninstall() {}
