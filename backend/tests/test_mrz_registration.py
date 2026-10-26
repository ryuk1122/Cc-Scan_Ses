import asyncio
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('DB_NAME', 'cedulascanner_test')
os.environ.setdefault('JWT_SECRET_KEY', 'test-only-mrz-secret-not-for-production')
import server

RAW = json.loads((Path(__file__).parents[2] / 'tests/fixtures/mrz.json').read_text(encoding='utf-8'))[0]['raw']

def request(raw=RAW, cedula='1234567890', source='mrz_local'):
    return server.EscanearRequest(cedula=cedula, raw_barcode=raw, capture_source=source,
        evento_id='test', device_id='test', timestamp=1, nonce='test', nombres='WRONG')

@pytest.mark.parametrize('body', [request(cedula='1234567891'), request(raw=RAW[:-1]),
    request(raw=''), request(raw=RAW[:-1], source='')])
def test_invalid_mrz_is_rejected_before_database(monkeypatch, body):
    monkeypatch.setattr(server, 'db', SimpleNamespace())
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.escanear(body, {}, None))
    assert error.value.status_code == 422

def test_valid_mrz_replaces_client_supplied_identity_before_lookup(monkeypatch):
    class MissingEvents:
        async def find_one(self, *args):
            return None
    monkeypatch.setattr(server, 'db', SimpleNamespace(eventos=MissingEvents()))
    body = request()
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.escanear(body, {}, None))
    assert error.value.status_code == 404
    assert body.nombres == 'LILI ANA'
    assert body.nombre == 'LILI ANA PEREZ GOMEZ'

def test_ocr_endpoint_marks_unvalidated_candidate_for_review(monkeypatch):
    async def fake_ocr(*args, **kwargs):
        return {'ok': True, 'cedula': '1234567890', 'parsed': {'mrz_valido': False}}
    class NoAffiliate:
        async def find_one(self, *args):
            return None
    monkeypatch.setattr(server, 'ocr_from_base64_async', fake_ocr)
    monkeypatch.setattr(server, 'db', SimpleNamespace(afiliados=NoAffiliate()))
    result = asyncio.run(server.api_ocr_cedula(server.OcrRequest(image_base64='x'*10), {}))
    assert result['ok'] is False
    assert result['requires_review'] is True


def test_local_only_endpoint_ignores_cloud_request(monkeypatch):
    async def fake_ocr(body, current):
        assert body.force_gemini is False
        return {'ok': False}
    monkeypatch.setattr(server, 'api_ocr_cedula', fake_ocr)
    result = asyncio.run(server.api_ocr_cedula_local(
        server.OcrRequest(image_base64='x'*10, force_gemini=True), {}))
    assert result == {'ok': False}


def test_gemini_backup_requires_authentication(monkeypatch):
    import httpx
    def forbidden(*args):
        raise AssertionError('Cloud called without authentication')
    monkeypatch.setattr(server, 'analyze_cedula_with_gemini', forbidden)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as client:
            return await client.post('/api/ocr/cedula/gemini-backup', json={'image_base64':'eHh4eHh4eHh4'})
    assert asyncio.run(run()).status_code == 401


@pytest.mark.parametrize('value, status', [('not-base64!!',400), ('tiny',422)])
def test_bad_backup_input_never_reaches_provider(monkeypatch, value, status):
    import httpx
    def forbidden(*args):
        raise AssertionError('Provider called for invalid payload')
    monkeypatch.setattr(server, 'analyze_cedula_with_gemini', forbidden)
    server.app.dependency_overrides[server.get_current_user] = lambda: {'id':'unit-test'}
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as client:
            return await client.post('/api/ocr/cedula/gemini-backup', json={'image_base64':value})
    try:
        assert asyncio.run(run()).status_code == status
    finally:
        server.app.dependency_overrides.clear()


def test_backup_endpoint_enforces_manual_review_even_if_service_claims_valid(monkeypatch):
    import httpx
    calls = []
    def fake(image):
        calls.append(image)
        return {'ok':True, 'cedula':'1234567890', 'mrz_valido':True, 'parsed':{'mrz_valido':True}}
    monkeypatch.setattr(server, 'analyze_cedula_with_gemini', fake)
    server.app.dependency_overrides[server.get_current_user] = lambda: {'id':'unit-test'}
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url='http://test') as client:
            return await client.post('/api/ocr/cedula/gemini-backup', json={'image_base64':'eHh4eHh4eHh4'})
    try:
        response = asyncio.run(run())
        assert response.status_code == 200
        result = response.json()
        assert result['requires_review'] and result['mrz_valido'] is False
        assert result['parsed']['mrz_valido'] is False
        assert len(calls) == 1
    finally:
        server.app.dependency_overrides.clear()
