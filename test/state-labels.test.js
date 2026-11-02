// State names and state-specific sources in the saved-property library and the printable report.
// stateName() in public/property-actions.js covers WA, ID and MT; the report's well-record source
// names each state's agency (Ecology, IDWR, MBMG GWIC) instead of "Washington Ecology" everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readPublic, renderReport } from './ui-harness.js';

test('stateName() in property-actions.js names Washington, Idaho and Montana', () => {
  const lines = readPublic('property-actions.js').split('\n').map(l => l.trim());
  const code = ['const STATE_NAMES', 'function stateName('].map(start => {
    const line = lines.find(l => l.startsWith(start));
    assert.ok(line, `property-actions.js defines ${start}`);
    return line;
  }).join('\n');
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  const name = c => vm.runInContext(`stateName(${JSON.stringify(c)})`, ctx);
  assert.equal(name('WA'), 'Washington');
  assert.equal(name('ID'), 'Idaho');
  assert.equal(name('MT'), 'Montana');
  assert.equal(name('id'), 'Idaho');
  assert.equal(name('OR'), 'OR', 'an unknown code is shown as given');
  assert.equal(name(''), '');
  assert.equal(name(undefined), '');
});

const square = { type: 'Polygon', coordinates: [[[-116.6, 47.3], [-116.59, 47.3], [-116.59, 47.31], [-116.6, 47.31], [-116.6, 47.3]]] };
const reportFor = props => renderReport({ data: { parcel: { type: 'Feature', geometry: square, properties: { ORIG_PARCEL_ID: 'P1', ...props } }, wells: [], utility: [] }, mappedSqm: 20000 });

test("the report names each state's well-record agency", () => {
  const id = reportFor({ _countyDisplay: 'Kootenai', _stateCode: 'ID', _stateDisplay: 'Idaho' });
  assert.match(id, /Idaho Department of Water Resources \(IDWR\) well records/);
  assert.doesNotMatch(id, /Washington Ecology/);
  const mt = reportFor({ _countyDisplay: 'Gallatin', _stateCode: 'MT', _stateDisplay: 'Montana' });
  assert.match(mt, /Montana Bureau of Mines and Geology GWIC well records/);
  assert.doesNotMatch(mt, /Washington Ecology/);
  // WA parcels (statewide layer) carry no state field.
  const wa = reportFor({ COUNTY_NM: 'Spokane' });
  assert.match(wa, /Washington Ecology well records/);
  assert.doesNotMatch(wa, /IDWR|GWIC/);
});
