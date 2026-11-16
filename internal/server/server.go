// Package server holds the HTTP routes. Keep it thin; logic lives in sim.
package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"talkofthetown/internal/sim"
)

// New returns the API handler. If static is non-nil it serves the built client at /.
func New(static http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/town", handleTown)
	if static != nil {
		mux.Handle("/", static)
	}
	return mux
}

// handleTown serves GET /api/town?seed=N. N is a base-10 uint64 (0 to 2^64-1).
func handleTown(w http.ResponseWriter, r *http.Request) {
	seed, err := strconv.ParseUint(r.URL.Query().Get("seed"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "seed must be an unsigned 64-bit integer"})
		return
	}
	writeJSON(w, http.StatusOK, sim.NewTown(sim.NewRNG(seed)))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
