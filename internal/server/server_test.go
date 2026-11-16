package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	New(nil).ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got, want := rec.Body.String(), "{\"status\":\"ok\"}\n"; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}

func getTown(t *testing.T, query string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	New(nil).ServeHTTP(rec, httptest.NewRequest("GET", "/api/town"+query, nil))
	return rec
}

func TestTownSameSeedSameBody(t *testing.T) {
	a, b := getTown(t, "?seed=42"), getTown(t, "?seed=42")
	if a.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", a.Code, a.Body)
	}
	if ct := a.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if a.Body.String() != b.Body.String() {
		t.Fatal("same seed gave different bodies")
	}
	if c := getTown(t, "?seed=43"); c.Body.String() == a.Body.String() {
		t.Fatal("different seeds gave the same body")
	}
}

func TestTownBadSeed(t *testing.T) {
	for _, q := range []string{"", "?seed=", "?seed=abc", "?seed=-1", "?seed=1.5", "?seed=18446744073709551616"} {
		t.Run(q, func(t *testing.T) {
			rec := getTown(t, q)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q", ct)
			}
			if !strings.Contains(rec.Body.String(), `"error"`) {
				t.Fatalf("body = %q, want JSON error", rec.Body)
			}
		})
	}
}
