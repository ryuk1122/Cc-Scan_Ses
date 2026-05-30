from cedula_parser import extract_cedula, parse_pdf417, parse_pdf417_bytes


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
