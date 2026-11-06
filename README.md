# compurl

Paste a URL, a curl command or another shell command to see every part and parameter decoded, or
paste up to six to compare them. compurl splits each one into scheme, host, path, query parameters
and fragment, decodes structured values inside them, and lines the results up in one table with
differences highlighted. Differing parts are also highlighted in the pasted text itself.

Everything runs in the browser. Nothing you paste is sent anywhere. The "Copy share link" button
puts the inputs, compressed, into the link's `#` fragment, so anyone with the link can read them.

## What it decodes

Every rule can be switched on or off in the page. Rules marked "off" start switched off.

| Group               | Rules                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keys                | dotted keys (`ui.theme`), bracket keys (`filter[size][]`), semicolon separators (off)                                                                                                     |
| Lists               | comma, pipe and space lists, search qualifiers (`is:open label:"bug fix"`)                                                                                                                |
| Nesting             | nested URLs, nested query strings, values encoded more than once                                                                                                                          |
| Formats             | JSON, base64 (JSON, XML or URLs), compressed (gzip, zlib, deflate, lz-string, Mermaid `pako:`, SAML), JWT and JWE, Flask/itsdangerous, Rails, PASETO, Rison, JSURL, base64 protobuf (off) |
| Paths and fragments | path segments, matrix params, text fragments (`#:~:text=`), Android intents, Google Maps `@lat,lng` and `data=!…`                                                                         |
| Annotations         | times for epoch seconds and milliseconds, UUIDv1/v7, ULID and Snowflake IDs; AWS, Google Cloud and Azure signing parameters with expiry times                                             |
| Treat as equal      | lists in any order, different case, URL variations (default ports, trailing slashes, `www.`), equal numbers (all off)                                                                     |

Repeated keys always become a list. Fragments shaped like `#/route?x=1` or `#a=1&b=2` are parsed
too, and a bare query string such as `a=1&b=2` works as input.

curl commands, including multi-line ones from a browser's "Copy as cURL", become the method, the
URL's parts, headers (with `Authorization` and `Cookie` decoded), cookies, body, form fields and
flags. A curl command and a plain URL line up row for row, so the two can be compared directly.

Other commands become their environment variables (`FOO=1 node app.js`), the program, its
arguments in order, and its options by name, with every value decoded by the rules above. compurl
doesn't know each program's options, so it guesses: an option takes the next argument as its value
unless that argument starts with `-`, or the option looks like a switch (`--no-color`, common
switches such as `--rm` and `--force`, `-O2`, or a bundle like `-it` followed by a plain word).
Everything after `--` is an argument. Options given as `KEY=value`, such as `-e PORT=80`,
`--set image.tag=v2` and Java's `-Dserver.port=8080`, are grouped by key, so the same key lines up
across commands. Anything after a `|`, `&&` or `;` is shown as one value, for curl commands too.

## Editing and copying

Each row has an edit button (or double-click a value). Editing a row shows one input per URL, so a
value can be changed, added or removed in each one separately. compurl writes the change back into
the original text, re-encoding through every layer it decoded: an edit to a field inside base64
JSON, a JWT, Rison, JSURL, a nested or double-encoded URL, a cookie or a curl body comes back out
encoded the same way. The rest of the text is left untouched. JWT signatures are kept as they are,
so they no longer match after an edit. "Add parameter" adds a query parameter, a header to curl
commands, or an option or environment variable to other commands. Edited command arguments keep
the quoting they were written with.

The copy button next to each input copies it as typed, as a curl command (or the URL from a curl
command), or as decoded JSON. Each value in the table has its own copy button too. Commands also
get a button that puts each option on its own line, with `\` line continuations, or joins them back
onto one line.

## Development

This project uses [Vite+](https://viteplus.dev). The `vp` CLI comes from the local `vite-plus`
dev dependency, so no global install is needed.

```sh
pnpm install
pnpm dev                # dev server
pnpm exec vp check      # format, lint, type check
pnpm exec vp test       # unit tests
pnpm build              # production build into dist/
```

The example URLs in `src/examples.ts` were generated with real encoders (zlib, lz-string and so
on), so every example decodes.

## Deployment

`.github/workflows/deploy.yml` runs the checks and tests on every push and pull request, and
deploys `dist/` to GitHub Pages on pushes to `main`. The build uses relative asset paths, so it
works at any Pages URL or custom domain.
