package journal

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// ParseRoots splits a PAIRFOB_*_ROOTS value into absolute, existing
// directories in the order written. An empty value holds no roots. name only
// labels the error.
func ParseRoots(name, value string) ([]string, error) {
	if value == "" {
		return nil, nil
	}
	var roots []string
	for _, entry := range filepath.SplitList(value) {
		if entry == "" || !filepath.IsAbs(entry) {
			return nil, fmt.Errorf("%s entries must be absolute directories", name)
		}
		info, err := os.Stat(entry)
		if err != nil || !info.IsDir() {
			return nil, fmt.Errorf("%s entry is not an existing directory", name)
		}
		roots = append(roots, entry)
	}
	return roots, nil
}

// transcriptRoot is one place a Claude or Codex transcript may live.
type transcriptRoot struct {
	root string // provider root, e.g. ~/.claude
	sub  string // directory below it that holds transcripts
}

func (t transcriptRoot) base() string { return filepath.Join(t.root, t.sub) }

// searchRoots lists the default root first, then the listed ones in order.
func (r *Reader) searchRoots(agent string) []transcriptRoot {
	var def string
	var extra []string
	sub := "sessions"
	if agent == "claude" {
		def, extra, sub = r.ClaudeRoot, r.ClaudeRoots, "projects"
	} else {
		def, extra = r.CodexRoot, r.CodexRoots
	}
	out := []transcriptRoot{{def, sub}}
	for _, root := range extra {
		out = append(out, transcriptRoot{root, sub})
	}
	return out
}

// findTranscript returns the first root's match. A root without the id is
// skipped; any other error ends the search so an id is never answered from a
// later root after an earlier one was unclear about it.
func (r *Reader) findTranscript(agent, id string, refreshMissing bool) (path, base string, err error) {
	for _, root := range r.searchRoots(agent) {
		path, err = r.findInRoot(agent, root, id, refreshMissing)
		if err == nil {
			return path, root.base(), nil
		}
		if !errors.Is(err, ErrUnavailable) && !errors.Is(err, fs.ErrNotExist) {
			return "", "", err
		}
	}
	return "", "", ErrUnavailable
}

func (r *Reader) findInRoot(agent string, root transcriptRoot, id string, refreshMissing bool) (string, error) {
	match := matchCodexTranscript
	if agent == "claude" {
		match = matchClaudeTranscript
	}
	r.indexMu.Lock()
	now := time.Now()
	if r.now != nil {
		now = r.now()
	}
	key := agent + "\x00" + root.root
	index := r.rootIndexes[key]
	rebuild := func() {
		walk := r.walkDir
		if walk == nil {
			walk = filepath.WalkDir
		}
		files, err := scanTranscriptFiles(root.base(), walk)
		index = &codexFileIndex{
			root: root.root, scannedAt: now, files: files, err: err,
			matches: make(map[string]codexMatch),
		}
		if r.rootIndexes == nil {
			r.rootIndexes = make(map[string]*codexFileIndex)
		}
		r.rootIndexes[key] = index
	}
	refreshed := false
	if index == nil || index.scannedAt.IsZero() || now.Sub(index.scannedAt) >= codexIndexTTL || (index.err != nil && now.Sub(index.scannedAt) >= codexNegativeTTL) {
		rebuild()
		refreshed = true
	}
	found, known := index.matches[id]
	if known && !refreshed && errors.Is(found.err, ErrUnavailable) && (refreshMissing || now.Sub(index.scannedAt) >= codexNegativeTTL) {
		rebuild()
		refreshed = true
		known = false
	}
	if !known {
		found = match(index.files, id, index.err)
		if !refreshed && errors.Is(found.err, ErrUnavailable) && (refreshMissing || now.Sub(index.scannedAt) >= codexNegativeTTL) {
			rebuild()
			found = match(index.files, id, index.err)
		}
		index.matches[id] = found
	}
	r.indexMu.Unlock()
	if found.err != nil {
		return "", found.err
	}
	return verifiedRegular(root.base(), found.path)
}
