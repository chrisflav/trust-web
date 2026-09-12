# `Content-Disposition: attachment` is what a release asset is served with, and
# it means "save this", which is not what a fetch of `meta.json` wants.
proxy_hide_header Content-Disposition;
proxy_hide_header Set-Cookie;

# An asset arrives as application/octet-stream and uncompressed, where the same
# file on a branch arrives gzipped: `decls.jsonl` is tens of megabytes of JSON
# and this is most of the load.  Compressing it here costs CPU on every miss,
# which is why the level is 1 — for text this size the difference between 1 and
# 6 is a few percent of size and several times the CPU.
gzip on;
gzip_proxied any;
gzip_comp_level 1;
gzip_min_length 1024;
gzip_types application/octet-stream application/json text/plain;

add_header Cache-Control "public, max-age=300";
