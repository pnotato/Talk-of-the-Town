// Command server serves /api, plus web/dist when it has been built.
package main

import (
	"log"
	"net/http"
	"os"

	"talkofthetown/internal/provider"
	"talkofthetown/internal/server"
	"talkofthetown/internal/sim"
)

func main() {
	var static http.Handler
	if _, err := os.Stat("web/dist"); err == nil {
		static = http.FileServer(http.Dir("web/dist"))
	}
	cfg, err := server.ConfigFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	newVoice, voice, err := provider.VoiceFromEnv(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("blobs speak with the %s", voice)
	if cfg.RunsDir != "" {
		// Always the stub brain and voice, so starting the server never spends.
		if path, err := server.WriteSampleRun(cfg.RunsDir, sim.StubBrain{}); err != nil {
			log.Printf("sample run not written: %v", err)
		} else {
			log.Printf("wrote sample run %s", path)
		}
	}
	addr := ":8080"
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, server.New(cfg, sim.StubBrain{}, newVoice, static)))
}
