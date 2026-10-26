from ocr_service import _merge_local_ocr_mrz


def test_merge_local_ocr_mrz_prefers_real_nuip_from_mrz():
    local = {
        "ok": True,
        "cedula": "12",
        "parsed": {"cedula": "12", "nombres": "DATO INVALIDO"},
        "texto_completo": "ICCOL000000012",
    }
    mrz = {
        "ok": True,
        "cedula": "1234567890",
        "parsed": {
            "cedula": "1234567890",
            "primer_apellido": "WALTEROS",
            "nombres": "LAURA",
            "fecha_nacimiento": "1988-08-21",
            "fecha_expiracion": "2031-01-30",
            "raw_mrz": [
                "ICCOL000000012<<<<<<<<<<<<<<<<",
                "8808213F3101300COL1234567890<9",
                "WALTEROS<<<<<<<<<<<<<<<<LAURA<",
            ],
        },
        "raw_mrz": [
            "ICCOL000000012<<<<<<<<<<<<<<<<",
            "8808213F3101300COL1234567890<9",
            "WALTEROS<<<<<<<<<<<<<<<<LAURA<",
        ],
    }

    merged = _merge_local_ocr_mrz(local, mrz)

    assert merged["cedula"] == "1234567890"
    assert merged["parsed"]["cedula"] == "1234567890"
    assert merged["parsed"]["primer_apellido"] == "WALTEROS"
    assert merged["parsed"]["nombres"] == "LAURA"
    assert merged["ok"] is False
    assert merged["requires_review"] is True


def test_unvalidated_mrz_never_inherits_identity_fields_from_another_read():
    merged = _merge_local_ocr_mrz(
        {"cedula": "1111111111", "parsed": {"nombres": "OTHER PERSON", "genero": "M"}},
        {"cedula": "1234567890", "mrz_valido": False, "parsed": {"nombres": "LILI"}},
    )
    assert merged["parsed"] == {"nombres": "LILI"}
    assert merged["requires_review"] is True


def test_default_photo_ocr_never_calls_paid_service(monkeypatch):
    import asyncio
    import ocr_service

    async def fake_local(image):
        return {"ok": False, "requires_review": True}

    def unexpected_cloud(*args):
        raise AssertionError("Cloud service called by the no-cost flow")

    monkeypatch.setattr(ocr_service, "_ocr_cedula_with_mrz_async", fake_local)
    monkeypatch.setattr(ocr_service, "gemini_should_run_first", unexpected_cloud)
    monkeypatch.setattr(ocr_service, "analyze_cedula_with_gemini", unexpected_cloud)
    assert asyncio.run(ocr_service.ocr_from_base64_async("dGVzdA=="))["requires_review"]


def test_conflicting_cloud_and_ocr_identities_are_never_merged():
    from ocr_service import _merge_ocr_gemini
    result = _merge_ocr_gemini(
        {'cedula':'1234567890', 'parsed':{'nombres':'LILI'}},
        {'cedula':'9876543210', 'parsed':{'primer_apellido':'OTHER'}}, True)
    assert not result['ok'] and result['cedula'] == '' and result['parsed'] == {}


def test_valid_local_identity_cannot_be_overwritten_by_cloud():
    from ocr_service import _merge_ocr_gemini
    local = {'cedula':'1234567890', 'mrz_valido':True, 'parsed':{'nombres':'LILI'}}
    assert _merge_ocr_gemini(local, {'cedula':'9876543210'}, True) == local
