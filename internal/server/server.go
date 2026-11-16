// Package server holds the HTTP routes. Keep it thin; logic lives in sim.
package server

import (
	"encoding/json"
	"net/http"
)

// New returns the API handler. If static is non-nil it serves the built client at /.
func New(static http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	if static != nil {
		mux.Handle("/", static)
	}
	return mux
}
