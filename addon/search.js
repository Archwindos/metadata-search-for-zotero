/* All remote strings are rendered as text; remote scripts/markup are never inserted. */
var MetadataDialog = {
  current: null,
  controller: null,
  sequence: 0,
  busyWrite: false,
  autoMessage: "",
  saved: false,
  labels: { title: "标题", date: "日期", DOI: "DOI", url: "论文链接", abstractNote: "摘要", creators: "作者", proceedingsTitle: "论文集", conferenceName: "会议", publicationTitle: "期刊", volume: "卷", issue: "期", pages: "页码", publisher: "出版者", repository: "预印本平台", archiveID: "预印本编号", extra: "附加信息", libraryCatalog: "元数据来源", bookTitle: "书名", language: "语言", ISBN: "ISBN", ISSN: "ISSN" },
  typeLabels: { conferencePaper: "会议论文", journalArticle: "期刊论文", preprint: "预印本", book: "图书", bookSection: "图书章节" },
  $(id) { return document.getElementById(id); },
  node(tag, text = "", className = "") {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  },

  async init() {
    this.$("query").disabled = true;
    this.$("search").disabled = true;
    this.io = window.arguments[0];
    this.api = this.io.api;
    this.engine = this.api.createEngine(window);
    this.$("search-form").addEventListener("submit", event => { event.preventDefault(); this.search(); });
    this.$("cancel").addEventListener("click", () => this.cancel());
    this.$("apply").addEventListener("click", () => this.apply());
    this.$("select-all").addEventListener("click", () => this.selectAll());
    this.$("preview").addEventListener("change", () => this.updateActions());
    this.$("close").addEventListener("click", () => window.close());
    window.addEventListener("unload", () => { this.controller?.abort(); this.resolveController?.abort(); });
    try {
      const context = await this.api.getContext(this.io);
      this.$("context").textContent = context.label;
      this.$("query").value = context.query;
      if (context.hints) {
        const hints = context.hints;
        this.$("hints").append(this.node("span", "PDF 标题为自动提取建议，可修正后重新搜索。只将查询文本发送到所选来源。"));
        for (const [label, value] of [["使用文件名标题", hints.filenameTitle], ["搜索 arXiv ID", hints.arxiv], ["搜索 DOI", hints.doi]]) {
          if (!value) continue;
          const button = this.node("button", label);
          button.type = "button";
          button.addEventListener("click", () => { this.$("query").value = value; this.search(); });
          this.$("hints").append(button);
        }
        if (hints.error) this.$("hints").append(this.node("span", "PDF 文本读取失败，可手动输入标题。", "error"));
      }
    } catch (e) { this.$("status").textContent = e.message; }
    this.$("query").disabled = false;
    this.$("search").disabled = false;
    this.$("query").focus();
    if (this.$("query").value.trim()) await this.search();
  },

  cancel() {
    if (this.busyWrite) return;
    this.controller?.abort();
    this.sequence++;
    this.$("cancel").hidden = true;
    this.$("search").disabled = false;
    this.$("status").textContent = "已取消。已返回的候选仍可查看。";
  },

  async search() {
    if (this.busyWrite) return;
    this.controller?.abort();
    this.resolveController?.abort();
    const sequence = ++this.sequence;
    this.controller = new window.AbortController();
    this.current = null;
    this.plan = null;
    this.autoMessage = "";
    this.saved = false;
    this.updateActions();
    this.$("search").disabled = true;
    this.$("cancel").hidden = false;
    this.$("status").textContent = "正在按标题发现发表出处，并检索对应来源…";
    this.$("preview").replaceChildren(this.node("p", "请选择候选查看元数据。", "empty"));
    this.$("results").replaceChildren();
    this.$("provider-status").replaceChildren();
    this.$("publication-summary").textContent = "";
    this.$("count").textContent = "";
    const providers = [...this.$("sources").querySelectorAll("input:checked")].map(i => i.value);
    try {
      const state = await this.engine.search(this.$("query").value, {
        providers, signal: this.controller.signal,
        onProgress: state => { if (sequence === this.sequence) this.renderResults(state); }
      });
      if (sequence !== this.sequence) return;
      this.renderResults(state);
      this.$("publication-summary").textContent = state.publicationSummary || "";
      const failures = state.statuses.filter(s => !s.ok).length;
      this.$("status").textContent = state.candidates.length
        ? `找到 ${state.candidates.length} 个候选。${failures ? `${failures} 个来源不可用，结果可能不完整。` : "请选择论文版本并核对字段。"}`
        : "未找到候选。请修正或缩短标题，或直接输入 arXiv ID、DOI、会议官网或出版社链接。";
      if (this.$("auto-fill").checked && !this.current && state.candidates.length) {
        const match = await this.api.automaticCandidate(this.io, state.candidates, this.engine, this.controller.signal);
        if (sequence !== this.sequence || this.current) return;
        if (match.candidate) await this.select(match.candidate, { autoFill: true });
        else if (match.reason) this.$("status").textContent += ` ${match.reason}`;
      }
    } catch (e) {
      if (sequence === this.sequence) this.$("status").textContent = e.message;
    } finally {
      if (sequence === this.sequence) {
        this.$("search").disabled = false;
        this.$("cancel").hidden = true;
      }
    }
  },

  renderResults(state) {
    this.$("count").textContent = `(${state.candidates.length})`;
    this.$("provider-status").replaceChildren(...state.statuses.map(s => this.node("span",
      `${s.source === "Web" ? "联网发现" : s.source}: ${s.ok ? `${s.count} 条${s.source === "Web" ? "官网线索" : "来源记录"}` : s.message}`, `source-status ${s.ok ? "" : "error"}`)));
    const buttons = state.candidates.map(candidate => {
      const { item } = candidate;
      const button = this.node("button", "", "candidate");
      button.type = "button";
      button.dataset.source = candidate.source;
      button.dataset.sourceURL = candidate.sourceURL;
      if (this.current?.sourceURL === candidate.sourceURL && this.current?.source === candidate.source) button.classList.add("selected");
      const status = candidate.publicationStatus || (item.itemType === "preprint" ? "preprint" : "published");
      button.append(this.node("span", `${candidate.source} · ${{preprint:"预印本",published:"正式发表记录",unverified:"发表出处待核对"}[status]}`, "badge"));
      button.append(this.node("strong", item.title));
      button.append(this.node("small", `${item.date || "日期待获取"} · 标题相似度 ${Math.round(candidate.score * 100)}%`));
      button.append(this.node("small", `出处：${item.proceedingsTitle || item.publicationTitle || item.repository || "待核对"}`));
      if (item.creators?.length) button.append(this.node("small", item.creators.slice(0, 4).map(c => `${c.firstName || ""} ${c.lastName}`).join(", ")));
      button.addEventListener("click", () => this.select(candidate, { autoFill: this.$("auto-fill").checked }));
      return button;
    });
    this.$("results").replaceChildren(...buttons);
  },

  creatorText(creators) { return creators.map(c => `${c.firstName || ""} ${c.lastName || ""}`.trim()).join("; "); },

  async select(candidate, { autoFill = false, changeType = false } = {}) {
    if (this.busyWrite) return;
    if (this.current?.source !== candidate.source || this.current?.sourceURL !== candidate.sourceURL) this.autoMessage = "";
    this.resolveController?.abort();
    this.resolveController = new window.AbortController();
    this.current = candidate;
    this.plan = null;
    this.saved = false;
    const sequence = this.sequence;
    this.updateActions();
    this.$("preview").replaceChildren(this.node("p", "正在获取完整元数据…", "empty"));
    for (const button of this.$("results").querySelectorAll("button")) {
      button.classList.toggle("selected", button.dataset.source === candidate.source && button.dataset.sourceURL === candidate.sourceURL);
    }
    let resolved;
    try {
      resolved = await this.engine.resolve(candidate, { signal: this.resolveController.signal });
      if (this.current !== candidate || sequence !== this.sequence) return;
      if (autoFill) {
        this.busyWrite = true;
        try {
          const filled = await this.api.autoFill(this.io, resolved);
          this.autoMessage = filled.fields.length
            ? `已自动补全：${filled.fields.map(f => this.labels[f] || f).join("、")}。已有字段未覆盖；可用 Zotero 撤销。`
            : "匹配后没有可自动填入的空缺字段，或匹配条件不足。";
        } finally { this.busyWrite = false; }
      }
      const plan = await this.api.plan(this.io, resolved, { changeType });
      if (this.current !== candidate || sequence !== this.sequence) return;
      const duplicates = plan.target.existing ? [] : await this.api.findDuplicates(this.io.libraryID, resolved.item);
      if (this.current !== candidate || sequence !== this.sequence) return;
      this.current = resolved;
      this.plan = plan;
      this.renderPlan(duplicates);
      this.updateActions();
      this.$("status").textContent = this.autoMessage || (plan.target.existing ? "已选择候选；空缺字段已勾选，已有字段冲突和类型变化由你决定。" : "已选择候选；请核对后创建文献条目。");
    } catch (e) {
      if ((this.current === candidate || this.current === resolved) && sequence === this.sequence) {
        this.plan = null;
        this.$("preview").replaceChildren(this.node("p", e.message, "error"));
        this.updateActions();
      }
    }
  },

  renderPlan(duplicates = []) {
    const resolved = this.current, plan = this.plan;
    const preview = this.$("preview");
    preview.replaceChildren();
    preview.append(this.node("p", `${resolved.source} · ${this.typeLabels[resolved.item.itemType] || "文献记录"}`));
    const link = this.node("button", "打开元数据来源", "source-link");
    link.type = "button";
    link.title = resolved.sourceURL;
    link.addEventListener("click", () => this.io.opener.ZoteroPane.loadURI(resolved.sourceURL));
    preview.append(link);
    if (this.autoMessage) preview.append(this.node("p", this.autoMessage, "success"));
    if (resolved.item.itemType === "preprint") preview.append(this.node("p", "这是预印本记录，不能据此推断已被会议或期刊接收。", "warning"));
    if (resolved.publicationStatus === "unverified") preview.append(this.node("p", "数据库尚未提供可核对的正式发表出处，此候选不会自动填充。", "warning"));
    if (plan.typeWarning) preview.append(this.node("p", plan.typeWarning, "warning"));
    if (plan.typeWarning) {
      const row = this.node("div", "", "field");
      const label = this.node("label");
      const input = this.node("input");
      input.type = "checkbox"; input.value = "itemType"; input.checked = plan.changeType;
      label.append(input, this.node("span", `将条目类型从“${this.typeLabels[plan.originalType] || plan.originalType}”改为“${this.typeLabels[resolved.item.itemType] || resolved.item.itemType}”`));
      input.addEventListener("change", () => this.select(resolved, { changeType: input.checked }));
      row.append(label);
      for (const field of plan.preserved) row.append(this.node("p", `转换后保留在“其他”：${field}`, "caption"));
      preview.append(row);
    }
    for (const warning of resolved.warnings || []) preview.append(this.node("p", warning, "warning"));
    if (duplicates.length) preview.append(this.node("p", `目标库已有 ${duplicates.length} 条同标题记录。请核对是否重复；本次写入会新建条目。`, "warning"));
    const titleField = plan.fields.find(field => field.name === "title");
    if (titleField) this.renderField(titleField);
    if (plan.creators.after.length) this.renderField({ name: "creators", before: this.creatorText(plan.creators.before), after: this.creatorText(plan.creators.after), checked: plan.creators.checked, changed: plan.creators.changed });
    for (const field of plan.fields.filter(field => !["title", "abstractNote"].includes(field.name))) this.renderField(field);
    const abstractField = plan.fields.find(field => field.name === "abstractNote");
    if (abstractField) this.renderField(abstractField);
  },

  renderField({ name, before, after, checked, changed }) {
    const same = !changed;
    const row = this.node("div", "", `field${same ? " unchanged" : ""}`);
    const label = this.node("label");
    const input = this.node("input");
    input.type = "checkbox"; input.value = name; input.checked = same || checked; input.disabled = same;
    label.append(input, this.node("span", this.labels[name] || name));
    row.append(label);
    if (before) row.append(this.node("p", `现有：${before}`, "before"));
    row.append(this.node("p", `${before ? "候选" : "写入"}：${after}`));
    if (same) row.append(this.node("p", "与现有字段一致", "caption"));
    this.$("preview").append(row);
  },

  updateActions() {
    const inputs = [...this.$("preview").querySelectorAll('input[type="checkbox"]')].filter(i => !i.disabled);
    const pending = !!this.plan && inputs.some(i => i.checked);
    this.$("apply").disabled = this.busyWrite || !pending;
    this.$("apply").textContent = this.saved && !pending ? "已保存" : this.plan
      ? (this.plan.target.existing ? "更新选中字段" : "创建文献条目") : "写入选中字段";
    this.$("select-all").disabled = this.busyWrite || !this.plan || !inputs.some(i => !i.checked);
  },

  async selectAll() {
    if (!this.plan || this.busyWrite) return;
    const candidate = this.current, sequence = this.sequence;
    const type = this.$("preview").querySelector('input[value="itemType"]');
    // A type change rebuilds the field list; select the resulting fields afterward.
    if (type && !type.checked && !type.disabled) await this.select(candidate, { changeType: true });
    if (!this.plan || this.current !== candidate || sequence !== this.sequence) return;
    for (const input of this.$("preview").querySelectorAll('input[type="checkbox"]')) {
      if (!input.disabled) input.checked = true;
    }
    this.updateActions();
  },

  async apply() {
    if (!this.current || !this.plan || this.busyWrite) return;
    const selected = [...this.$("preview").querySelectorAll('input[type="checkbox"]')].filter(i => i.checked && !i.disabled).map(i => i.value);
    if (!selected.length) { this.$("status").textContent = "请勾选要写入的字段。"; return; }
    this.busyWrite = true;
    this.controller?.abort();
    this.resolveController?.abort();
    this.sequence++;
    this.$("cancel").hidden = true;
    this.$("search").disabled = true;
    this.updateActions();
    try {
      const saved = await this.api.apply(this.io, this.current, selected.filter(f => !["creators", "itemType"].includes(f)), selected.includes("creators"), this.plan);
      this.$("status").textContent = `已保存：${saved.getField("title")}。`;
      this.io.itemID = saved.id;
      this.saved = true;
      this.autoMessage = "";
      try {
        const scrollTop = this.$("preview").parentElement.scrollTop;
        this.plan = await this.api.plan(this.io, this.current);
        this.renderPlan();
        for (const input of this.$("preview").querySelectorAll('input[type="checkbox"]')) {
          if (!input.disabled) input.checked = false;
        }
        this.$("preview").parentElement.scrollTop = scrollTop;
        this.$("context").textContent = `补充元数据：${saved.getField("title")}`;
      } catch (e) {
        this.plan = null;
        this.$("status").textContent += "预览刷新失败，请重新选择候选。";
        console.warn("Paper Metadata Search: unable to refresh saved preview", e);
      }
      // Selecting the item is optional UI work after the transaction has committed.
      // A closing/unready main window must not turn a successful save into a retry.
      try {
        await this.io.opener.ZoteroPane.selectItem(saved.id);
      } catch (e) {
        console.warn("Paper Metadata Search: unable to select saved item", e);
        this.$("status").textContent += "可在文献库中查看。";
      }
    } catch (e) {
      this.$("status").textContent = `保存失败：${e.message}`;
    } finally {
      this.busyWrite = false;
      this.$("search").disabled = false;
      this.updateActions();
    }
  }
};
window.addEventListener("load", () => { MetadataDialog.ready = MetadataDialog.init(); }, { once: true });
