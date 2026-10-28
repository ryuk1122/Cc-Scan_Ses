const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const parser = require('../src/utils/cedula.ts');
const nativeDecoded = process.argv[2] ? Buffer.from(fs.readFileSync(process.argv[2], 'utf8').trim(), 'base64').toString('latin1') : null;
const file = path.join(root, 'app/(app)/escanear.tsx');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
const helpers = source.statements.filter(node => (ts.isVariableStatement(node) && !node.declarationList.declarations.some(d => d.name.getText(source) === 'styles')) || (ts.isFunctionDeclaration(node) && node.name?.text !== 'EscanearScreen'))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join('\n');
const code = ts.transpileModule(helpers + '\n;({normalizeQrCedulaPayload,extractCedulaFromCameraPayload,isReliableBarcode,cleanCedulaNumber,parsedFullName,normalizeAfiliadoData})', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const screen = vm.runInNewContext(code, { parsePdf417: parser.parsePdf417, extractCedula: parser.extractCedula, ...require('../src/utils/mrzValidation.ts') });
function payload(header = 0, marker = true, fill = 0) {
  const bytes = Buffer.alloc(531, fill);
  bytes[0] = header; bytes[1] = header;
  const put = (start, end, text) => { bytes.fill(fill, start, end); bytes.write(text, start, Math.min(end - start, Buffer.byteLength(text, 'latin1')), 'latin1'); };
  put(2, 10, '98765432'); if (marker) put(20, 27, 'PubDSK_');
  put(40, 48, '654321'); put(48, 58, '1234567890');
  put(58, 80, 'MUÑOZ'); put(81, 104, 'PÉREZ'); put(104, 127, 'ANA'); put(127, 150, 'MARÍA');
  put(151, 152, 'F'); put(152, 160, '19910729'); put(160, 162, '31'); put(162, 165, '019'); put(166, 168, 'O+');
  return bytes.toString('latin1');
}
function compactPayload(separateDocument = false, padding = 1, middle = true) {
  const parts = ['  98765432', 'PubDSK_', separateDocument ? '65432100' : '6543210000' + '1234567890' + 'MUÑOZ'];
  if (separateDocument) parts.push('1234567890MUÑOZ');
  parts.push('PÉREZ', 'ANA');
  if (middle) parts.push('MARÍA');
  parts.push('0F19910729310190O+');
  return parts.join('\u0000'.repeat(padding));
}
let passed = 0;
const failures = [];
function test(name, run) { try { run(); passed++; } catch (error) { failures.push(name + ': ' + error.message.split('\n')[0]); } }
if (nativeDecoded) test('native image decoder output reaches parser intact', () => {
  assert.equal(parser.parsePdf417(nativeDecoded).cedula, '1234567890');
  assert.equal(parser.parsePdf417(nativeDecoded).nombres, 'ANA MARÍA');
});
for (const header of [0, 9, 10, 13, 32, 160]) {
  for (const marker of [true, false]) {
    const raw = payload(header, marker, marker ? 0 : 32);
    const label = `header=${header}, marker=${marker}`;
    test(label + ' parser', () => {
      const result = parser.parsePdf417(raw);
      assert.equal(result.cedula, '1234567890'); assert.equal(result.primer_apellido, 'MUÑOZ');
      assert.equal(result.segundo_apellido, 'PÉREZ'); assert.equal(result.nombres, 'ANA MARÍA');
      assert.equal(result.fecha_nacimiento, '1991-07-29'); assert.equal(result.raw, raw);
    });
    test(label + ' extract', () => assert.equal(parser.extractCedula(raw), '1234567890'));
    test(label + ' screen normalization', () => assert.equal(screen.normalizeQrCedulaPayload(raw), raw));
    test(label + ' camera gate', () => assert.equal(screen.extractCedulaFromCameraPayload(raw, 'pdf417'), '1234567890'));
    test(label + ' reliability', () => assert.equal(screen.isReliableBarcode(raw, 'camera'), true));
  }
}
for (const bad of ['PubDSK_' + '\u0000'.repeat(30), payload().slice(0, 48), payload().slice(0, 48) + '1234A67890' + payload().slice(58)]) {
  test('corrupt binary rejects identity', () => { assert.equal(parser.parsePdf417(bad).cedula, ''); assert.equal(parser.extractCedula(bad), null); });
}
for (const separate of [false, true]) for (const padding of [1, 4]) for (const middle of [false, true]) {
  const raw = compactPayload(separate, padding, middle);
  test('compact binary identity and names', () => {
    const parsed = parser.parsePdf417(raw);
    assert.equal(parsed.cedula, '1234567890'); assert.equal(parsed.primer_apellido, 'MUÑOZ');
    assert.equal(parsed.segundo_apellido, 'PÉREZ'); assert.equal(parsed.nombres, middle ? 'ANA MARÍA' : 'ANA');
    assert.equal(parsed.fecha_nacimiento, '1991-07-29'); assert.equal(parsed.formato_detectado, 'pdf417_binario_compacto');
  });
  test('compact extraction', () => assert.equal(parser.extractCedula(raw), '1234567890'));
  test('compact camera gate', () => assert.equal(screen.extractCedulaFromCameraPayload(raw, 'pdf417'), '1234567890'));
  test('compact payload is preserved', () => assert.equal(screen.normalizeQrCedulaPayload(raw), raw));
}
for (const bad of [compactPayload().replace('1234567890', '1234A67890'), compactPayload().replace('19910729', '19919999'), compactPayload().replace('0F1991', '0X1991')]) {
  test('corrupt compact binary rejects identity', () => { assert.equal(parser.parsePdf417(bad).cedula, ''); assert.equal(parser.extractCedula(bad), null); });
}
const fixtures = JSON.parse(fs.readFileSync(path.resolve(root, '../tests/fixtures/mrz.json'), 'utf8'));
for (const fixture of fixtures.filter(f => f.valid)) {
  test('MRZ routes remain strict and compatible', () => {
    for (const raw of [fixture.raw, fixture.raw.replace(/</g, '«')]) {
      assert.equal(parser.parsePdf417(raw).cedula, fixture.cedula);
      assert.equal(parser.extractCedula(raw), fixture.cedula);
    }
  });
}

if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; } else console.log(`${passed} PDF417 parser and screen normalization checks passed`);
