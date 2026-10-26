/** Strict Colombian TD1 acceptance. Candidate recovery never supplies missing characters. */
const fixes: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', B: '8', S: '5', Z: '2' };
const digits = (s: string) => s.replace(/[OQDILBSZ]/g, c => fixes[c]);
const clean = (s: string) => s.toUpperCase().replace(/\s/g, '').replace(/[«‹›>]/g, '<')
  .replace(/^1([DC])/, 'I$1').replace(/^I([DC])<?C[O0][LI1]/, 'I$1COL');
export function isMrzText(raw: string) {
  return !raw.includes('\u0000') && !raw.includes('PubDSK_') && /^\s*[I1][DC]<?C[O0][LI1]/im.test(raw);
}
function check(s: string, digit: string) {
  if (!/^\d$/.test(digit) || !/^[A-Z0-9<]+$/.test(s)) return false;
  return [...s].reduce((sum, c, i) => sum + (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55) * [7,3,1][i%3], 0) % 10 === +digit;
}
function date(raw: string, expiry: boolean) {
  if (!/^\d{6}$/.test(raw)) return '';
  const yy = +raw.slice(0,2), month = +raw.slice(2,4), day = +raw.slice(4,6);
  const year = expiry || yy <= new Date().getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy;
  const value = new Date(Date.UTC(year, month-1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month-1 || value.getUTCDate() !== day) return '';
  if (!expiry && value.getTime() > Date.now()) return '';
  return `${year}-${raw.slice(2,4)}-${raw.slice(4,6)}`;
}

export function validateMrz(raw: string) {
  const observed = raw.split(/\r?\n/).map(clean).filter(Boolean);
  const starts = observed.map((l, i) => /^(IDCOL|ICCOL)/.test(l) ? i : -1).filter(i => i >= 0);
  const index = starts.length === 1 ? starts[0] : -1;
  const selected = index >= 0 ? observed.slice(index,index+3) : [];
  const complete = selected.length === 3 && selected.every(l => /^[A-Z0-9<]{30}$/.test(l));
  if (!complete) return { valid: false, lines: selected, checks: { complete: false } };
  // Corrections are restricted to numeric fields of the Colombian layout.
  const a = selected[0].slice(0,5) + digits(selected[0].slice(5,20)) + selected[0].slice(20);
  const b = digits(selected[1].slice(0,7)) + selected[1][7] + digits(selected[1].slice(8,15))
    + selected[1].slice(15,18).replace(/0/g,'O').replace(/1/g,'I') + digits(selected[1].slice(18));
  const c = selected[2];
  const birth = date(b.slice(0,6),false), expiry = date(b.slice(8,14),true);
  const nameParts = c.replace(/<+$/,'').split('<<');
  const nuipField = b.slice(18,28);
  const optional = /^\d{5,10}<{0,5}$/.test(nuipField) && b[28] === '<';
  const doc = a.slice(5,14).replace(/</g,'').replace(/^0+/,'');
  const nuip = optional ? nuipField.replace(/</g,'').replace(/^0+/,'') : '';
  const cedula = a.startsWith('ICCOL') ? nuip : nuip || doc;
  const checks = {
    complete: true,
    document: check(a.slice(5,14),a[14]),
    birth: !!birth && check(b.slice(0,6),b[6]),
    expiry: !!expiry && check(b.slice(8,14),b[14]),
    composite: check(a.slice(5)+b.slice(0,7)+b.slice(8,15)+b.slice(18,29),b[29]),
    identity: /^\d{5,10}$/.test(cedula),
    layout: b.slice(15,18) === 'COL' && /^[MFX<]$/.test(b[7]) && /^[A-Z<]{30}$/.test(c)
      && nameParts.length === 2 && /[A-Z]/.test(nameParts[0]) && /[A-Z]/.test(nameParts[1])
      && (a.startsWith('IDCOL') || optional),
  };
  return { valid: Object.values(checks).every(Boolean), lines: [a,b,c], checks, cedula, birth, expiry, nuip, doc,
    surname: nameParts[0]?.split('<').filter(Boolean) || [],
    names: nameParts[1]?.replace(/</g,' ').replace(/\s+/g,' ').trim() || '', gender: b[7] };
}

/** Consecutive full valid observations; never votes characters from different documents together. */
export class MrzConsensus {
  private key = '';
  private count = 0;
  private at = 0;
  private frame = -1;
  private firstFrame = -1;
  reset() { this.key = ''; this.count = 0; this.at = 0; this.frame = -1; this.firstFrame = -1; }
  observeBarcode(identityAccepted: boolean) { if (identityAccepted) this.reset(); }
  observe(raw: string, frame: number, now = Date.now()) {
    const result = validateMrz(raw);
    if (!Number.isFinite(frame) || frame < 0 || frame <= this.frame || !Number.isFinite(now)) return null;
    if (!result.valid) { this.reset(); return null; }
    const key = result.lines.join('\n');
    this.count = key === this.key && now >= this.at && now-this.at <= 1200 ? this.count+1 : 1;
    if (this.count === 1) this.firstFrame = frame;
    this.key = key; this.at = now; this.frame = frame;
    return this.count >= 3 ? { ...result, firstFrameId: this.firstFrame } : null;
  }
}
