package httpapi

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func (s *Server) tryServeStatic(w http.ResponseWriter, r *http.Request) bool {
	if s.staticDir == "" {
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
		return false
	}

	requestPath := path.Clean("/" + strings.TrimSpace(r.URL.Path))
	if requestPath == "/" {
		requestPath = "/index.html"
	}

	candidatePath, ok := safeStaticPath(s.staticDir, requestPath)
	if !ok {
		http.NotFound(w, r)
		return true
	}

	fileInfo, err := os.Stat(candidatePath)
	if err == nil && !fileInfo.IsDir() {
		http.ServeFile(w, r, candidatePath)
		return true
	}

	if path.Ext(requestPath) != "" {
		http.NotFound(w, r)
		return true
	}

	indexPath, ok := safeStaticPath(s.staticDir, "/index.html")
	if !ok {
		return false
	}
	if _, err := os.Stat(indexPath); err != nil {
		return false
	}

	http.ServeFile(w, r, indexPath)
	return true
}

func safeStaticPath(rootDir, requestPath string) (string, bool) {
	cleanRoot := filepath.Clean(rootDir)
	relativePath := strings.TrimPrefix(requestPath, "/")
	candidatePath := filepath.Join(cleanRoot, filepath.FromSlash(relativePath))

	rootPrefix := cleanRoot + string(os.PathSeparator)
	if candidatePath != cleanRoot && !strings.HasPrefix(candidatePath, rootPrefix) {
		return "", false
	}

	return candidatePath, true
}
