#!/bin/sh
#
# Write nginx a `resolver` from the container's own /etc/resolv.conf.
#
# `/release/` proxies to GitHub, and a `proxy_pass` whose host comes from a
# variable is resolved per request rather than at startup — which nginx will
# only do if a resolver is configured.  There is no address that is right
# everywhere: Docker's embedded DNS is 127.0.0.11 only on a user-defined
# network, plain bridge networking copies the host's nameservers instead, and
# podman and Kubernetes each do something else again.  What is always right is
# whatever the container was given, so that is what this reads.
#
# nginx's own entrypoint runs everything in /docker-entrypoint.d before it
# starts, and /etc/nginx/conf.d/*.conf is included in the `http` block, which is
# the context `resolver` has to sit in for `server` to inherit it.
#
# If there is nothing usable to find, this writes nothing and says so.  nginx
# then starts and serves normally, and only `/release/` fails — a deployment
# that reads local indexes and branches should not fail to boot over a feature
# it may not use.
set -eu

CONF=/etc/nginx/conf.d/00-resolver.conf

# Loopback nameservers belong to a resolver on the *host* (systemd-resolved at
# 127.0.0.53, Docker's DNS at 127.0.0.11 when it is not ours to reach); inside
# this container they answer nothing, except for Docker's, which does.
SERVERS=$(awk '
  $1 == "nameserver" && $2 != "" {
    if ($2 == "127.0.0.11" || $2 !~ /^127\./) print $2
  }' /etc/resolv.conf 2>/dev/null | head -3 | tr '\n' ' ')

if [ -z "${SERVERS% }" ]; then
  echo "10-resolver.sh: no usable nameserver in /etc/resolv.conf; /release/ will not work"
  exit 0
fi

# ipv6=off because an AAAA lookup that resolves to an address with no route out
# costs a timeout on every request, and GitHub is reachable over IPv4.
printf 'resolver %sipv6=off valid=300s;\nresolver_timeout 5s;\n' "$SERVERS" > "$CONF"
echo "10-resolver.sh: resolver ${SERVERS}(from /etc/resolv.conf)"
