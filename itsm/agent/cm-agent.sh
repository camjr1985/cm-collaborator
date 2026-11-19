#!/usr/bin/env bash
# CM Collaborator · Agente de Monitoramento do ITSM (Linux)
# © 2026 Digital Agile Technology · CM Collaborator. Uso exclusivo de clientes do CM Collaborator.
# Envia um "batimento" (CPU, memória, disco, carga e checks locais) por HTTPS de saída. Não abre portas.
# Configuração: /etc/cm-agent.conf  (TOKEN, URL, CHECK_PORTS, CHECK_SERVICES)
set -u
VERSION="1.0.0"
CONF="${CM_AGENT_CONF:-/etc/cm-agent.conf}"
[ -r "$CONF" ] || { echo "cm-agent: $CONF não encontrado" >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONF"
: "${TOKEN:?TOKEN ausente em $CONF}" "${URL:?URL ausente em $CONF}"
CHECK_PORTS="${CHECK_PORTS:-}"        # ex.: "localhost:5432,10.0.0.5:3306"
CHECK_SERVICES="${CHECK_SERVICES:-}"  # ex.: "nginx,postgresql"

cpu_pct() {
  read -r _ a b c d e f g _ < /proc/stat; t1=$((a+b+c+d+e+f+g)); i1=$((d+e))
  sleep 1
  read -r _ a b c d e f g _ < /proc/stat; t2=$((a+b+c+d+e+f+g)); i2=$((d+e))
  dt=$((t2-t1)); [ "$dt" -gt 0 ] && echo $(( (100*(dt-(i2-i1)))/dt )) || echo 0
}
mem_pct() { awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{ if(t>0) printf "%d", (100*(t-a))/t; else print 0 }' /proc/meminfo; }
disk_pct() { df -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR>1{gsub("%","",$5); if($5+0>m) m=$5+0} END{print m+0}'; }
load1() { cut -d' ' -f1 /proc/loadavg; }
uptime_s() { cut -d. -f1 /proc/uptime; }
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r' | cut -c1-150; }

checks=""
add_check() { [ -n "$checks" ] && checks="$checks,"; checks="$checks{\"name\":\"$(esc "$1")\",\"ok\":$2,\"msg\":\"$(esc "$3")\"}"; }
IFS=',' read -r -a ports <<< "$CHECK_PORTS"
for hp in "${ports[@]}"; do
  [ -z "$hp" ] && continue; h="${hp%:*}"; p="${hp##*:}"
  if timeout 3 bash -c "exec 3<>/dev/tcp/$h/$p" 2>/dev/null; then add_check "porta $hp" true ""; else add_check "porta $hp" false "sem conexão"; fi
done
IFS=',' read -r -a svcs <<< "$CHECK_SERVICES"
for sv in "${svcs[@]}"; do
  [ -z "$sv" ] && continue
  st=$(systemctl is-active "$sv" 2>/dev/null || true)
  if [ "$st" = "active" ]; then add_check "serviço $sv" true ""; else add_check "serviço $sv" false "${st:-desconhecido}"; fi
done

body="{\"kind\":\"mon-beat\",\"token\":\"$TOKEN\",\"version\":\"linux-$VERSION\",\"host\":\"$(esc "$(hostname)")\",\"metrics\":{\"cpu\":$(cpu_pct),\"mem\":$(mem_pct),\"disk\":$(disk_pct),\"load\":$(load1),\"uptime\":$(uptime_s)},\"checks\":[${checks}]}"
out=$(curl -sSL --max-time 30 -H "Content-Type: text/plain" --data "$body" "$URL" 2>&1) || { echo "cm-agent: falha ao enviar: $out" >&2; exit 2; }
echo "cm-agent: $out"
