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
