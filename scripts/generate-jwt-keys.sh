#!/usr/bin/env bash
# Generates the ES256 keypair the API signs access tokens with.
# Usage: scripts/generate-jwt-keys.sh [output-dir]   (default: keys/)
set -euo pipefail

OUT_DIR="${1:-keys}"

mkdir -p "$OUT_DIR"
umask 077

# A half pair is worse than none: the API needs both halves and the front needs
# the public one, so a private key with no public key gets the public half
# rebuilt from it instead of a cheerful "already exist".
if [[ -f "$OUT_DIR/jwt-private.pem" ]]; then
  if [[ -f "$OUT_DIR/jwt-public.pem" ]]; then
    echo "Keys already exist in $OUT_DIR/, not overwriting." >&2
    exit 0
  fi
  openssl ec -in "$OUT_DIR/jwt-private.pem" -pubout -out "$OUT_DIR/jwt-public.pem" 2>/dev/null
  echo "Rebuilt the missing $OUT_DIR/jwt-public.pem from the existing private key." >&2
  exit 0
fi

openssl ecparam -name prime256v1 -genkey -noout |
  openssl pkcs8 -topk8 -nocrypt -out "$OUT_DIR/jwt-private.pem"
openssl ec -in "$OUT_DIR/jwt-private.pem" -pubout -out "$OUT_DIR/jwt-public.pem" 2>/dev/null

echo "ES256 keypair written to $OUT_DIR/jwt-private.pem and $OUT_DIR/jwt-public.pem"
