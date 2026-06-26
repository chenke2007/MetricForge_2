"""Test key encryption and masking."""

import os
import pytest
from app.services.key_encryption import encrypt, decrypt, mask_api_key


@pytest.fixture(autouse=True)
def _set_enc_key(monkeypatch):
    monkeypatch.setenv("METRICFORGE_ENC_KEY", "test-master-key-0123456789")


def test_encrypt_decrypt_roundtrip():
    plain = "sk-test-key-value-12345"
    cipher = encrypt(plain)
    assert cipher != plain
    assert decrypt(cipher) == plain


def test_encrypt_different_each_time():
    plain = "sk-test-key"
    c1 = encrypt(plain)
    c2 = encrypt(plain)
    assert c1 != c2  # Fernet salts each encryption


def test_mask_api_key_typical():
    assert mask_api_key("sk-VaZuwZGRVwOSBjgLcM2WEHnwIm6swCgOkydtp2L6uEMLaz2y") == "sk-****az2y"


def test_mask_api_key_short():
    assert mask_api_key("sk-abc") == "****"


def test_encrypt_no_key_raises(monkeypatch):
    monkeypatch.delenv("METRICFORGE_ENC_KEY", raising=False)
    with pytest.raises(RuntimeError, match="METRICFORGE_ENC_KEY"):
        encrypt("test")
