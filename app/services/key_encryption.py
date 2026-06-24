"""API Key 加密/解密工具，使用 cryptography.fernet 对称加密。"""

import os
import base64
import hashlib
from cryptography.fernet import Fernet


_ENC_KEY_ENV = "METRICFORGE_ENC_KEY"


def _derive_fernet_key(master_key: str) -> bytes:
    """将任意字符串主密钥派生为 Fernet 所需的 32 字节 URL-safe base64 密钥。"""
    raw = hashlib.sha256(master_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(raw)


def _get_master_key() -> str:
    key = os.environ.get(_ENC_KEY_ENV)
    if not key:
        raise RuntimeError(
            f"环境变量 {_ENC_KEY_ENV} 未设置，无法进行加密操作。"
        )
    return key


def encrypt(plaintext: str) -> str:
    """加密明文，返回 Fernet token 字符串。"""
    f = Fernet(_derive_fernet_key(_get_master_key()))
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    """解密密文，返回明文字符串。"""
    f = Fernet(_derive_fernet_key(_get_master_key()))
    return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")


def mask_api_key(api_key: str) -> str:
    """脱敏 API Key：仅显示前缀和后4位。"""
    if len(api_key) <= 8:
        return "****"
    return api_key[:3] + "****" + api_key[-4:]
