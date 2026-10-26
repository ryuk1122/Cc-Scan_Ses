import copy
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

import gemini_service as service


@pytest.fixture
def payload():
    return {'ok': True, 'cedula': '1234567890', 'nombres': 'LILI ANA', 'primer_apellido': 'PEREZ',
            'confianza': 0.95, 'origen': 'frente', 'conflicto': False, 'nombre_truncado': False,
            'evidencia': {'numero_frente': '1234567890', 'numero_mrz': None}, 'raw_mrz': []}


@pytest.fixture
def image():
    output = io.BytesIO()
    Image.new('RGB', (100, 80), 'white').save(output, format='PNG')
    return output.getvalue()


@pytest.fixture
def cloud(monkeypatch, payload):
    monkeypatch.setenv('GEMINI_API_KEY', 'unit-test-placeholder')
    monkeypatch.setenv('GEMINI_ENABLED', 'true')
    monkeypatch.setenv('GEMINI_OCR_MODE', 'auto')
    monkeypatch.setenv('GEMINI_MIN_CONFIDENCE', '0.70')
    state = SimpleNamespace(payload=payload, calls=[], status=200)
    def post(url, **kwargs):
        state.calls.append(kwargs)
        return SimpleNamespace(status_code=state.status, json=lambda: {
            'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(state.payload)}]}}]})
    monkeypatch.setattr(service.requests, 'post', post)
    return state


def test_candidate_is_never_an_automatic_confirmation(cloud, image):
    result = service.analyze_cedula_with_gemini(image)
    assert result['ok']
    assert result['cedula'] == '1234567890'
    assert result['parsed']['nombres'] == 'LILI ANA'
    assert result['requires_review'] and result['mrz_valido'] is False
    assert result['parsed']['mrz_valido'] is False
    assert len(cloud.calls) == 1


def test_prompt_identifies_locations_and_never_assumes_first_image_is_front(cloud, image):
    service.analyze_cedula_with_gemini(image, image)
    body = cloud.calls[0]['json']
    text = '\n'.join(part['text'] for part in body['contents'][0]['parts'] if 'text' in part)
    assert 'posiciones 19 a 28' in text
    assert 'posicion 30' in text
    assert 'NO el NUIP' in text
    assert 'No supongas que la primera imagen es el frente' in text
    assert 'No priorices una cara' in text
    assert len([p for p in body['contents'][0]['parts'] if 'inline_data' in p]) == 2
    assert body['generationConfig']['responseSchema']['type'] == 'OBJECT'


@pytest.mark.parametrize('confidence', [None, '', 'bad', float('nan'), float('inf'), -1, 1.1, 0.69])
def test_bad_confidence_is_not_treated_as_maximum(cloud, image, confidence):
    cloud.payload['confianza'] = confidence
    assert not service.analyze_cedula_with_gemini(image)['ok']


@pytest.mark.parametrize('mutation', [
    {'ok': 'false'}, {'conflicto': True}, {'conflicto': None}, {'origen': 'desconocido'},
    {'cedula': 1234567890}, {'cedula': 'CC1234567890'}, {'cedula': '12345?'},
    {'evidencia': {}}, {'evidencia': {'numero_frente': '1234567891'}},
    {'evidencia': {'numero_frente': '1234567890', 'numero_mrz': '9876543210'}},
    {'origen': 'ambas'}, {'raw_mrz': ['incomplete']}, {'raw_mrz': [None, None, None]},
])
def test_malformed_or_conflicting_evidence_cannot_become_identity(cloud, image, mutation):
    cloud.payload.update(copy.deepcopy(mutation))
    result = service.analyze_cedula_with_gemini(image)
    assert not result['ok']
    assert result['cedula'] == '' and result['parsed'] == {}


def test_complete_mrz_cannot_back_a_different_number(cloud, image):
    from pathlib import Path
    fixture = json.loads((Path(__file__).parents[2] / 'tests/fixtures/mrz.json').read_text(encoding='utf-8'))[0]
    cloud.payload['raw_mrz'] = fixture['raw'].splitlines()
    cloud.payload['cedula'] = '9876543210'
    cloud.payload['evidencia']['numero_frente'] = '9876543210'
    assert service.analyze_cedula_with_gemini(image)['error'] == 'gemini_mrz_no_coincide'


def test_bad_image_does_not_consume_an_api_call(cloud):
    assert service.analyze_cedula_with_gemini(b'not an image')['error'] == 'imagen_invalida'
    assert not cloud.calls


def test_unconfigured_service_does_not_make_a_call(cloud, image, monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY')
    assert service.analyze_cedula_with_gemini(image)['error'] == 'gemini_no_configurado'
    assert not cloud.calls


@pytest.mark.parametrize('code', [400, 403, 429, 500])
def test_provider_errors_are_bounded_without_retries(cloud, image, code):
    cloud.status = code
    assert not service.analyze_cedula_with_gemini(image)['ok']
    assert len(cloud.calls) == 1


@pytest.mark.parametrize('value', [[], {}, {'candidates': []}, {'candidates': [{'finishReason': 'MAX_TOKENS'}]}])
def test_empty_blocked_or_truncated_response_is_safe(cloud, image, monkeypatch, value):
    monkeypatch.setattr(service.requests, 'post', lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: value))
    assert not service.analyze_cedula_with_gemini(image)['ok']


@pytest.mark.parametrize('text', ['[]', 'null', 'true', '{"ok":', '{"ok":true} trailing text'])
def test_non_object_or_partial_json_is_rejected(text):
    with pytest.raises((ValueError, TypeError)):
        service._parse_json_response(text)


@pytest.mark.parametrize('value', ['20230229', '20261301', '31022000', None, '2026-10-26T12:00:00'])
def test_invalid_dates_are_not_returned(value):
    assert service._normalize_date(value) == ''


def test_valid_leap_date_and_iso_date_are_preserved():
    assert service._normalize_date('2000-02-29') == '20000229'
    assert service._normalize_date('29/02/2000') == '20000229'


def test_bad_environment_does_not_crash_service(monkeypatch):
    monkeypatch.setenv('GEMINI_TIMEOUT_SECONDS', 'nan')
    monkeypatch.setenv('GEMINI_MIN_CONFIDENCE', 'invalid')
    config = service.gemini_config()
    assert config['timeout_seconds'] == 18
    assert config['min_confidence'] == 0.70


def test_missing_full_mrz_cannot_back_a_number(cloud, image):
    cloud.payload.update(origen='mrz', evidencia={'numero_mrz':'1234567890'}, raw_mrz=[])
    assert service.analyze_cedula_with_gemini(image)['error'] == 'gemini_mrz_incompleta'


def test_birth_date_cannot_masquerade_as_identity(cloud, image):
    cloud.payload.update(cedula='20000101', evidencia={'numero_frente':'20000101'})
    assert not service.analyze_cedula_with_gemini(image)['ok']


def test_timeout_never_retries_or_returns_partial_identity(cloud, image, monkeypatch):
    def timeout(*args, **kwargs):
        cloud.calls.append(kwargs)
        raise service.requests.Timeout('simulated timeout')
    monkeypatch.setattr(service.requests, 'post', timeout)
    result = service.analyze_cedula_with_gemini(image)
    assert not result['ok'] and result['parsed'] == {}
    assert len(cloud.calls) == 1
