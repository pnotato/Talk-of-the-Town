// Package server holds the HTTP routes. Keep it thin; logic lives in sim.
package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"

	"talkofthetown/internal/sim"
)

// Config holds the spend caps (CLAUDE.md hard rule 5), which refuse runs past
// them, and where finished runs are written.
type Config struct {
	MaxRounds int    // rounds one request may simulate
	MaxBlobs  int    // blobs one run may contain
	RunsDir   string // write each finished run's log here; empty writes nothing
}

// Default caps: a full run of the standard town.
const (
	DefaultMaxRounds = 50
	DefaultMaxBlobs  = 100
	maxBodyBytes     = 4 << 10 // {seed, 5 choices} is well under 1 KiB
)

// ConfigFromEnv reads MAX_ROUNDS and MAX_BLOBS, falling back to the defaults,
// and RUNS_DIR, which is empty (write nothing) unless set.
func ConfigFromEnv() (Config, error) {
	c := Config{MaxRounds: DefaultMaxRounds, MaxBlobs: DefaultMaxBlobs, RunsDir: os.Getenv("RUNS_DIR")}
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
// A finished run is also written to cfg.RunsDir, as the same bytes.
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
	run, err := sim.Run(*req.Seed, req.Choices, brain)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	body, err := encodeJSON(run)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not encode the run")
		return
	}
	writeBody(w, http.StatusOK, body)
	if run.Next != nil || cfg.RunsDir == "" {
		return
	}
	// The client already has its answer; a failed write only costs the file.
	if path, err := WriteRun(cfg.RunsDir, run, body); err != nil {
		log.Printf("run log not written: %v", err)
	} else {
		log.Printf("wrote run log %s", path)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := encodeJSON(v)
	if err != nil {
		http.Error(w, "could not encode the response", http.StatusInternalServerError)
		return
	}
	writeBody(w, status, body)
}

// encodeJSON is v as JSON plus a newline, as json.Encoder writes it.
func encodeJSON(v any) ([]byte, error) {
	var b bytes.Buffer
	err := json.NewEncoder(&b).Encode(v)
	return b.Bytes(), err
}

func writeBody(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
