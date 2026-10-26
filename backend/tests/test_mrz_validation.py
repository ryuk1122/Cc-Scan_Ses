import json
from pathlib import Path

import pytest

from cedula_parser import parse_mrz_from_text, _clean_mrz_name_parts
from mrz_validation import validate_mrz, is_mrz_text

FIXTURES = json.loads((Path(__file__).parents[2] / 'tests/fixtures/mrz.json').read_text(encoding='utf-8'))

@pytest.mark.parametrize('case', FIXTURES, ids=lambda case: case['name'])
def test_shared_mrz_acceptance(case):
    result = validate_mrz(case['raw'])
    assert result['valid'] is case['valid']
    parsed = parse_mrz_from_text(case['raw'])
    assert parsed['mrz_valido'] is case['valid']
    if case['valid']:
        assert result['cedula'] == case['cedula'] == parsed['cedula']
        assert parsed['nombres'] == case['names']

def test_legitimate_short_name_is_preserved():
    assert _clean_mrz_name_parts(['LILI', 'ANA']) == ['LILI', 'ANA']


def test_pdf417_payload_is_not_misclassified_as_mrz():
    assert not is_mrz_text('PubDSK_\x00ICCOL')
    assert not is_mrz_text('APELLIDO ICCOLLECTOR')
    assert is_mrz_text(FIXTURES[0]['raw'])

def test_changed_nuip_fails_composite_even_with_valid_dates():
    original = FIXTURES[0]['raw'].splitlines()
    original[1] = original[1][:27] + ('1' if original[1][27] != '1' else '2') + original[1][28:]
    result = validate_mrz('\n'.join(original))
    assert result['checks']['document']
    assert result['checks']['birth']
    assert result['checks']['expiry']
    assert not result['checks']['composite']
    assert not result['valid']
