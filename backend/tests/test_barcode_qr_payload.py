import barcode_service

from barcode_service import extract_qr_identity_number


def test_extract_qr_registraduria_nuip_url():
    raw = "https://wsp.registraduria.gov.co/cert?nuip=1023456789"

    assert extract_qr_identity_number(raw) == "1023456789"


def test_extract_qr_prefixed_cc_and_nuip():
    assert extract_qr_identity_number("CC1023456789") == "1023456789"
    assert extract_qr_identity_number("NUIP: 1.023.456.789") == "1023456789"


def test_extract_qr_plain_number():
    assert extract_qr_identity_number("1023456789") == "1023456789"


def test_extract_qr_json_payload():
    raw = '{"document_number":"1.023.456.789","nombre":"LAURA"}'

    assert extract_qr_identity_number(raw) == "1023456789"


def test_decode_identity_prefer_mrz_tries_mrz_before_pdf417(monkeypatch):
    calls = []

    def fake_qr(_image_base64):
        calls.append("qr")
        return {"ok": False, "cedula": "", "raw": "", "parsed": {}, "error": "no qr"}

    def fake_mrz(_image_base64):
        calls.append("mrz")
        return {
            "ok": True,
            "cedula": "1234567890",
            "raw": "ICCOL...",
            "parsed": {"cedula": "1234567890"},
            "format": "MRZ",
            "source": "mrz_ocr",
        }

    def fake_pdf417(_image_base64):
        calls.append("pdf417")
        return {"ok": True, "cedula": "999", "raw": "old", "parsed": {"cedula": "999"}}

    monkeypatch.setattr(barcode_service, "decode_qr_from_base64", fake_qr)
    monkeypatch.setattr(barcode_service, "_decode_mrz_from_base64", fake_mrz)
    monkeypatch.setattr(barcode_service, "decode_barcode_from_base64", fake_pdf417)

    result = barcode_service.decode_identity_document_from_base64("fake-image", prefer_mrz=True)

    assert result["cedula"] == "1234567890"
    assert calls == ["qr", "mrz"]
