import asyncio
import os
from types import SimpleNamespace

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "cedulascan_security_tests")
os.environ.setdefault("JWT_SECRET_KEY", "only-for-local-security-tests-not-production")

import server


class FakeCollection:
    def __init__(self, result):
        self.result = result

    async def find_one(self, *_args, **_kwargs):
        return self.result


class RecordingCollection:
    def __init__(self, existing=None):
        self.existing = existing
        self.inserted = []

    async def find_one(self, *_args, **_kwargs):
        return self.existing

    async def insert_one(self, document):
        self.inserted.append(document)
        return SimpleNamespace(inserted_id=str(len(self.inserted)))


def test_admin_create_operator_also_issues_first_device_pin(monkeypatch):
    users = RecordingCollection()
    pins = RecordingCollection()
    events = RecordingCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users, device_enrollment_pins=pins, event_store=events))
    monkeypatch.setattr(server, "hash_password", lambda password: f"hashed:{password}")
    monkeypatch.setattr(server, "enqueue_supabase_backup", lambda *_args: asyncio.sleep(0))

    result = asyncio.run(server.create_operator(
        server.OperatorCreate(email="operator@example.com", password="password123", nombre="Operador Test"),
        {"id": "admin-test", "email": "admin@example.com"},
    ))

    assert len(result["pin"]) == 6 and result["pin"].isdigit()
    assert result["expires_in_minutes"] == 10
    assert len(users.inserted) == len(pins.inserted) == 1
    assert pins.inserted[0]["pin_hash"] == server.hash_device_pin(result["pin"])


def test_operator_token_is_tied_to_an_active_device(monkeypatch):
    operator = {"id": "operator-test", "email": "operator@example.com", "role": "operator", "active": True}
    monkeypatch.setattr(server, "db", SimpleNamespace(
        users=FakeCollection(operator),
        operator_devices=FakeCollection({"device_id": "dev_test12345", "user_id": operator["id"], "active": True}),
    ))
    token = server.create_token(operator["id"], operator["email"], "operator", "dev_test12345")

    accepted = asyncio.run(server.get_user_from_token(token))
    assert accepted["security_version"] == 2
    assert accepted["device_id"] == "dev_test12345"

    monkeypatch.setattr(server, "db", SimpleNamespace(
        users=FakeCollection(operator),
        operator_devices=FakeCollection(None),
    ))
    try:
        asyncio.run(server.get_user_from_token(token))
    except server.HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("A revoked or unregistered device was accepted")


def test_public_operator_registration_is_disabled():
    body = server.UserRegister(email="new@example.com", password="password123", nombre="New Operator")
    try:
        asyncio.run(server.register(body))
    except server.HTTPException as exc:
        assert exc.status_code == 403
        assert "administrador" in exc.detail
    else:
        raise AssertionError("Public operator registration must be disabled")


def test_health_versions_match_the_running_api_version():
    assert asyncio.run(server.root())["version"] == server.app.version
    assert asyncio.run(server.health())["version"] == server.app.version
