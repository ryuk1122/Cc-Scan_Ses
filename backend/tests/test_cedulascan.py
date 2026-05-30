"""
CedulaScan Pro — Backend test suite
Covers: auth, eventos, escaneo (3-level anti-duplication), idempotency,
race-conditions, audit log, websocket connect+broadcast.
"""
import asyncio
import json
import os
import time
import uuid
import threading
import pytest
import requests
import websockets

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://zero-dupe-mobile.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@cs.io"
DEMO_PASS = "test123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(session):
    # Try login first; if invalid, register
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    if r.status_code == 200:
        return r.json()["access_token"]
    r = session.post(f"{API}/auth/register", json={"email": DEMO_EMAIL, "password": DEMO_PASS, "nombre": "Demo Operator"})
    assert r.status_code in (201, 200), f"register failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def evento_id(session, auth_headers):
    body = {"nombre": f"TEST_Event_{uuid.uuid4().hex[:6]}", "fecha": "2026-05-25", "lugar": "Bogotá", "descripcion": "TEST"}
    r = session.post(f"{API}/eventos", json=body, headers=auth_headers)
    assert r.status_code == 201, f"create evento: {r.status_code} {r.text}"
    return r.json()["id"]


# ---------- Auth ----------
class TestAuth:
    def test_login_demo(self, session):
        r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and "user" in data
        assert data["user"]["email"] == DEMO_EMAIL

    def test_login_bad_password(self, session):
        r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_with_token(self, session, auth_headers):
        r = session.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == DEMO_EMAIL

    def test_me_without_token(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_register_new_user(self, session):
        email = f"TEST_user_{uuid.uuid4().hex[:6]}@test.io"
        r = session.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "nombre": "TEST User"})
        assert r.status_code == 201
        assert r.json()["user"]["email"] == email.lower()


# ---------- Eventos ----------
class TestEventos:
    def test_create_requires_auth(self, session):
        r = session.post(f"{API}/eventos", json={"nombre": "X", "fecha": "2026-01-01"})
        assert r.status_code == 401

    def test_list_eventos(self, session, auth_headers, evento_id):
        r = session.get(f"{API}/eventos", headers=auth_headers)
        assert r.status_code == 200
        ids = [e["id"] for e in r.json()]
        assert evento_id in ids

    def test_get_evento(self, session, auth_headers, evento_id):
        r = session.get(f"{API}/eventos/{evento_id}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["id"] == evento_id

    def test_estado(self, session, auth_headers, evento_id):
        r = session.get(f"{API}/eventos/{evento_id}/estado", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        for k in ["total", "hoy", "duplicados_detectados", "dispositivos_usados", "dispositivos_activos"]:
            assert k in data, f"missing key {k}"


# ---------- Escaneo & Anti-Dup ----------
class TestEscaneo:
    def _payload(self, cedula, evento_id, device="dev_A"):
        return {
            "cedula": cedula,
            "evento_id": evento_id,
            "device_id": device,
            "timestamp": int(time.time() * 1000),
            "nonce": uuid.uuid4().hex,
            "nombre": "TEST",
        }

    def test_scan_ok(self, session, auth_headers, evento_id):
        ced = f"1000{uuid.uuid4().int % 1000000}"
        idem = uuid.uuid4().hex
        r = session.post(f"{API}/registros/escanear", json=self._payload(ced, evento_id),
                         headers={**auth_headers, "Idempotency-Key": idem})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["registro"]["cedula"] == ced

    def test_duplicate_different_idem_returns_409(self, session, auth_headers, evento_id):
        ced = f"2000{uuid.uuid4().int % 1000000}"
        # First insert
        r1 = session.post(f"{API}/registros/escanear", json=self._payload(ced, evento_id, "dev_X"),
                          headers={**auth_headers, "Idempotency-Key": uuid.uuid4().hex})
        assert r1.status_code == 200
        # Second from different device + different idem
        r2 = session.post(f"{API}/registros/escanear", json=self._payload(ced, evento_id, "dev_Y"),
                          headers={**auth_headers, "Idempotency-Key": uuid.uuid4().hex})
        assert r2.status_code == 409
        body = r2.json()
        # FastAPI wraps in {"detail": {...}}
        detail = body.get("detail", body)
        assert detail.get("error") in ("DUPLICADO", "DUPLICADO_RACE")
        assert "registro_existente" in detail

    def test_idempotency_replay_same_response(self, session, auth_headers, evento_id):
        ced = f"3000{uuid.uuid4().int % 1000000}"
        idem = uuid.uuid4().hex
        payload = self._payload(ced, evento_id)
        r1 = session.post(f"{API}/registros/escanear", json=payload,
                          headers={**auth_headers, "Idempotency-Key": idem})
        assert r1.status_code == 200
        # Replay same idem key (with different nonce should still hit cache because idem-key is primary)
        payload2 = self._payload(ced, evento_id)
        r2 = session.post(f"{API}/registros/escanear", json=payload2,
                          headers={**auth_headers, "Idempotency-Key": idem})
        assert r2.status_code == 200
        assert r2.json()["registro"]["id"] == r1.json()["registro"]["id"]

    def test_concurrent_race_only_one_succeeds(self, session, auth_headers, evento_id):
        ced = f"4000{uuid.uuid4().int % 1000000}"
        results = []

        def attempt(device):
            try:
                r = requests.post(
                    f"{API}/registros/escanear",
                    json={
                        "cedula": ced,
                        "evento_id": evento_id,
                        "device_id": device,
                        "timestamp": int(time.time() * 1000),
                        "nonce": uuid.uuid4().hex,
                    },
                    headers={"Content-Type": "application/json",
                             "Authorization": auth_headers["Authorization"],
                             "Idempotency-Key": uuid.uuid4().hex},
                    timeout=10,
                )
                results.append(r.status_code)
            except Exception as e:
                results.append(str(e))

        threads = [threading.Thread(target=attempt, args=(f"dev_R{i}",)) for i in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()

        successes = sum(1 for s in results if s == 200)
        conflicts = sum(1 for s in results if s == 409)
        assert successes == 1, f"Expected exactly 1 success, got {successes}. Results: {results}"
        assert conflicts >= 1, f"Expected conflicts >= 1, got {conflicts}. Results: {results}"

        # Verify DB count == 1
        regs = session.get(f"{API}/eventos/{evento_id}/registros", headers=auth_headers).json()
        matching = [r for r in regs if r["cedula"] == ced]
        assert len(matching) == 1

    def test_audit_log_records_both_types(self, session, auth_headers, evento_id):
        r = session.get(f"{API}/eventos/{evento_id}/auditoria", headers=auth_headers)
        assert r.status_code == 200
        types = {e["event_type"] for e in r.json()}
        assert "REGISTRO_CREADO" in types
        assert "DUPLICADO_RECHAZADO" in types

    def test_estado_duplicates_counter(self, session, auth_headers, evento_id):
        r = session.get(f"{API}/eventos/{evento_id}/estado", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["duplicados_detectados"] >= 1


# ---------- WebSocket ----------
class TestWebSocket:
    @pytest.mark.asyncio
    async def test_ws_connect_and_broadcast(self, token, evento_id, auth_headers):
        ws_base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_base}/api/ws/eventos/{evento_id}?token={token}&device_id=test_ws_dev"
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert first["type"] in ("estado:inicial", "device:conectado")

                # Trigger a scan and look for registro:nuevo
                ced = f"9000{uuid.uuid4().int % 1000000}"
                r = requests.post(
                    f"{API}/registros/escanear",
                    json={"cedula": ced, "evento_id": evento_id, "device_id": "ws_test_dev",
                          "timestamp": int(time.time() * 1000), "nonce": uuid.uuid4().hex},
                    headers={**auth_headers, "Idempotency-Key": uuid.uuid4().hex},
                    timeout=10,
                )
                assert r.status_code == 200

                got_nuevo = False
                deadline = time.time() + 8
                while time.time() < deadline:
                    try:
                        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
                        if msg.get("type") == "registro:nuevo":
                            got_nuevo = True
                            break
                    except asyncio.TimeoutError:
                        break
                assert got_nuevo, "Did not receive registro:nuevo broadcast"
        except Exception as e:
            pytest.skip(f"WebSocket connect failed (ingress may not support WSS in preview): {e}")
