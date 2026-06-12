from cedula_parser import clean_cedula, extract_cedula, mrz_check_digit, parse_mrz_from_text, parse_pdf417, parse_pdf417_bytes


def _put(data: bytearray, start: int, end: int, value: str) -> None:
    raw = value.encode("latin-1")
    data[start:end] = raw[: end - start].ljust(end - start, b"\x00")


def _classic_payload() -> bytes:
    data = bytearray(b"\x00" * 531)
    _put(data, 2, 10, "26497872")
    _put(data, 20, 27, "PubDSK_")
    _put(data, 40, 48, "366525")
    _put(data, 48, 58, "1150940755")
    _put(data, 58, 80, "VALENCIA")
    _put(data, 81, 104, "BENITEZ")
    _put(data, 104, 127, "DAYFENIX")
    _put(data, 127, 150, "")
    _put(data, 151, 152, "F")
    _put(data, 152, 156, "1991")
    _put(data, 156, 158, "07")
    _put(data, 158, 160, "29")
    _put(data, 160, 162, "31")
    _put(data, 162, 165, "019")
    _put(data, 166, 168, "A+")
    return bytes(data)


def test_parse_classic_pdf417_bytes_by_fixed_ranges():
    parsed = parse_pdf417_bytes(_classic_payload())

    assert parsed["cedula"] == "1150940755"
    assert parsed["primer_apellido"] == "VALENCIA"
    assert parsed["segundo_apellido"] == "BENITEZ"
    assert parsed["nombres"] == "DAYFENIX"
    assert parsed["genero"] == "F"
    assert parsed["fecha_nacimiento"] == "1991-07-29"
    assert parsed["tipo_sangre"] == "A+"
    assert parsed["document_info"]["afis_code"] == "26497872"
    assert parsed["document_info"]["finger_card"] == "366525"
    assert parsed["location"]["department"] == "VALLE"
    assert parsed["location"]["municipality"] == "BUENAVENTURA"


def test_parse_classic_pdf417_text_preserves_null_padding():
    raw = _classic_payload().decode("latin-1")

    parsed = parse_pdf417(raw)

    assert parsed["cedula"] == "1150940755"
    assert extract_cedula(raw) == "1150940755"
    assert parsed["formato_detectado"] == "pdf417_binario_posicional"


def _mrz_td1(doc: str = "123456789") -> str:
    birth = "910729"
    expiry = "300101"
    l1 = f"IDCOL{doc}{mrz_check_digit(doc)}".ljust(30, "<")
    l2_body = f"{birth}{mrz_check_digit(birth)}F{expiry}{mrz_check_digit(expiry)}COL"
    l2 = l2_body.ljust(29, "<") + "0"
    l3 = "VALENCIA<BENITEZ<<DAYFENIX".ljust(30, "<")
    return "\n".join([l1, l2, l3])


def test_parse_td1_mrz_from_new_cedula_back():
    parsed = parse_mrz_from_text(_mrz_td1())

    assert parsed["cedula"] == "123456789"
    assert parsed["primer_apellido"] == "VALENCIA"
    assert parsed["segundo_apellido"] == "BENITEZ"
    assert parsed["nombres"] == "DAYFENIX"
    assert parsed["fecha_nacimiento"] == "1991-07-29"
    assert parsed["fecha_expiracion"] == "2030-01-01"
    assert parsed["mrz_valido"] is True


def test_parse_td1_mrz_tolerates_common_ocr_errors():
    raw = _mrz_td1().replace("IDCOL", "1DC0L").replace("910729", "9I0729")

    parsed = parse_pdf417(raw)

    assert parsed["cedula"] == "123456789"
    assert parsed["formato_detectado"] == "mrz_td1"


def test_parse_new_colombian_iccol_mrz_uses_nuip_line2():
    raw = "\n".join([
        "ICCOL000000012305001<<<<<<<<<<",
        "0403151F3203190C0L1234567890<0",
        "WALTEROS<<LAURA<<<<<<<<<<<<",
    ])

    parsed = parse_mrz_from_text(raw)

    assert parsed["cedula"] == "1234567890"
    assert parsed["primer_apellido"] == "WALTEROS"
    assert parsed["segundo_apellido"] == ""
    assert parsed["nombres"] == "LAURA"
    assert parsed["fecha_nacimiento"] == "2004-03-15"
    assert parsed["fecha_expiracion"] == "2032-03-19"
    assert parsed["nacionalidad"] == "COL"
    assert parsed["mrz_valido"] is True


def test_parse_new_colombian_iccol_mrz_from_photo_example_prefers_line2_nuip():
    raw = "\n".join([
        "ICCOL000000012<<<<<<<<<<<<<<<",
        "8808213F3101300COL1234567890<9",
        "WALTEROS<<<<<<<<<<<<<<<<LAURA",
    ])

    parsed = parse_mrz_from_text(raw)

    assert parsed["cedula"] == "1234567890"
    assert parsed["primer_apellido"] == "WALTEROS"
    assert parsed["nombres"] == "LAURA"
    assert parsed["fecha_nacimiento"] == "1988-08-21"
    assert parsed["fecha_expiracion"] == "2031-01-30"


def test_clean_cedula_rejects_long_digit_concatenation():
    raw = "ICCOL000000012<<<<<<<<<<<<<<<\n8808213F3101300COL1234567890<9"

    assert clean_cedula(raw) == "1234567890"
    assert clean_cedula("ICCOL0000000128808213310130012345678909") is None


def test_parse_new_colombian_iccol_mrz_cleans_ocr_filler_before_given_name():
    raw = "\n".join([
        "ICCOLO00000012<<<<<<<<K<<<<",
        "8808213F3101300C0L1234567890<9",
        "WALTEROS<<<<<TSSSISSLKLAURA",
    ])

    parsed = parse_mrz_from_text(raw)

    assert parsed["cedula"] == "1234567890"
    assert parsed["primer_apellido"] == "WALTEROS"
    assert parsed["nombres"] == "LAURA"
    assert parsed["fecha_nacimiento"] == "1988-08-21"


def test_parse_new_colombian_iccol_mrz_cleans_cf_ocr_filler_before_given_name():
    raw = "\n".join([
        "ICCOLO00000012<<<<<<<<K<<<<",
        "8808213F3101300C0L1234567890<9",
        "WALTEROS<<<<<FSCCCCCCCLAURA",
    ])

    parsed = parse_mrz_from_text(raw)

    assert parsed["cedula"] == "1234567890"
    assert parsed["primer_apellido"] == "WALTEROS"
    assert parsed["nombres"] == "LAURA"
