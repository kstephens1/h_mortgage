#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: sudo install-release.sh RELEASE_ID ARCHIVE ENV_FILE" >&2
  exit 2
fi

release_id=$1
archive=$2
env_file=$3
release_dir="/opt/chat-h/releases/${release_id}"

if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]+$ ]]; then
  echo "Invalid release ID" >&2
  exit 2
fi
if [[ ! -f "$archive" || ! -f "$env_file" ]]; then
  echo "Archive or environment file is missing" >&2
  exit 2
fi

id chat-h >/dev/null 2>&1 || useradd --system --home /opt/chat-h --shell /usr/sbin/nologin chat-h
install -d -o chat-h -g chat-h -m 0750 /opt/chat-h/releases
install -d -o root -g root -m 0755 /opt/chat-h/runtime
install -d -o root -g root -m 0700 /etc/chat-h
install -d -o www-data -g www-data -m 0755 /var/www/chat-h-certbot

if [[ -e "$release_dir" ]]; then
  echo "Release already exists: $release_dir" >&2
  exit 1
fi
install -d -o chat-h -g chat-h -m 0750 "$release_dir"
tar -xzf "$archive" -C "$release_dir"
chown -R chat-h:chat-h "$release_dir"

node_version="22.21.1"
if [[ ! -x /opt/chat-h/runtime/node/bin/node ]] ||
   [[ "$(/opt/chat-h/runtime/node/bin/node --version)" != "v${node_version}" ]]; then
  case "$(uname -m)" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) echo "Unsupported VM architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  node_archive="/tmp/node-v${node_version}-linux-${node_arch}.tar.xz"
  curl -fsSLo "$node_archive" \
    "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-${node_arch}.tar.xz"
  tar -xJf "$node_archive" -C /opt/chat-h/runtime
  ln -sfn "/opt/chat-h/runtime/node-v${node_version}-linux-${node_arch}" /opt/chat-h/runtime/node
fi

install -d -o chat-h -g chat-h -m 0700 "$release_dir/.npm-cache"
runuser -u chat-h -- env PATH="/opt/chat-h/runtime/node/bin:/usr/bin:/bin" \
  /opt/chat-h/runtime/node/bin/npm ci --omit=dev --ignore-scripts \
  --cache "$release_dir/.npm-cache" --prefix "$release_dir"

if [[ -f /etc/chat-h/app.env ]]; then
  existing_session_secret=$(sed -n 's/^AUTH_SESSION_SECRET=//p' /etc/chat-h/app.env)
  if [[ -n "$existing_session_secret" ]]; then
    sed -i "s|^AUTH_SESSION_SECRET=.*|AUTH_SESSION_SECRET=${existing_session_secret}|" "$env_file"
  fi
fi
install -o root -g root -m 0600 "$env_file" /etc/chat-h/app.env
install -o root -g root -m 0644 "$release_dir/deploy/chat-h-mcp.service" /etc/systemd/system/chat-h-mcp.service
install -o root -g root -m 0644 "$release_dir/deploy/chat-h-web.service" /etc/systemd/system/chat-h-web.service

if [[ ! -f /etc/letsencrypt/live/chat-h.35.211.52.83.nip.io/fullchain.pem ]]; then
  install -o root -g root -m 0644 "$release_dir/deploy/chat-h-bootstrap.nginx.conf" /etc/nginx/sites-available/chat-h
  ln -sfn /etc/nginx/sites-available/chat-h /etc/nginx/sites-enabled/zz-chat-h
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot --webroot-path /var/www/chat-h-certbot \
    --domain chat-h.35.211.52.83.nip.io --non-interactive --agree-tos \
    --email kstephens1@gmail.com
fi

install -o root -g root -m 0644 "$release_dir/deploy/chat-h.nginx.conf" /etc/nginx/sites-available/chat-h
ln -sfn /etc/nginx/sites-available/chat-h /etc/nginx/sites-enabled/zz-chat-h
if [[ -L /etc/nginx/sites-enabled/chat-h ]]; then
  rm /etc/nginx/sites-enabled/chat-h
fi
nginx -t

previous_release=""
if [[ -L /opt/chat-h/current ]]; then
  previous_release=$(readlink -f /opt/chat-h/current)
fi
ln -sfn "$release_dir" /opt/chat-h/current
printf '%s\n' "$previous_release" > /opt/chat-h/previous-release

systemctl daemon-reload
systemctl enable chat-h-mcp.service chat-h-web.service
systemctl restart chat-h-mcp.service chat-h-web.service
systemctl reload nginx
systemctl is-active --quiet chat-h-mcp.service
systemctl is-active --quiet chat-h-web.service
for _ in {1..20}; do
  if ss -ltn | grep '127.0.0.1:8787' >/dev/null &&
     ss -ltn | grep '127.0.0.1:5174' >/dev/null; then
    listeners_ready=true
    break
  fi
  sleep 0.5
done
if [[ "${listeners_ready:-false}" != "true" ]]; then
  echo "Chat-H listeners did not become ready" >&2
  exit 1
fi

echo "Installed Chat-H release $release_id"
