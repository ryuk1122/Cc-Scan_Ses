"""Strict TD1 acceptance, mirrored by frontend/src/utils/mrzValidation.ts.
Shared fixtures enforce parity. Never pad, join name rows or guess a missing digit.
"""
import re
from datetime import datetime, timezone

_FIX = str.maketrans({'O':'0','Q':'0','D':'0','I':'1','L':'1','B':'8','S':'5','Z':'2'})

def is_mrz_text(raw):
    return bool(raw and '\x00' not in raw and 'PubDSK_' not in raw
                and re.search(r'^\s*[I1][DC]<?C[O0][LI1]', raw, re.I | re.M))

def _clean(s):
    s = re.sub(r'\s', '', s.upper()).translate(str.maketrans({'«':'<','‹':'<','›':'<','>':'<'}))
    s = re.sub(r'^1([DC])', r'I\1', s)
    return re.sub(r'^I([DC])<?C[O0][LI1]', r'I\1COL', s)

def _check(value, digit):
    if not re.fullmatch(r'\d', digit) or not re.fullmatch(r'[A-Z0-9<]+', value):
        return False
    total = sum((0 if c == '<' else int(c) if c.isdigit() else ord(c)-55) * (7,3,1)[i%3] for i,c in enumerate(value))
    return total % 10 == int(digit)

def _date(s, expiry=False):
    if not re.fullmatch(r'\d{6}', s):
        return ''
    now = datetime.now(timezone.utc)
    yy = int(s[:2])
    year = 2000+yy if expiry or yy <= now.year%100 else 1900+yy
    try:
        value = datetime(year,int(s[2:4]),int(s[4:6]),tzinfo=timezone.utc)
        if not expiry and value > now:
            return ''
        return value.strftime('%Y-%m-%d')
    except ValueError:
        return ''

def validate_mrz(raw):
    observed = [_clean(s) for s in str(raw or '').splitlines() if s.strip()]
    starts = [i for i,s in enumerate(observed) if s.startswith(('IDCOL','ICCOL'))]
    index = starts[0] if len(starts) == 1 else -1
    selected = observed[index:index+3] if index >= 0 else []
    if len(selected) != 3 or not all(re.fullmatch(r'[A-Z0-9<]{30}', s) for s in selected):
        return {'valid':False, 'lines':selected, 'checks':{'complete':False}}
    a = selected[0][:5] + selected[0][5:20].translate(_FIX) + selected[0][20:]
    b = (selected[1][:7].translate(_FIX) + selected[1][7] + selected[1][8:15].translate(_FIX)
         + selected[1][15:18].replace('0','O').replace('1','I') + selected[1][18:].translate(_FIX))
    c = selected[2]
    birth, expiry = _date(b[:6]), _date(b[8:14],True)
    name_parts = c.rstrip('<').split('<<')
    optional = bool(re.fullmatch(r'\d{5,10}<{0,5}', b[18:28])) and b[28] == '<'
    doc = a[5:14].replace('<','').lstrip('0')
    nuip = b[18:28].replace('<','').lstrip('0') if optional else ''
    cedula = nuip if a.startswith('ICCOL') else nuip or doc
    checks = {
        'complete':True, 'document':_check(a[5:14],a[14]),
        'birth':bool(birth) and _check(b[:6],b[6]), 'expiry':bool(expiry) and _check(b[8:14],b[14]),
        'composite':_check(a[5:]+b[:7]+b[8:15]+b[18:29],b[29]),
        'identity':bool(re.fullmatch(r'\d{5,10}', cedula)),
        'layout':bool(b[15:18]=='COL' and re.fullmatch(r'[MFX<]',b[7]) and re.fullmatch(r'[A-Z<]{30}',c)
                      and len(name_parts)==2 and re.search('[A-Z]',name_parts[0]) and re.search('[A-Z]',name_parts[1])
                      and (a.startswith('IDCOL') or optional)),
    }
    return {'valid':all(checks.values()), 'lines':[a,b,c], 'checks':checks, 'cedula':cedula,
            'birth':birth, 'expiry':expiry, 'nuip':nuip, 'doc':doc,
            'surname':[s for s in name_parts[0].split('<') if s],
            'names':re.sub(r'\s+',' ',name_parts[1].replace('<',' ')).strip() if len(name_parts)>1 else '', 'gender':b[7]}
