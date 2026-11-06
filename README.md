# compurl

Paste a URL or a curl command to see every part and parameter decoded, or paste up to six to
compare them. compurl splits each one into scheme, host, path, query parameters and fragment,
decodes structured values inside them, and lines the results up in one table with differences
highlighted. Differing parts are also highlighted in the pasted text itself.

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
