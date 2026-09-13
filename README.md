# trust-web

The frontend of [trust](https://github.com/chrisflav/trust): a React application
for reading what a Lean declaration definitionally rests on, and what rests on
it.  It walks the dependency graph, renders the declarations themselves, and
shows the human judgements and trust certificates attached to them.

> [!WARNING]
> **Experimental, LLM-generated, and not reviewed by a human.**
>
> This code was written by an LLM (Claude).  No human has read it line by line,
> and the performance and correctness claims in this README were measured by the
> same process that wrote the code — they have not been independently checked.
>
> The point of this tool is to help you decide what to trust.  Do not extend that
> trust to the tool: read the code before relying on any of it, and treat what it
> reports as a question worth checking rather than an answer.

## Running it

```bash
npm ci && npm run dev
```

That serves the application on <http://localhost:5173>.  It has nothing to show
until there is an index to read.

## The index

Everything displayed here comes from a **static index** produced by `trust
export`, which reads a library's `.olean` files and writes out the declarations,
the statement and body edges, the rendered code and the marks:

```bash
trust export --repo core --out public/index --with-bodies --with-code Init
```

The frontend reads `<root>/<name>/meta.json`, and `?repo=` selects the name, so
an index downloaded from CI — [chrisflav/trust-action](https://github.com/chrisflav/trust-action)
generates one on every push — is unpacked and served as it stands:

```bash
unzip trust-index.zip -d public/index
npm run dev      # http://localhost:5173/?repo=mylibrary
```

Because the index is static, a deployment is a plain set of files behind a web
server; `docker/Dockerfile.web` and `docker/nginx.conf` build that image, with
the index bind-mounted rather than baked in.

### Reading a library nobody deployed

An index can also be read straight from the repository that produced it.  A
library whose CI runs the action with `publish: branch` force-pushes its index
to a `trust-index` branch, and `?gh=` reads it from there:

```
https://trust.example.org/?gh=lana-agents/formal-schemes
```

A visit that names no index is **asked** which library to read, rather than
shown one it did not choose.  The answer is kept in `sessionStorage`, so the
question comes once per session and a link that carries `?gh=` still wins; the
picker beside the title reopens the dialog to change it.

It takes the same thing typed by hand — `owner/repo`, a `github.com` URL, or a
bare name for one of the indexes this deployment serves itself — and offers
back what this browser has read before.  It cannot offer a menu of what exists:
`raw.githubusercontent.com` has no listing, and `/index/` is served with
`try_files … =404`, so there is nothing to enumerate.

This reads a **branch**, not the workflow artifact, and that is forced rather
than chosen: downloading an artifact needs a token with the `repo` scope even
for a public repository, so a page that read artifacts would have to ask every
reader for full control of their private repositories to show them a public
dependency graph.  A branch is anonymous, and it arrives with
`Access-Control-Allow-Origin: *` and gzip — so the same reader that loads a
local index loads a published one, lazy code shards and all.


### Or to a release

A library that would rather not carry its index in its own history publishes it
with `publish: release` instead, and `?release=` reads it:

```
https://trust.example.org/?release=lana-agents/formal-schemes
```

This one is not free the way `?gh=` is.  Release assets are served without
`Access-Control-Allow-Origin` and with `Content-Disposition: attachment`, so no
browser can read them cross-origin however the fetch is written — they are
readable here only because `docker/nginx.conf` proxies them onto this origin at
`/release/`, following GitHub's redirect on the page's behalf and folding the
flat asset name (`mylib--code--7.jsonl`) back into the path the loader expects
(`mylib/code/7.jsonl`).

So `?gh=` works in any copy of this frontend, including one opened from a file;
`?release=` works only where this image, or an equivalent proxy, is in front.
The dialog asks which of the two a repository uses, because nothing in
`owner/repo` says so and guessing would mean a speculative request per
keystroke.

The proxy will fetch any public release asset from any public repository, which
is what lets the picker read a library this deployment has never heard of, and
also makes a deployment a download mirror for GitHub releases to anyone who
points at it.  A deployment that does not want that can drop the three
`/release/` blocks; `?gh=` keeps working.
## Marks

Human judgements — trusted, characterized, protected — live in
`trust-marks.json`, which belongs to the CLI rather than to this repository:
recording a content hash needs the Lean environment.  While `trust serve-marks`
is running on `127.0.0.1:8123`, `npm run dev` proxies `/api/marks` to it and the
marks become editable from the browser.  With nothing listening — and in any
deployed instance — the exported marks are shown read-only.

## Reading a graph

The graph beside a declaration opens full screen, and that is where a closure of
any size is actually read.  Hovering a node gives a card with the docstring and
the signature; `definition` adds the body, and stays on for the next node, so a
chain of definitions can be read without leaving the drawing.

A trusted declaration is drawn on a green field, and the card says **by whom** —
a mark from `trust-marks.json`, a certificate of your own, or one from somebody
whose key you follow, with a name this node authenticated shown differently from
one a stranger's node merely typed.  The same card records a judgement: `mark
trusted` writes to the marks file where that is editable, and `trust this`
publishes an unsigned certificate under your account.  A note or a signature
belongs with the declaration itself — double-click to open it — and that is the
only difference between the two paths.

Navigation goes through the browser's history, so the **back button** in the
page and the one in the browser are the same button: opening a declaration or
the full-screen graph is a step, going back undoes it, and a reload does not
lose where you have been.  The depth, the direction and the filters are
settings rather than places — they travel in the link, so a shared one arrives
as it was read, but going back does not move them.

## Tests

```bash
npm test
```

The suite includes a check against a real exported index, which is skipped when
none has been generated under `public/index`.


## Deploying

Both images are published by CI on every push to master, so a deployment pulls
rather than builds:

```
ghcr.io/chrisflav/trust-web:latest      20 MB
ghcr.io/chrisflav/trust-server:latest  534 MB
```

Both are public: an anonymous `docker pull ghcr.io/chrisflav/trust-web:latest`
works, so a deployment needs no registry login.

The published frontend carries **no baked node**: an unset `VITE_TRUST_SERVER`
means this page's own origin, which is exactly the arrangement below, so one image
serves every deployment.  Pass `VITE_TRUST_SERVER` at build time only if the
node lives on a different origin from the frontend.

`docker/Dockerfile.web` builds a **20 MB** image: the bundle, and an nginx
small enough that almost all of it is nginx.  It runs as an unprivileged user
(uid 101) and listens on 8080, because a port below 1024 is one that user
cannot bind.


The frontend and a node go on **one origin**, and that is worth insisting on:
same-origin means no CORS at all and a first-party session cookie, which
browsers increasingly refuse to send cross-site however correctly it is
labelled.  A reverse proxy holds the TLS and routes by prefix:

```
/        the frontend            (this repository's nginx image)
/index/  exported indexes        (the same nginx, from a bind mount)
/api/    the node                (chrisflav/trust-server)
/auth/   the node's GitHub sign-in
```

`docker/docker-compose.yml` brings both up, bound to loopback:

```bash
cd docker
cp .env.example .env && $EDITOR .env
docker compose up --build -d
```

The node is built from its own repository, so there is no second clone to keep
in step; the first build fetches the Lean toolchain and takes a few minutes.

Then put a proxy in front.  `deploy/trust.example.org.conf` is an Apache vhost
for exactly the arrangement above:

```bash
a2enmod proxy proxy_http ssl headers rewrite
cp deploy/trust.example.org.conf /etc/apache2/sites-available/trust.conf
$EDITOR /etc/apache2/sites-available/trust.conf     # the ServerName
a2ensite trust && apachectl configtest && systemctl reload apache2
certbot --apache -d trust.example.org
```

Three things that are the same value, and break quietly when they are not:
`PUBLIC_URL`, the `VITE_TRUST_SERVER` baked into the bundle (compose derives it
from `PUBLIC_URL`), and the GitHub OAuth App's callback, which must be
`${PUBLIC_URL}/auth/github/callback`.

`VITE_TRUST_SERVER` is substituted into the bundle at build time rather than
read at run time — that is how Vite works — so changing `PUBLIC_URL` means
`docker compose up --build web`, not a restart.

### Publishing an index

```bash
cd /path/to/mylibrary
lake env /path/to/trust/.lake/build/bin/trust export \
  --repo mylibrary --out /path/to/index --with-bodies --with-code MyLibrary
```

`INDEX_DIR` is bind-mounted read-only, so replacing a directory under it
publishes a new index without rebuilding or restarting anything.  The frontend
selects one with `?repo=mylibrary`.

## License

[Apache License 2.0](LICENSE).
