#!/bin/sh
# Cek auth + ACL broker. Jalankan:
#   docker compose exec -e BACKEND_PASS=... -e DEVICE_PASS=... mosquitto sh /mosquitto/config/acl-check.sh
# Butuh user sijagakali-backend dan node-001 di pwfile. Exit 0 = lulus.
set -eu
H=127.0.0.1
OUT=/tmp/acl-check.out

mosquitto_sub -h $H -u sijagakali-backend -P "$BACKEND_PASS" -t 'sijagakali/#' -v -W 4 > "$OUT" 2>/dev/null &
SUB=$!
sleep 1

pub() { mosquitto_pub -h $H -u node-001 -P "$DEVICE_PASS" -q 1 -t "$1" -m "$2" 2>/dev/null || true; }
pub sijagakali/node-001/sensor/data allowed
pub sijagakali/node-002/sensor/data denied-other-device
pub sijagakali/node-001/command denied-own-command

if mosquitto_pub -h $H -u node-001 -P wrong-password -t sijagakali/node-001/sensor/data -m x 2>/dev/null; then
  echo "FAIL: password salah diterima"; exit 1
fi

wait $SUB || true
grep -q 'sijagakali/node-001/sensor/data allowed' "$OUT" || { echo "FAIL: publish sah tidak sampai"; cat "$OUT"; exit 1; }
if grep -q denied "$OUT"; then echo "FAIL: publish terlarang lolos"; cat "$OUT"; exit 1; fi
echo "ACL OK"
