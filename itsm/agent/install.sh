#!/usr/bin/env bash
# CM Collaborator · Instalador do Agente de Monitoramento (Linux)
# © 2026 Digital Agile Technology · CM Collaborator.
# Uso: curl -fsSL <site>/itsm/agent/install.sh | sudo bash -s -- --token <TOKEN> --url <URL> [--ports "host:porta,..."] [--services "nginx,postgresql"] [--interval 5]
#      sudo bash install.sh --uninstall
set -euo pipefail
SITE="https://camjr1985.github.io/cm-collaborator/itsm/agent"
TOKEN=""; URL=""; PORTS=""; SERVICES=""; INTERVAL=5; UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;; --url) URL="$2"; shift 2;; --ports) PORTS="$2"; shift 2;;
    --services) SERVICES="$2"; shift 2;; --interval) INTERVAL="$2"; shift 2;; --uninstall) UNINSTALL=1; shift;;
    *) echo "opção desconhecida: $1" >&2; exit 1;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)." >&2; exit 1; }
if [ "$UNINSTALL" = 1 ]; then
  systemctl disable --now cm-agent.timer 2>/dev/null || true
  rm -f /etc/systemd/system/cm-agent.service /etc/systemd/system/cm-agent.timer /etc/cron.d/cm-agent /usr/local/bin/cm-agent.sh /etc/cm-agent.conf
  systemctl daemon-reload 2>/dev/null || true
  echo "Agente CM removido."; exit 0
fi
[[ "$TOKEN" =~ ^[A-Za-z0-9_-]{24,80}$ ]] || { echo "Token inválido. Copie o comando de novo na aba Monitoramento." >&2; exit 1; }
[[ "$URL" =~ ^https://script\.google\.com/ ]] || { echo "URL inválida." >&2; exit 1; }
[[ "$INTERVAL" =~ ^[0-9]+$ ]] && [ "$INTERVAL" -ge 5 ] || INTERVAL=5
command -v curl >/dev/null || { echo "Instale o curl primeiro." >&2; exit 1; }
curl -fsSL "$SITE/cm-agent.sh" -o /usr/local/bin/cm-agent.sh
chmod 755 /usr/local/bin/cm-agent.sh
umask 077
cat > /etc/cm-agent.conf <<CONF
TOKEN="$TOKEN"
URL="$URL"
CHECK_PORTS="$PORTS"
CHECK_SERVICES="$SERVICES"
CONF
chmod 600 /etc/cm-agent.conf
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/cm-agent.service <<UNIT
[Unit]
Description=CM Collaborator - agente de monitoramento
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/cm-agent.sh
UNIT
  cat > /etc/systemd/system/cm-agent.timer <<UNIT
[Unit]
Description=CM Collaborator - batimento a cada ${INTERVAL} min
[Timer]
OnBootSec=1min
OnUnitActiveSec=${INTERVAL}min
RandomizedDelaySec=30
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now cm-agent.timer
  echo "Agendado com systemd (cm-agent.timer, a cada ${INTERVAL} min)."
else
  echo "*/${INTERVAL} * * * * root /usr/local/bin/cm-agent.sh >/dev/null 2>&1" > /etc/cron.d/cm-agent
  echo "Agendado com cron (/etc/cron.d/cm-agent)."
fi
echo "Primeiro envio:"
/usr/local/bin/cm-agent.sh || true
echo "Pronto. Em até 1 minuto o monitor aparece \"No ar\" na aba Monitoramento."
