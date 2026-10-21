# Paper Metadata Search for Zotero 10

按论文标题联网发现发表出处，再从对应官网、公开会议库和 DOI 登记记录取得元数据，同时保留预印本版本。默认使用网络发现、Crossref 和 arXiv。OpenAlex、DBLP 已移除。用户无需预先知道会议或期刊名称；会议示例不构成检索范围。插件可为未识别的 PDF 创建父条目，自动补全已有文献的空缺字段，并把字段与类型冲突留待确认。

## 安装和使用

1. 从本项目的 [Releases](https://github.com/Archwindos/metadata-search-for-zotero/releases) 下载 `paper-metadata-search-0.4.0.xpi`；自行构建时生成到 `dist/`。
2. 在 Zotero 10 的 **工具 → 插件** 中将 XPI 拖进去，或通过齿轮菜单选择“从文件安装插件”。
3. 右键选中一份 PDF 或一个文献条目，选择 **搜索论文元数据…**。有标题时窗口会立即搜索，无需再点一次搜索。也可以从 **工具 → 搜索论文元数据…** 开始创建新条目；空白查询仍需输入。
4. PDF 会在本地提取标题建议；可以修改标题，或使用识别到的 DOI/arXiv ID。对已有文献，默认自动补全唯一且标题、完整作者列表及版本一致的候选所提供的空缺字段；可取消“高置信匹配后自动补全”勾选，改为全部手动预览。
5. 已有字段冲突保持不勾选。类型不一致时，勾选“将条目类型从……改为……”后可预览目标类型字段，再点“更新选中字段”。转换时无法迁移的旧字段会保存在“其他”，原 PDF、集合和标签保留。独立 PDF 和新建文献仍需选择候选后点击“创建文献条目”。

### 0.4.0：发现出处后查询对应来源

- 首先按完整标题查询公开网页搜索结果，定位论文页面或会议信息。搜索摘要仅作为线索；读取目标页面后重新核对完整题名和作者。
- 出处是 OpenReview 会议时，读取官方公开标题搜索 API 的接收记录；按记录所在年代使用 API 1 或 API 2。仅成功但无记录时检查另一版本，访问拒绝或限流后停止该来源。投稿、撤稿和拒稿记录不会自动标成正式发表。TMLR 接收记录按期刊处理。
- 出处是 ICCV、CVPR、WACV 等 CVF 会议时读取对应论文页面；网页搜索漏掉论文时，可由 DOI 登记的会议和年份定向查询官方索引。
- 对其他出版社读取标准 `citation_*` 字段，包含题名、完整作者、会议/期刊、日期、DOI、页码、摘要等；不以会议名称的固定清单决定覆盖。ACL Anthology、PMLR、Nature 等已实测。缺少标准字段或访问受限的页面仍可能无法解析，此时保留 Crossref、公开会议库或 arXiv 的其他结果。
- NeurIPS 解析器只在网页线索或已匹配发表记录指向该来源时补充检索。界面已移除单独的 NeurIPS、OpenAlex 和 DBLP 来源选项。
- 官网省略 DOI 时，仅以完整作者、题名、年份及版本一致的唯一 Crossref 记录补充；同一 DOI 的页码等差异仍交给用户处理。没有正式版 DOI 的论文不会套用预印本 DOI。
- 实际联网样例覆盖 LoRA（ICLR 2022）、Swin Transformer（ICCV 2021）、SimCLR（ICML 2020）、BERT（NAACL 2019）、AlphaFold（Nature）、DINOv2（TMLR 2024），见 `docs/general-search-results-0.4.0.json`。

### 0.3.1 起支持：自动开始检索与连续更新

- 打开已有条目或 PDF 的检索窗口后，自动使用读取到的标题搜索；仍可取消、修改标题并重搜。
- 保存后立即根据最新条目刷新预览；再勾选其他冲突字段时，“更新选中字段”重新启用，支持连续多次更新。
- 一致字段（包括作者）以灰色显示，复选框保持勾选且不可取消，不会重复写入。作者姓名相同但角色不同仍按冲突处理。
- “全选可选项”勾选当前候选的所有可选字段及类型修正；类型转换后新增的字段也会选中。检索来源不受影响，仍需点击更新才会保存。

### 0.3.0 历史版本：跨库查找发表出处（来源配置已由 0.4.0 替换）

- 默认从 Crossref 和 OpenAlex 的跨出版社索引中检索会议与期刊记录，DBLP 补充计算机领域记录，arXiv 提供预印本。结果卡片显示出处和版本；检索来源收进高级选项，主界面只需输入标题。
- arXiv 提供正式版 DOI 时，进一步查询其登记信息；输入 arXiv ID 也会按标题查找正式版本。预印本 DOI 和正式发表 DOI 保持分离。OpenAlex 记录可通过相同 DOI 的 Crossref 登记信息补充完整字段。
- NeurIPS 官网解析器保留为兜底和已发现 NeurIPS 记录的补充；已经找到其他会议或期刊的对应正式记录时，不请求 NeurIPS 官网。当前专用官网解析器覆盖 NeurIPS，其他出处的覆盖取决于通用数据库。
- 多个来源指向相同 DOI 时，允许一致字段自动补空；有差异的字段不自动写入。不同 DOI 或不同发表版本不自动合并。仓储中的会议稿、数据集、软件和评审记录不会被自动标成已确认的期刊或会议论文。
- 未找到正式记录时显示“不能证明论文尚未发表”。索引更新滞后、无 DOI 论文和数据库访问限制仍可能导致漏检。OpenAlex 的[官方认证说明](https://help.openalex.org/api/authentication/)允许少量匿名查询，达到限额时按来源失败处理，不绕过限流；Semantic Scholar 本次返回 429，因此未纳入默认来源。
- 实测 BERT → NAACL 2019、ResNet → CVPR 2016、AlphaFold → Nature；跨库联网记录见 `docs/general-search-results.json`。

### 0.2.0 起支持：预印本 DOI、类型修正与自动补全

- arXiv 返回的预印本会写入自身 DOI `10.48550/arXiv.<编号>`，DOI 不含 `v1/v2` 修订后缀；修订编号仍保留在存档 ID 中。API 的 `arxiv:doi` 可能指向正式发表版本，会单独保留在“其他”，不当作预印本 DOI。
- 已核对用户提供的两篇：*From Data Statistics to Feature Geometry: How Correlations Shape Superposition* 的 DOI 是 `10.48550/arXiv.2603.09972`；*From Directions to Regions: Decomposing Activations in Language Models via Local Geometry* 的 DOI 是 `10.48550/arXiv.2602.02464`。二者的 arXiv 来源记录均应使用“预印本”类型，官方页面证据在 `docs/preprint-investigation.json`。
- 旧版更新条目时固定保留原类型，导致已经误标为“期刊文章”的记录无法在插件里修正。新版把类型变化单独列为需要确认的选项，不再静默忽略候选类型。
- 自动补全仅在标题顺序、完整作者列表及版本标识足够一致时写入空缺字段。标题允许大小写、重音、标点差异及一个长单词的单字母拼写差异；不接受仅词袋相似、作者缺失、不同 DOI、不同 arXiv 编号或修订版本。匹配候选指向不同身份或版本时仍由用户选择；相同 DOI 的多来源一致字段可自动补空。普通相似度分数不作为自动写入依据。
- 自动写入不改已有值或类型；并发修改会阻止过期写入。自动补全及手动类型修正均支持 Zotero 撤销。

支持输入示例：

- `Memory Mosaics at scale`
- `NeurIPS-2025-memory-mosaics-at-scale-Paper-Conference.pdf` 对应的 PDF 会得到标题建议
- `https://proceedings.neurips.cc/paper_files/paper/2025/hash/3767842e2ebee900236f534855aa2c36-Abstract-Conference.html`
- 相应的 NeurIPS PDF 链接；也支持旧的 `papers.nips.cc/paper/...` 路径
- `arXiv:2507.03285`、`https://arxiv.org/abs/2507.03285`、`10.48550/arXiv.2507.03285`
- `10.52202/085713-1299`
- `LoRA: Low-Rank Adaptation of Large Language Models`
- `Swin Transformer: Hierarchical Vision Transformer Using Shifted Windows`
- `https://iclr.cc/virtual/2022/poster/6319`
- CVF 官方论文页面或 PDF 链接、PMLR 和其他出版社的论文页面

标题检索先发现出处，再查询所选登记库与对应官网；独立来源并行执行，一个平台失败不会使其他结果消失。相似度是标题排序提示，并不是自动确认论文身份的置信概率。同标题的会议版、期刊版和预印本不会自动合并。

输入 DOI 或出版社链接时，插件直接查询对应来源；arXiv ID 还会根据返回的标题及关联 DOI 继续发现正式版。OpenReview 论坛链接请改用论文标题，避免请求目前需要人机验证的论坛页面。高级选项控制联网发现、Crossref 和 arXiv。

## 调查：内置检索有哪些局限

以下为 2026-10-11 的历史调查；目标和原生测试版本为 Zotero 10.0.6。0.4.0 的来源变化见上方说明。

**PDF 识别和网页抓取走不同链路。** [Zotero 的 PDF 识别说明](https://www.zotero.org/support/retrieve_pdf_metadata)说明，客户端将前几页文本发给识别服务，结合提取算法、Crossref 记录和标识符查询生成父条目。[NeurIPS 网页 translator](https://github.com/zotero/translators/blob/master/Neural%20Information%20Processing%20Systems.js)则从正式页面读取 BibTeX 或嵌入元数据。因此存在网页有完整信息、PDF 识别仍失败的情况。

**截图中的失败已复现。** 在新建的独立 Zotero 测试库中，下载 NeurIPS 官方的《Memory Mosaics at scale》PDF，调用本机内置 `RecognizeDocument._recognize()` 得到 `null`（无匹配）。同次测试中，插件的标题检索找到了 NeurIPS 正式记录和 arXiv:2507.03285，并通过官方 BibTeX 获得两位作者、2025 年、卷 38、38929–38956 页和 DOI `10.52202/085713-1299`。这证明该样例存在内置识别缺口；服务端未公开的匹配过程不足以判断历史失败的具体原因，不能据此声称所有 NeurIPS 论文均不可识别。

**标识符和题名都有覆盖边界。** 旧论文可能没有 DOI；本次验证的 NeurIPS 2017《Attention Is All You Need》官方页面没有提供 DOI，但仍能通过正式页面获取会议元数据。Crossref 标题检索还返回同名、不同年份的记录，直接把第一条当作正式版会产生错误。本插件保留来源、文献类型和版本，要求用户核对后写入。

**格式和平台状态会影响检索。** 旧 `/paper/` 路径、当前 `/paper_files/paper/` 路径以及 `-Paper-Conference.pdf` 后缀均已处理。Zotero 10 的 PDF 文本为带坐标的嵌套单词数组，本插件按行、空格和字体大小恢复标题。arXiv 返回预印本，不自动宣称会议接收；DBLP 返回正式记录或非正式出版记录，按其类型显示。

**数据源可临时不可用。** 本次 DBLP API 返回人机验证页面，已记录为来源失败；JSON/XML 解析与回退逻辑有离线测试，尚未在当前网络下验证真实 DBLP 搜索成功。NeurIPS、arXiv、Crossref 的在线检索已通过。OpenReview 在调查时返回 403，本版未接入，输入该平台链接时会提示改用标题检索。

2026-10-12 再次检查 DBLP 官方搜索 API，响应仍是 HTTP 200 的 HTML 人机验证页，而非 JSON 元数据；记录见 `docs/dblp-recheck.json`。这属于来源暂不可用，不等于论文不存在。

## 数据与行为

- 无需 API 密钥，无需外部服务部署。插件 JavaScript 没有运行时 npm 依赖。
- PDF 文本仅在 Zotero 本地读取；对外发送用户选择的标题、标识符或论文 URL。不会上传整份 PDF，也不会上传提取出的整页文本。
- 创建和修改条目走 Zotero 的对象 API 与事务；不会直接写 SQLite。
- 更新已有条目支持 Zotero 10 的撤销。新建对象本身不在 Zotero 10 的撤销范围内；如有误，可把 PDF 拖回顶层后删除新父条目。
- 写入前重新检查父条目和选中字段，防止原生识别或其他窗口的并发修改被覆盖。所有字段更改与 PDF 挂接在同一个事务中完成。
- 同标题条目会显示重复提示，但不会自动合并。每次处理一条文献；自动补全只作用于当前选中的已有文献或 PDF 的父条目。
- 每个 HTTP 请求最多等待 18 秒；不自动重试 429/403，arXiv 请求间隔至少 3 秒。取消检索会中止请求，并阻止过期结果覆盖界面。
- 扫描 PDF 无法直接提取标题时，请手动输入；不提供 OCR。PDF 标题分行、多栏、非常规排版可能仍需人工修正。

这是本地发布的 0.4.0 版本。Zotero 的 manifest 校验要求提供 `update_url`，因此使用保留的 `.invalid` 域名明确表示暂未发布更新服务；升级请手动安装新版 XPI。若升级后仍看到旧窗口或旧样式，请重启 Zotero。

## 开发与验证

需要 Node.js 20+：

```powershell
npm ci
npm test
npm run test:live
node scripts/verify-general-search.cjs
npm run build
```

`npm test` 验证网络发现顺序、通用出版社引用字段、OpenReview 接收状态、CVF 定向查询、已移除来源不被请求，以及 PDF 标题、版本、取消和保存交互。`node scripts/verify-general-search.cjs` 验证多个会议和期刊并写入版本化的联网记录；`npm run test:live` 保留 NeurIPS 样例回归。

命令行联网测试只解析 NeurIPS 网页嵌入字段，没有 Zotero 的 BibTeX 导入器，因此其记录中的日期可能是网页发布日期。例如本样例的网页日期是 2026-04-23，正式引用年份是 2025。NeurIPS 解析器实际使用官方 BibTeX 优先；0.1.0 在日常文献库中的原 PDF 与“可解释性”分类保留情况见 `docs/installation-results.json`。最新原生测试见 `docs/native-results.json`，0.3.0 的实际安装和补全记录见 `docs/installation-results-0.3.0.json`。不同来源的页码等字段存在差异时保留冲突供核对。

Windows 原生验证：先将上述 NeurIPS 官方 PDF 保存为 `.runtime-test/memory-mosaics.pdf`，然后运行：

```powershell
./scripts/test-zotero.ps1 -ZoteroExe 'D:\software\zotero\zotero.exe'
./scripts/test-zotero.ps1 -ZoteroExe 'D:\software\zotero\zotero.exe' -Packaged
```

测试会新建 `.runtime-test/run-*/profile` 和独立数据目录，使用 `-no-remote` 启动隐藏的 Zotero，运行完成后自动退出。不会安装插件到日常配置文件，也不会接触日常文献库。原生验证记录和实际 Gecko 界面截图保存在 `docs/native-results.json`、`docs/native-preview.png`。

0.3.0 通过 **29 项离线测试、41 项原生检查**。原生检查使用打包后的 XPI，覆盖跨会议与期刊的真实联网检索、预印本 DOI、版本与完整作者匹配、自动补空、类型转换预览、PDF 父条目创建、集合与文件保留、已有字段保护、并发修改、界面写入和撤销。新记录见 `docs/native-results-0.3.0.json`；旧版记录单独保留。Crossref 本次没有返回样例摘要，因此隔离库的字段冲突测试使用明确标注的合成摘要，真实网络返回另存于报告的 `resolved` 字段。NeurIPS 官网本次间歇超时，通用来源仍完成检索。

0.3.1 通过 **36 项离线测试、51 项原生检查**，新增覆盖打开窗口即搜索、空白查询等待输入、一致字段锁定、作者角色差异、保存后重新勾选并连续提交、逐次撤销、全选及类型转换后新增字段的选择。记录见 `docs/native-results-0.3.1.json`，界面截图见 `docs/native-preview-0.3.1.png`。交互回归使用隔离库中的确定性候选，联网查询另行执行并保留来源状态。

0.4.0 通过 **42 项离线测试、57 项原生检查**。增加了多来源的真实会议/期刊发现、ICML 正式页面引用导入、TMLR 期刊类型和受限来源移除检查。六类会议/期刊的 Node 联网记录见 `docs/general-search-results-0.4.0.json`，打包后的 Zotero 记录见 `docs/native-results-0.4.0.json`。不同网络环境的网页索引可能返回不同链接，因此正式结果允许来自已核实的其他官方记录；测试仍会核对题名、类型、完整作者和出处。

验证记录包含安装包 SHA-256；测试配置中的 XPI 与交付文件逐字节一致，压缩包内容也已核对为 `addon/` 源码及许可证。`dist/` 同时提供校验文件。通用网页索引和来源接口仍可能遗漏无 DOI、尚未收录或访问受限的发表记录。以后的来源变更必须回归多个不同会议及至少一个期刊，不能以用户举出的单个会议代表整个需求。

公开仓库保留联网检索结果和独立测试库的原生检查记录，其中本机路径已替换为占位符。上述日常文献库安装记录、截图、测试库文件及缓存仅在本机保留，不随公开源码发布；`dist/` 的安装包和校验文件通过 Releases 提供。记录中的测试结果对应各自注明的日期，不代表后续所有网络环境均可用。

源代码布局：`addon/discovery.js` 为网络发现、通用网页元数据及公开会议库解析；`addon/core.js` 为检索编排和版本匹配；`addon/integration.js` 为 Zotero 菜单、PDF 提取和事务写入；`addon/search.*` 为预览界面；`tests/zotero-runner` 是独立测试插件，不会进入交付 XPI。

Zotero 10 的集合多选 API、文献修改撤销和 MenuManager 接口按[官方开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)适配。插件兼容范围为 `10.0` 至 `10.0.*`。
