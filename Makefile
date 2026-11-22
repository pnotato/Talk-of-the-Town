# Load .env (server-side settings) if present and export to child processes.
-include .env
# Where the server writes each finished run's log; .env or the shell can
# override it, and an empty value writes nothing.
RUNS_DIR ?= runs/scratch
export

.PHONY: dev server web build test check fmt types citymap

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
	@mkdir -p bin && go run ./cmd/gentypes $(TYPES_TMP) && diff -u $(TYPES_TS) $(TYPES_TMP) >/dev/null \
		|| { diff -u $(TYPES_TS) $(TYPES_TMP); rm -f $(TYPES_TMP); echo "$(TYPES_TS) is stale; run: make types"; exit 1; }
	@rm -f $(TYPES_TMP)
	@mkdir -p bin && node web/scripts/export-city-map.ts $(CITYMAP_TMP) && diff -u $(CITYMAP) $(CITYMAP_TMP) >/dev/null \
		|| { diff -u $(CITYMAP) $(CITYMAP_TMP); rm -f $(CITYMAP_TMP); echo "$(CITYMAP) is stale; run: make citymap"; exit 1; }
	@rm -f $(CITYMAP_TMP)
	npm --prefix web run typecheck
	npm --prefix web test
	npm --prefix web run lint
	npm --prefix web run format:check

TYPES_TS  := web/src/generated/types.ts
TYPES_TMP := bin/.types.tmp.ts

# Regenerate the TS types from internal/sim. Commit the result.
types:
	go run ./cmd/gentypes $(TYPES_TS)

CITYMAP     := internal/sim/citymap/city.json
CITYMAP_TMP := bin/.city.tmp.json

# Regenerate the city's walkable map for the Go path planner from web/src/scene. Commit the result.
citymap:
	node web/scripts/export-city-map.ts $(CITYMAP)

fmt:
	gofmt -w .
	npm --prefix web run format
