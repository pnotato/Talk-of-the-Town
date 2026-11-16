// Package server holds the HTTP routes. Keep it thin; logic lives in sim.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"

	"talkofthetown/internal/sim"
)

// Config holds the spend caps (CLAUDE.md hard rule 5). Runs past them are refused.
type Config struct {
	MaxRounds int // rounds one request may simulate
	MaxBlobs  int // blobs one run may contain
}

// Default caps: a full run of the standard town.
const (
	DefaultMaxRounds = 50
	DefaultMaxBlobs  = 100
	maxBodyBytes     = 4 << 10 // {seed, 5 choices} is well under 1 KiB
)

// ConfigFromEnv reads MAX_ROUNDS and MAX_BLOBS, falling back to the defaults.
func ConfigFromEnv() (Config, error) {
	c := Config{MaxRounds: DefaultMaxRounds, MaxBlobs: DefaultMaxBlobs}
	for name, dst := range map[string]*int{"MAX_ROUNDS": &c.MaxRounds, "MAX_BLOBS": &c.MaxBlobs} {
		if v := os.Getenv(name); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 {
				return c, fmt.Errorf("%s must be a non-negative integer, got %q", name, v)
			}
			*dst = n
		}
	}
	return c, nil
}

// New returns the API handler. brain retells stories in /api/run. If static is
// non-nil it serves the built client at /.
func New(cfg Config, brain sim.Brain, static http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/town", handleTown)
	mux.HandleFunc("POST /api/run", func(w http.ResponseWriter, r *http.Request) { handleRun(w, r, cfg, brain) })
	if static != nil {
		mux.Handle("/", static)
	}
	return mux
}

// handleTown serves GET /api/town?seed=N, with N a base-10 integer in 0..sim.MaxSeed.
func handleTown(w http.ResponseWriter, r *http.Request) {
	seed, err := strconv.ParseUint(r.URL.Query().Get("seed"), 10, 64)
	if err != nil || seed > sim.MaxSeed {
		writeError(w, http.StatusBadRequest, "seed must be an integer from 0 to 2^53-1")
		return
	}
	writeJSON(w, http.StatusOK, sim.NewTown(sim.NewRNG(seed)))
}

type runRequest struct {
	Seed    *uint64  `json:"seed"`
	Choices []string `json:"choices"`
}

// handleRun serves POST /api/run. Stateless: the run is replayed from the seed.
func handleRun(w http.ResponseWriter, r *http.Request, cfg Config, brain sim.Brain) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	var req runRequest
	if err := dec.Decode(&req); err != nil || dec.Decode(&struct{}{}) != io.EOF {
		writeError(w, http.StatusBadRequest, "body must be {\"seed\": n, \"choices\": [option ids]}")
		return
	}
	if req.Seed == nil || *req.Seed > sim.MaxSeed {
		writeError(w, http.StatusBadRequest, "seed must be an integer from 0 to 2^53-1")
		return
	}
	// n choices simulate n*MomentEvery rounds (sim.Run checks n against the content).
	if rounds := min(len(req.Choices)*sim.MomentEvery, sim.RunRounds); rounds > cfg.MaxRounds || sim.TownSize > cfg.MaxBlobs {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("run exceeds server caps (%d rounds, %d blobs)", cfg.MaxRounds, cfg.MaxBlobs))
		return
	}
	log, err := sim.Run(*req.Seed, req.Choices, brain)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, log)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
