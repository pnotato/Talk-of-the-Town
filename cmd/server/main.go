// Command server serves /api, plus web/dist when it has been built.
package main

import (
	"log"
	"net/http"
	"os"

	"talkofthetown/internal/server"
)

func main() {
	var static http.Handler
	if _, err := os.Stat("web/dist"); err == nil {
		static = http.FileServer(http.Dir("web/dist"))
	}
	addr := ":8080"
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, server.New(static)))
}
