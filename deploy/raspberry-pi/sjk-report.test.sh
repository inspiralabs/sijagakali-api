#!/bin/bash
# Uji sjk-report tanpa Pi: vcgencmd & mosquitto_pub diganti stub, path /etc & /run dialihkan ke folder sementara.
# Pakai: bash deploy/raspberry-pi/sjk-report.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
printf '#!/bin/bash\necho "temp=52.1'"'"'C"\n' > "$T/bin/vcgencmd"
printf '#!/bin/bash\nexit 0\n' > "$T/bin/mosquitto_pub"
chmod +x "$T/bin/"*
sed -e "s#/etc/sijagakali/mqtt.conf#$T/mqtt.conf#" -e "s#/run/sijagakali#$T/run#g" "$HERE/sjk-report" > "$T/sjk-report"
fail=0
check() { # nama, isi mqtt.conf, pola yang diharapkan di last-report
  printf '%s\n' "$2" > "$T/mqtt.conf"
  PATH="$T/bin:$PATH" bash "$T/sjk-report" >/dev/null 2>&1
  if grep -q "$3" "$T/run/last-report"; then echo "ok   $1"; else echo "FAIL $1: $(cat "$T/run/last-report")"; fail=1; fi
}
check "kirim sukses" $'MQTT_DEVICE_ID=node-001\nMQTT_PASSWORD=x' 'OK 52.1C'
check "password tidak ada" 'MQTT_DEVICE_ID=node-001' 'GAGAL mqtt.conf tidak lengkap'
exit $fail
