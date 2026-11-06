# compurl

Compare two to six URLs part by part. compurl splits each URL into scheme, host, path, query
parameters and fragment, decodes structured values inside them, and lines the results up in one
table with differences highlighted. Differing parts are also highlighted in the URLs themselves.

Everything runs in the browser. Nothing you paste is sent anywhere. The "Copy share link" button
puts the URLs, compressed, into the link's `#` fragment, so anyone with the link can read them.

## What it decodes

Each rule can be switched off in the page.

| Rule                 | Example                                       |
| -------------------- | --------------------------------------------- |
| Dotted keys          | `ui.theme=dark` becomes `ui › theme`          |
| Bracket keys         | `filter[size][]=9&filter[size][]=10`          |
| Comma lists          | `sort=price,-rating`                          |
| Nested URLs          | `return=https%3A%2F%2Fa.example%2F%3Fx%3D1`   |
| Nested query strings | `state=a%3D1%26b%3D2`                         |
| JSON                 | `f={"size":9}`                                |
| Base64 JSON          | `ctx=eyJzaXplIjo5fQ`                          |
| JWT                  | header and payload, with `exp`/`iat` as dates |
| Rison                | `_g=(time:(from:now-7d,to:now))`              |
| Matrix params        | `/catalog;view=grid/shoes`                    |

Repeated keys always become a list. Fragments that look like `#/route?x=1` or `#a=1&b=2` are
parsed too. A bare query string such as `a=1&b=2` works as input.

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

## Deployment

`.github/workflows/deploy.yml` runs the checks and tests on every push and pull request, and
deploys `dist/` to GitHub Pages on pushes to `main`. In the repository settings, set
Pages > Build and deployment > Source to "GitHub Actions". The build uses relative asset paths,
so it works at any Pages URL or custom domain.
