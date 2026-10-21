const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'addon/search.js'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'addon/search.xhtml'), 'utf8').replace(/html:/g, '')
  .replace(/<(p|div|span)([^>]*?)\/>/g, '<$1$2></$1>');

function fixture({ query = 'Example paper', type = 'journalArticle', candidateType = type } = {}) {
  const { window, document } = parseHTML(markup);
  window.AbortController = AbortController;
  for (const input of document.querySelectorAll('input')) input.checked = input.hasAttribute('checked');
  const record = { id: 1, title: 'Example paper', itemType: type, date: '2025-11-12', DOI: '', abstractNote: '' };
  const creators = [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }];
  const candidate = { source: 'Test', sourceURL: 'https://example.org/paper', score: 1, resolved: true,
    item: { title: record.title, itemType: candidateType, date: '2025', DOI: '10.1234/example',
      abstractNote: 'Candidate abstract', creators, ...(candidateType === 'preprint' ? {repository:'arXiv'} : {}) } };
  const searches = [], writes = [];
  const engine = {
    search: async (text, options) => { searches.push({text, options}); return {candidates:[candidate], statuses:[]}; },
    resolve: async c => c
  };
  const api = {
    createEngine: () => engine,
    getContext: async () => ({label:'Example context', query}),
    automaticCandidate: async () => ({candidate}),
    autoFill: async () => ({fields:[]}),
    findDuplicates: async () => [],
    plan: async (io, result, {changeType = false} = {}) => {
      const targetType = changeType ? result.item.itemType : record.itemType;
      const names = ['title', 'date', 'DOI', 'abstractNote', ...(targetType === 'preprint' ? ['repository'] : [])];
      return {target:{existing:true}, type:targetType, originalType:record.itemType,
        changeType:changeType && record.itemType !== result.item.itemType, preserved:[],
        typeWarning:record.itemType !== result.item.itemType ? 'Type conflict' : '',
        snapshot:JSON.stringify(record),
        fields:names.map(name => ({name, before:record[name] || '', after:result.item[name],
          checked:!record[name], changed:(record[name] || '') !== result.item[name]})),
        creators:{before:creators, after:creators, checked:false, changed:false}};
    },
    apply: async (io, result, fields, useCreators, plan) => {
      assert.equal(plan.snapshot, JSON.stringify(record), 'each save must use a fresh preview');
      writes.push({fields:[...fields], useCreators, changeType:plan.changeType});
      if (plan.changeType) record.itemType = result.item.itemType;
      for (const name of fields) record[name] = result.item[name];
      return {id:record.id, getField:name => record[name]};
    }
  };
  window.arguments = [{api, itemID:record.id, libraryID:1, opener:{ZoteroPane:{selectItem:async () => {}}}}];
  const context = vm.createContext({window, document, console});
  vm.runInContext(script, context);
  const ui = context.MetadataDialog;
  const box = name => ui.$('preview').querySelector(`input[value="${name}"]`);
  function toggle(name, checked) {
    box(name).checked = checked;
    box(name).dispatchEvent(new window.Event('change', {bubbles:true}));
  }
  return {ui, record, candidate, api, engine, searches, writes, box, toggle, window};
}

test('opening a populated context starts one search without a second click', async () => {
  const f = fixture();
  await f.ui.init();
  assert.equal(f.searches.length, 1);
  assert.equal(f.searches[0].text, 'Example paper');
  assert.ok(f.ui.plan);
  assert.equal(f.writes.length, 0);
});

test('opening an empty context waits for the user to enter a query', async () => {
  const f = fixture({query:'  '});
  await f.ui.init();
  assert.equal(f.searches.length, 0);
  assert.equal(f.ui.$('search').disabled, false);
});

test('unchanged fields and authors are checked, disabled, and styled gray', async () => {
  const f = fixture();
  await f.ui.init();
  for (const name of ['title', 'creators']) {
    assert.equal(f.box(name).checked, true);
    assert.equal(f.box(name).disabled, true);
    assert.ok(f.box(name).closest('.field').classList.contains('unchanged'));
  }
  assert.equal(f.box('date').checked, false);
  assert.equal(f.box('date').disabled, false);
});

test('a second selection after saving re-enables apply and saves only that change', async () => {
  const f = fixture();
  await f.ui.init();
  f.toggle('abstractNote', false);
  await f.ui.apply();
  assert.deepEqual(f.writes[0].fields, ['DOI']);
  assert.equal(f.writes[0].useCreators, false);
  assert.equal(f.box('DOI').checked, true);
  assert.equal(f.box('DOI').disabled, true);
  assert.equal(f.box('abstractNote').checked, false, 'an omitted field stays unselected after save');
  assert.equal(f.ui.$('apply').disabled, true);
  assert.equal(f.ui.$('apply').textContent, '已保存');
  f.toggle('date', true);
  assert.equal(f.ui.$('apply').disabled, false);
  assert.equal(f.ui.$('apply').textContent, '更新选中字段');
  await f.ui.apply();
  assert.deepEqual(f.writes[1].fields, ['date']);
  assert.equal(f.record.date, '2025');
  assert.equal(f.record.title, 'Example paper');
  assert.equal(f.box('date').disabled, true);
});

test('select all includes only preview choices and does not save before confirmation', async () => {
  const f = fixture();
  await f.ui.init();
  f.toggle('DOI', false);
  const source = f.ui.$('sources').querySelector('input');
  source.checked = false;
  await f.ui.selectAll();
  assert.ok([...f.ui.$('preview').querySelectorAll('input')].every(i=>i.checked));
  assert.equal(source.checked, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.ui.$('select-all').disabled, true);
  assert.equal(f.ui.$('apply').disabled, false);
  f.toggle('date', false);
  assert.equal(f.ui.$('select-all').disabled, false);
});

test('select all rebuilds a type-conversion preview before selecting its new fields', async () => {
  const f = fixture({candidateType:'preprint'});
  await f.ui.init();
  assert.equal(f.box('itemType').checked, false);
  assert.equal(f.box('repository'), null);
  await f.ui.selectAll();
  assert.equal(f.box('itemType').checked, true);
  assert.equal(f.box('repository').checked, true);
  assert.equal(f.record.itemType, 'journalArticle');
  assert.equal(f.writes.length, 0);
  await f.ui.apply();
  assert.equal(f.record.itemType, 'preprint');
  assert.equal(f.record.repository, 'arXiv');
  assert.equal(f.box('itemType'), null);
  assert.equal(f.box('repository').disabled, true);
});

test('a failed save leaves the pending selection available for retry', async () => {
  const f = fixture();
  await f.ui.init();
  f.api.apply = async () => {throw new Error('Test write failure');};
  await f.ui.apply();
  assert.match(f.ui.$('status').textContent, /保存失败/);
  assert.equal(f.ui.$('apply').disabled, false);
  assert.equal(f.box('DOI').checked, true);
  assert.equal(f.box('DOI').disabled, false);
});
