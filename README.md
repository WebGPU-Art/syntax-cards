## Syntax Cards

WebGPU scene built with [Lagopus](https://github.com/WebGPU-Art/lagopus).

### Development

Use stable Calcit 0.29.0 and Caps 0.1.1. The compiler, manifest and installed
`@calcit/procs` must agree; module dependencies use published stable tags.

```sh
caps --strict --ci
corepack enable
yarn install --immutable
caps verify --toolchain
calcit --check-only --all-defs --warn-dyn-method
yarn dev
```

Edit `calcit.cirru` through the Calcit CLI. It is the canonical source;
`js-out/` and `dist/` are generated and must not be committed.

### Deployment

CI builds PRs without production credentials or uploads. Main uploads frontend
assets to `https://cos-sh.tiye.me/WebGPU-Art/syntax-cards/` using the COS action's
built-in verification, then retains the original server destination
`rsync-user@tiye.me:/web-assets/repo/WebGPU-Art/syntax-cards`.

Production requires repository or inherited organization secrets `COS_BUCKET`,
`COS_SECRET_ID`, `COS_SECRET_KEY`, and `rsync_private_key`. Local acceptance or
green PR builds do not prove deployment; the production run must pass too.

### License

MIT
