# Load .env (server-side settings) if present and export to child processes.
-include .env
export

.PHONY: dev server web build test check fmt types

# Go server + Vite dev server together (Ctrl-C stops both).
dev:
	$(MAKE) -j2 server web

server:
	go run ./cmd/server

web:
	npm --prefix web run dev

build:
	npm --prefix web run build
	go build -o bin/server ./cmd/server

test:
	go test ./...

# Must pass before a change is called done.
check:
	@test -z "$$(gofmt -l .)" || { gofmt -l .; echo "run: make fmt"; exit 1; }
	go vet ./...
	go test ./...
	@go run ./cmd/gentypes $(TYPES_TMP) && diff -u $(TYPES_TS) $(TYPES_TMP) >/dev/null \
		|| { diff -u $(TYPES_TS) $(TYPES_TMP); rm -f $(TYPES_TMP); echo "$(TYPES_TS) is stale; run: make types"; exit 1; }
	@rm -f $(TYPES_TMP)
	npm --prefix web run typecheck
	npm --prefix web run lint
	npm --prefix web run format:check

TYPES_TS  := web/src/generated/types.ts
TYPES_TMP := $(shell mktemp -u -t gentypes).ts

# Regenerate the TS types from internal/sim. Commit the result.
types:
	go run ./cmd/gentypes $(TYPES_TS)

fmt:
	gofmt -w .
	npm --prefix web run format
