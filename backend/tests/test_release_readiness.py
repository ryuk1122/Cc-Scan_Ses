import asyncio
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "cedulascan_readiness_tests")
os.environ.setdefault("JWT_SECRET_KEY", "test-only-readiness-not-production")
import server


def test_readiness_rejects_unfinished_setup_without_touching_database(monkeypatch):
    monkeypatch.setitem(server.startup_state, "database_ready", False)
    monkeypatch.setattr(server, "db", SimpleNamespace())
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.ready())
    assert error.value.status_code == 503


def test_readiness_checks_database_connection(monkeypatch):
    class Database:
        async def command(self, name):
            assert name == "ping"
            return {"ok": 1}
    monkeypatch.setitem(server.startup_state, "database_ready", True)
    monkeypatch.setattr(server, "db", Database())
    assert asyncio.run(server.ready()) == {"ok": True, "version": server.app.version, "scanner_release": "1.0.9"}


def test_readiness_rejects_database_outage_without_disclosing_credentials(monkeypatch):
    class Database:
        async def command(self, name):
            raise RuntimeError("private connection details")
    monkeypatch.setitem(server.startup_state, "database_ready", True)
    monkeypatch.setattr(server, "db", Database())
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.ready())
    assert error.value.status_code == 503
    assert error.value.detail == "Base de datos no disponible"
