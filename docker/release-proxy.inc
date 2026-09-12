# Fetch one release asset from GitHub, onto this origin.
#
# Included from each `/release/` location, which has already worked out
# `$gh_owner`, `$gh_repo`, `$gh_tag` and `$asset`.  An include rather than a
# named location because the two locations differ only in how they fold the
# path into the asset name, and nginx has no other way to share a body.
# `$is_args$args` is load-bearing, not tidiness: a `proxy_pass` written with
# variables does not carry the query string over on its own, and the query is
# the whole of how a reader asks for a revision rather than whatever the CDN
# happens to be holding.  Without it the pinning in `source.ts` still builds the
# URLs and they still return 200, and every one of them is served from the
# cache that pinning exists to step around.
proxy_pass https://github.com/$gh_owner/$gh_repo/releases/download/$gh_tag/$asset$is_args$args;

# Nothing of the reader's goes upstream.  This is a public asset on a public
# host, and forwarding a session cookie to github.com because the frontend and
# the node share an origin would be a way to lose one.
proxy_set_header Authorization "";
proxy_set_header Cookie "";
proxy_set_header Host github.com;
proxy_ssl_server_name on;

# github.com answers a download with a 302 to a signed URL on
# release-assets.githubusercontent.com, and that response carries no
# `Access-Control-Allow-Origin` — which is the whole reason this proxy exists,
# so handing the redirect to the browser would only move the failure.  Follow it
# here instead.
proxy_intercept_errors on;
recursive_error_pages on;
error_page 301 302 307 308 = @release_redirect;

proxy_connect_timeout 10s;
proxy_read_timeout 300s;

# The 302's `Location` is a signed URL with a JWT in it, comfortably over a
# kilobyte, and the default header buffer is 4k for the whole response head.
# Without this, nginx fails the request with "upstream sent too big header"
# before it ever sees the redirect it is meant to follow.
proxy_buffer_size 16k;
proxy_buffers 8 16k;
