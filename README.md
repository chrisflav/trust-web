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

## Marks

Human judgements — trusted, characterized, protected — live in
`trust-marks.json`, which belongs to the CLI rather than to this repository:
recording a content hash needs the Lean environment.  While `trust serve-marks`
is running on `127.0.0.1:8123`, `npm run dev` proxies `/api/marks` to it and the
marks become editable from the browser.  With nothing listening — and in any
deployed instance — the exported marks are shown read-only.

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
