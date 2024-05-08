run:
	make build
	node out/index.js

build:
	bun build index.ts --target=node --outdir=out/