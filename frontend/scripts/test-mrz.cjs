const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
// Execute the production TypeScript modules, with no runtime test dependency.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText, filename);
const { validateMrz, MrzConsensus, isMrzText } = require('../src/utils/mrzValidation.ts');
const { parseMrz } = require('../src/utils/cedula.ts');
const { ScannerSession } = require('../src/utils/scannerSession.ts');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tests/fixtures/mrz.json'), 'utf8'));
for (const fixture of fixtures) {
  const result = validateMrz(fixture.raw);
  assert.equal(result.valid, fixture.valid, fixture.name);
  const parsed = parseMrz(fixture.raw);
  assert.equal(parsed.mrz_valido, fixture.valid, fixture.name + ': parser');
  if (fixture.valid) {
    assert.equal(parsed.cedula, fixture.cedula, fixture.name);
    assert.equal(parsed.nombres, fixture.names, fixture.name);
  }
}
const raw = fixtures[0].raw, other = fixtures.find(f => f.name === 'other_person').raw;
assert.equal(isMrzText(raw), true);
assert.equal(isMrzText('PubDSK_\u0000ICCOL'), false, 'PDF417 bytes must not be misclassified as MRZ');
assert.equal(isMrzText('APELLIDO ICCOLLECTOR'), false, 'embedded name must not be classified as MRZ');
const consensus = new MrzConsensus();
consensus.observe(raw, 100, 100);
consensus.observeBarcode(false);
consensus.observe(raw, 133, 133);
consensus.observeBarcode(false);
const fastConfirmed = consensus.observe(raw, 166, 166);
assert.equal(fastConfirmed.valid, true, 'an encrypted QR must not restart MRZ confirmation');
assert.equal(fastConfirmed.firstFrameId, 100, 'measure from the first frame in the same valid sequence');
consensus.reset();
consensus.observe(raw, 100, 100);
consensus.observe(raw, 133, 133);
consensus.observeBarcode(true);
assert.equal(consensus.observe(raw, 166, 166), null, 'accepted barcode identity must reset pending MRZ');
consensus.reset();
assert.equal(consensus.observe(raw, 1, 100), null);
assert.equal(consensus.observe(raw, 1, 110), null, 'same frame must not count twice');
assert.equal(consensus.observe(raw, 2, 300), null);
assert.equal(consensus.observe(raw, 3, 500).valid, true);
consensus.reset();
consensus.observe(raw, 4, 1000);
consensus.observe(raw, 5, 1200);
assert.equal(consensus.observe(other, 6, 1400), null, 'person change resets consensus');
assert.equal(consensus.observe(other, 7, 3000), null, 'long gap resets consensus');
assert.equal(consensus.observe(other, 8, 3200), null);
assert.equal(consensus.observe('incomplete', 9, 3300), null);
assert.equal(consensus.observe(other, 10, 3400), null, 'invalid observation resets consensus');
consensus.reset();
consensus.observe(raw, 1, 100);
consensus.observe(raw, 2, 200);
assert.equal(consensus.observe(raw, 1, 300), null, 'older frames must not complete a reading');
assert.equal(consensus.observe(raw, Number.NaN, 400), null, 'invalid frame IDs must not complete a reading');
const session = new ScannerSession();
assert.equal(session.accepts(0), false);
session.setActive(true);
const previous = session.id;
assert.equal(session.accepts(previous), true);
session.setActive(false);
assert.equal(session.accepts(previous), false, 'paused camera must reject callbacks');
session.setActive(true);
assert.equal(session.accepts(previous), false, 'resumed camera must reject old callbacks');
assert.equal(session.accepts(session.id), true);
assert.equal(session.accepts(Number.NaN), false);
for (let i = 0; i < 100; i++) {
  const old = session.id;
  session.setActive(false);
  session.setActive(true);
  assert.equal(session.accepts(old), false, 'old callbacks must stay invalid across repeated pauses');
}
console.log(`${fixtures.length} shared MRZ fixtures passed; parser parity and consensus checks passed.`);
