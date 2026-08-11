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

## License

[Apache License 2.0](LICENSE).
