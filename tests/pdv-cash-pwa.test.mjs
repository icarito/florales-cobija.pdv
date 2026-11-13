import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [app, index, pdv] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../pdv.html', import.meta.url), 'utf8'),
]);

test('cash can be opened and closed from both ERP and PDV', () => {
  assert.match(app, /data-action="cash-open"/);
  assert.match(app, /data-action="cash-close"/);
  assert.match(app, /data-action="pos-cash-session"/);
  assert.match(app, /'pos-cash-open'/);
  assert.match(app, /'pos-cash-close'/);
  assert.match(app, /Abra la caja antes de registrar una venta/);
  assert.doesNotMatch(app.match(/async function startAuthenticated[\s\S]*?function renderLogin/)?.[0] || '', /ensureCashSession\(\)/);
});

test('PWA installation lives in settings instead of floating over the UI', () => {
  assert.doesNotMatch(index, /id="pwaInstallButton"/);
  assert.doesNotMatch(pdv, /id="pwaInstallButton"/);
  assert.match(app, /\['app','Instalar aplicativo'\]/);
  assert.match(app, /data-action="install-pwa"/);
  assert.match(app, /La instalación queda aquí para no ocupar espacio en el PDV/);
});

test('production login hides demonstration credentials', () => {
  assert.doesNotMatch(app, /data-demo-login/);
  assert.doesNotMatch(app, /admin@example\.invalid/);
  assert.doesNotMatch(app, /func123/);
});

test('tutorials are on demand inside settings and never start automatically', () => {
  assert.doesNotMatch(index, /data-view="tutorial"/);
  assert.match(app, /\['tutorial','Tutoriales'\]/);
  assert.match(app, /open-tutorial-center'[\s\S]*ui\.settingsTab='tutorial'/);
  assert.doesNotMatch(app, /showFirstTutorial/);
  assert.match(app, /Las guías solo comienzan cuando usted las elige/);
});

test('settings expose release notes', () => {
  assert.match(app, /\['updates','Notas de actualización'\]/);
  assert.match(app, /Versión de producción/);
  assert.match(app, /releaseNotes/);
});


test('POS withdrawal form selects an outflow and returns to cash on cancel', () => {
  let html;
  const ctx = vm.createContext({ openLayer: value => { html = value; }, layerHead: () => '' });
  vm.runInContext(app.slice(app.indexOf('function cashForm('), app.indexOf('function quickSettings(')), ctx);
  ctx.cashForm('out', true);
  assert.match(html, /value="out" selected/);
  assert.match(html, /data-return-pos="1"/);
  assert.match(html, /data-action="pos-cash-session"/);
  ctx.cashForm();
  assert.match(html, /value="in" selected/);
  assert.match(html, /data-return-pos="0"/);
});

test('saving a POS withdrawal persists its currency and returns to cash', async () => {
  const start = app.indexOf("if(f.id==='cashForm')");
  const end = app.indexOf("\n", start);
  for (const currency of ['BOB', 'BRL']) {
    let saved, returned = false;
    const ctx = vm.createContext({
      f: { id: 'cashForm', dataset: { returnPos: '1' } },
      d: { type: 'out', currency, amount: '25', description: 'Entrega' },
      ensureCashSession: () => ({ id: 'session' }), terminalId: 'terminal',
      currentEmployee: () => ({ name: 'Caja' }), state: { cash: [] },
      FloralisBackend: { addCashMovement: async movement => { saved = movement; return { id: 'remote' }; } },
      save() {}, auditEvent() {}, directCurrencyMoney: String, toast() {},
      posSettingsPanel: tab => { assert.equal(tab, 'cash'); returned = true; },
      closeLayer() { throw Error('must return to POS cash'); }, render() {},
    });
    await vm.runInContext('(async()=>{' + app.slice(start, end) + '})()', ctx);
    assert.equal(saved.type, 'out');
    assert.equal(saved.currency, currency);
    assert.equal(saved.amountBob, currency === 'BOB' ? 25 : 0);
    assert.equal(saved.amountBrl, currency === 'BRL' ? 25 : 0);
    assert.equal(saved.cashSessionId, 'session');
    assert.equal(ctx.state.cash[0].id, 'remote');
    assert.equal(returned, true);
  }
});
