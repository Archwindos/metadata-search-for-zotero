var MetadataSearch = {
  windows: new Set(),
  menuIDs: [],
  writeInProgress: false,

  async init({ id, rootURI }) {
    this.id = id;
    this.rootURI = rootURI;
    const addonStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
    this.chromeHandle = addonStartup.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
      ["content", "paper-metadata-search", ""]
    ]);
    for (const target of ["main/menubar/tools", "main/library/item"]) {
      this.menuIDs.push(Zotero.MenuManager.registerMenu({
        menuID: `paper-metadata-search-${target.endsWith("tools") ? "tools" : "item"}`,
        pluginID: id, target,
        menus: [{
          menuType: "menuitem",
          onShowing: (_event, context) => {
            context.menuElem.label = "搜索论文元数据…";
            if (target === "main/library/item") {
              context.setEnabled(context.items?.length === 1 && this.canUseItem(context.items[0]));
            }
          },
          onCommand: (event, context) => {
            const win = event.target.ownerGlobal;
            this.open(win, target === "main/library/item" ? context.items?.[0]?.id : null);
          }
        }]
      }));
    }
  },

  canUseItem(item) {
    return item && !item.deleted && (item.isRegularItem() || item.isPDFAttachment());
  },

  createEngine(win) {
    return MetadataCore.createEngine({
      request: async (url, { signal }) => {
        let cancel;
        const abort = () => cancel?.();
        if (signal?.aborted) throw new Error("已取消");
        // arXiv asks API clients to leave at least three seconds between requests.
        if (new URL(url).hostname === "export.arxiv.org") {
          const wait = Math.max(0, (this.arxivNextRequestAt || 0) - Date.now());
          this.arxivNextRequestAt = Date.now() + wait + 3000;
          if (wait) await Zotero.Promise.delay(wait);
          if (signal?.aborted) throw new Error("已取消");
        }
        signal?.addEventListener("abort", abort, { once: true });
        try {
          const xhr = await Zotero.HTTP.request("GET", url, {
            timeout: 18000, errorDelayMax: 0, noRetryOnThrottle: true,
            headers: { Accept: "application/json, application/atom+xml, text/html;q=0.9, */*;q=0.8" },
            cancellerReceiver: fn => { cancel = fn; if (signal?.aborted) fn(); }
          });
          return xhr.responseText;
        } catch (e) {
          const status = e.status || e.xmlhttp?.status;
          if (status === 429) throw new Error("请求被限流（429）。请稍后重试；已停止自动重试。");
          if ([401, 403].includes(status)) throw new Error(`来源拒绝访问（${status}）；未绕过访问限制。`);
          if (signal?.aborted) throw new Error("已取消");
          throw new Error(status ? `来源返回 HTTP ${status}` : "网络请求失败或超时。" + e.message);
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      },
      parseDocument: (text, type) => new win.DOMParser().parseFromString(text, type),
      importBibtex: async text => {
        const translate = new Zotero.Translate.Import();
        translate.setTranslator("9cb70025-a888-4a29-a210-93ec52da40d4");
        translate.setString(text);
        const items = await translate.translate({ libraryID: false, saveAttachments: false });
        return items[0];
      }
    });
  },

  open(win = Zotero.getMainWindow(), itemID = null) {
    try {
      if (!win) throw new Error("请打开 Zotero 主窗口。");
      const pane = win.ZoteroPane;
      const item = itemID ? Zotero.Items.get(itemID) : null;
      const libraries = item ? [item.libraryID] : pane.getSelectedLibraryIDs();
      if (libraries.length !== 1) throw new Error("请先选择一个目标文献库，再搜索元数据。");
      const collectionIDs = item ? item.getCollections() : pane.getSelectedCollections(true);
      const io = { api: this, itemID, libraryID: libraries[0], collectionIDs, opener: win };
      const dialog = win.openDialog("chrome://paper-metadata-search/content/search.xhtml", "", "chrome,centerscreen,resizable,dialog=no", io);
      this.windows.add(dialog);
      dialog.addEventListener("unload", () => this.windows.delete(dialog), { once: true });
      return dialog;
    } catch (e) {
      Services.prompt.alert(win, "论文元数据检索", e.message);
      return null;
    }
  },

  async getContext(io) {
    const item = io.itemID ? await Zotero.Items.getAsync(io.itemID) : null;
    if (!item) return { label: "新建文献条目", query: "", hints: null };
    if (!this.canUseItem(item)) throw new Error("该条目当前无法检索元数据。");
    if (item.isRegularItem()) return { label: `补充元数据：${item.getField("title")}`, query: item.getField("title"), hints: null };
    let hints;
    try {
      hints = MetadataCore.pdfHints(await Zotero.PDFWorker.getRecognizerData(item.id, true), item.attachmentFilename);
    } catch (e) {
      hints = { title: "", filenameTitle: MetadataCore.titleFromFilename(item.attachmentFilename), error: e.message };
    }
    return { label: `为 PDF 创建或补充父条目：${item.getField("title")}`,
      query: hints.title || hints.filenameTitle || "", hints };
  },

  async targetItem(io) {
    const item = io.itemID ? await Zotero.Items.getAsync(io.itemID) : null;
    if (io.itemID && (!item || !this.canUseItem(item))) throw new Error("原条目已删除或不可用，请重新打开检索窗口。");
    if (item?.isPDFAttachment() && item.parentItemID) {
      const parent = await Zotero.Items.getAsync(item.parentItemID);
      if (!parent || parent.deleted) throw new Error("PDF 的父条目不可用。");
      return { item: parent, attachment: item, existing: true };
    }
    return { item: item?.isRegularItem() ? item : null, attachment: item?.isPDFAttachment() ? item : null, existing: !!item?.isRegularItem() };
  },

  // Only bibliography fields may be imported; external source data cannot set IDs, paths or collections.
  fieldNames: ["title", "abstractNote", "date", "DOI", "url", "proceedingsTitle", "conferenceName", "publicationTitle", "bookTitle", "publisher", "place", "volume", "issue", "pages", "ISBN", "ISSN", "language", "repository", "archiveID", "libraryCatalog", "extra"],

  validFields(type) {
    const typeID = Zotero.ItemTypes.getID(type);
    if (!typeID || ["attachment", "note", "annotation"].includes(type)) throw new Error("来源返回了不支持的文献类型。");
    return this.fieldNames.filter(field => {
      const fieldID = Zotero.ItemFields.getID(field);
      return fieldID && Zotero.ItemFields.isValidForType(fieldID, typeID);
    });
  },

  async plan(io, result, { changeType = false } = {}) {
    const target = await this.targetItem(io);
    changeType = !!(changeType && target.item && target.item.itemType !== result.item.itemType);
    const type = changeType ? result.item.itemType : target.item?.itemType || result.item.itemType;
    const typeID = Zotero.ItemTypes.getID(type);
    const snapshot = target.item ? JSON.stringify(target.item.toJSON()) : null;
    let previewItem = target.item;
    const preserved = [];
    if (changeType) {
      this.validFields(type);
      for (const id of target.item.getFieldsNotInType(typeID, true) || []) {
        preserved.push(`Original ${Zotero.ItemFields.getName(id)}: ${target.item.getField(id)}`);
      }
      for (const c of target.item.getCreators()) {
        if (!Zotero.CreatorTypes.isValidForItemType(c.creatorTypeID, typeID)) {
          preserved.push(`Original creator (${Zotero.CreatorTypes.getName(c.creatorTypeID)}): ${c.firstName || ""} ${c.lastName}`);
        }
      }
      previewItem = target.item.clone(null, { skipTags: true });
      previewItem.setType(typeID);
    }
    const fields = this.validFields(type).filter(name => MetadataCore.clean(result.item[name])).map(name => {
      const before = previewItem?.getField(name) || "";
      const after = MetadataCore.clean(result.item[name]);
      return { name, before, after, checked: !before && !result.autoExcludedFields?.includes(name), changed: before !== after };
    });
    const before = target.item?.getCreators() || [];
    const after = result.item.creators || [];
    const creatorValues = creators => creators.map(c => [c.firstName || "", c.lastName || c.name || "",
      c.fieldMode ?? (c.name ? 1 : 0), c.creatorType || Zotero.CreatorTypes.getName(c.creatorTypeID)]);
    const creatorsChanged = JSON.stringify(creatorValues(before)) !== JSON.stringify(creatorValues(after));
    return { target, type, originalType: target.item?.itemType, fields, snapshot, changeType, preserved, creators: { before, after, checked: !before.length, changed: creatorsChanged },
      typeWarning: target.item && target.item.itemType !== result.item.itemType
        ? "条目类型不同。可勾选类型修正；无法迁移的已有信息会保存在“其他”字段。" : "" };
  },

  match(item, result) {
    return MetadataCore.assessMatch(item.toJSON(), result.item);
  },

  async automaticCandidate(io, candidates, engine, signal) {
    const { item } = await this.targetItem(io);
    if (!item) return { reason: "新条目或独立 PDF 需要先核对候选。" };
    const plausible = candidates.filter(c => MetadataCore.titleMatches(item.getField("title"), c.item.title));
    if (plausible.length > 6) return { reason: "同标题候选较多，请手动选择版本。" };
    const matches = [];
    for (const candidate of plausible) {
      if (signal?.aborted) return {};
      try {
        const result = await engine.resolve(candidate, { signal });
        if (result.publicationStatus !== "unverified" && this.match(item, result).eligible) matches.push(result);
      } catch (e) { if (signal?.aborted) return {}; }
    }
    return MetadataCore.automaticChoice(matches);
  },

  async autoFill(io, result) {
    const plan = await this.plan(io, result);
    if (!plan.target.item || result.publicationStatus === "unverified" || !this.match(plan.target.item, result).eligible) return { fields: [] };
    const fields = plan.fields.filter(f => !MetadataCore.clean(f.before) && !result.autoExcludedFields?.includes(f.name)).map(f => f.name);
    if (!fields.length) return { fields: [] };
    const saved = await this.apply(io, result, fields, false, plan, { onlyMissing: true });
    return { saved, fields };
  },

  async findDuplicates(libraryID, data) {
    // Show exact title matches for review; do not merge or reuse items automatically.
    const search = new Zotero.Search();
    search.libraryID = libraryID;
    search.addCondition("itemType", "isNot", "attachment");
    search.addCondition("title", "is", data.title);
    const ids = await search.search();
    return (await Zotero.Items.getAsync(ids)).filter(i => i.isRegularItem() && !i.deleted);
  },

  async apply(io, result, selectedFields, useCreators, expectedPlan, { onlyMissing = false } = {}) {
    if (this.writeInProgress) throw new Error("另一窗口正在写入，请稍后重试。");
    this.writeInProgress = true;
    try {
      const library = Zotero.Libraries.get(io.libraryID);
      if (!library?.editable) throw new Error("目标文献库没有写入权限。");
      let savedItem;
      await Zotero.DB.executeTransaction(async () => {
        // Re-read at commit: native recognition may have attached the PDF while search was open.
        const target = await this.targetItem(io);
        if (onlyMissing && (!target.item || !expectedPlan || expectedPlan.changeType || useCreators || !this.match(target.item, result).eligible)) {
          throw new Error("自动补全的匹配条件已改变，请重新检索。");
        }
        if (expectedPlan) {
          if ((target.item?.id || null) !== (expectedPlan.target.item?.id || null)) {
            throw new Error("原条目的父条目已改变，请重新选择候选并核对预览。");
          }
          if (target.item && target.item.itemType !== expectedPlan.originalType) throw new Error("条目类型已改变，请重新选择候选。");
          if ((onlyMissing || expectedPlan.changeType) && JSON.stringify(target.item?.toJSON()) !== expectedPlan.snapshot) {
            throw new Error("条目信息已改变，请重新选择候选并核对预览。");
          }
          for (const field of expectedPlan.fields.filter(f => !expectedPlan.changeType && selectedFields.includes(f.name))) {
            if ((target.item?.getField(field.name) || "") !== field.before) {
              throw new Error("现有字段已改变，请重新选择候选并核对预览。");
            }
          }
          if (useCreators && JSON.stringify(target.item?.getCreators() || []) !== JSON.stringify(expectedPlan.creators.before)) {
            throw new Error("现有作者已改变，请重新选择候选并核对预览。");
          }
        }
        if (target.attachment?.libraryID !== undefined && target.attachment.libraryID !== io.libraryID) throw new Error("PDF 文献库已改变。");
        const item = target.item || new Zotero.Item(result.item.itemType);
        if (!target.item) item.libraryID = io.libraryID;
        if (item.libraryID !== io.libraryID) throw new Error("目标文献库已改变。");
        if (expectedPlan?.changeType) item.setType(Zotero.ItemTypes.getID(expectedPlan.type));
        const valid = new Set(this.validFields(item.itemType));
        for (const name of selectedFields) {
          if (!valid.has(name) || !MetadataCore.clean(result.item[name])) continue;
          if (onlyMissing && MetadataCore.clean(item.getField(name))) throw new Error("自动补全不会替换已有字段。");
          item.setField(name, MetadataCore.clean(result.item[name]));
        }
        if (useCreators && result.item.creators?.length) {
          const allowed = Zotero.CreatorTypes.getTypesForItemType(item.itemTypeID).map(type => type.name);
          const creators = result.item.creators.filter(c => allowed.includes(c.creatorType));
          if (creators.length) item.setCreators(creators);
        }
        if (expectedPlan?.preserved?.length) {
          item.setField("extra", [item.getField("extra"), ...expectedPlan.preserved].filter(Boolean).join("\n"));
        }
        if (!target.item) {
          if (!item.getField("title")) throw new Error("新条目必须选择标题字段。");
          const ids = target.attachment ? target.attachment.getCollections() : io.collectionIDs;
          for (const id of ids || []) {
            const collection = Zotero.Collections.get(id);
            if (collection && !collection.deleted && collection.libraryID === io.libraryID) item.addToCollection(id);
          }
        }
        if (target.item) Zotero.UndoHistory.stageAction("undo-action-edit-metadata", { count: 1 });
        await item.save();
        if (target.attachment && !target.attachment.parentItemID) {
          target.attachment.parentID = item.id;
          await target.attachment.save();
        }
        savedItem = item;
      });
      return savedItem;
    } finally { this.writeInProgress = false; }
  },

  shutdown() {
    for (const win of this.windows) win.close();
    this.windows.clear();
    for (const id of this.menuIDs) Zotero.MenuManager.unregisterMenu(id);
    this.menuIDs = [];
    this.chromeHandle?.destruct();
  }
};
