package main

import (
	"log"
	"os"
	"path/filepath"

	"cloudnative/backend/internal/httpapi"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)

	fixturePath := os.Getenv("FIXTURE_PATH")
	if fixturePath == "" {
		fixturePath = filepath.Join("data", "demo-fixtures.json")
	}

	addr := os.Getenv("API_ADDR")
	if addr == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "3000"
		}
		addr = "127.0.0.1:" + port
	}

	staticDir := os.Getenv("FRONTEND_STATIC_DIR")
	if staticDir == "" {
		staticDir = filepath.Join("..", "frontend", "public")
	}

	server, err := httpapi.NewServer(httpapi.Config{
		Addr:        addr,
		FixturePath: fixturePath,
		StaticDir:   staticDir,
		Logger:      logger,
	})
	if err != nil {
		logger.Fatalf("failed to initialize go backend: %v", err)
	}

	logger.Printf("go backend listening at http://%s", addr)
	if err := server.ListenAndServe(); err != nil {
		logger.Fatalf("go backend stopped: %v", err)
	}
}
