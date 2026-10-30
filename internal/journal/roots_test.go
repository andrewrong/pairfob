package journal

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseRoots(t *testing.T) {
	sep := string(os.PathListSeparator)
	a, b := t.TempDir(), t.TempDir()
	file := filepath.Join(a, "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := ParseRoots("X_ROOTS", ""); err != nil || len(got) != 0 {
		t.Fatalf("empty: %v %v", got, err)
	}
	got, err := ParseRoots("X_ROOTS", a+sep+b)
	if err != nil || len(got) != 2 || got[0] != a || got[1] != b {
		t.Fatalf("two roots: %v %v", got, err)
	}
	for name, value := range map[string]string{
		"empty entry":    a + sep + sep + b,
		"relative":       "rel/dir",
		"regular file":   file,
		"missing":        filepath.Join(a, "missing"),
		"leading empty":  sep + a,
		"trailing empty": a + sep,
	} {
		if _, err := ParseRoots("X_ROOTS", value); err == nil || !strings.Contains(err.Error(), "X_ROOTS") {
			t.Errorf("%s: err=%v", name, err)
		}
	}
}

type rootsCase struct {
	agent  string
	source string
	sub    string
	file   func(id string) string
	set    func(r *Reader, def string, extra []string)
}

var rootsCases = []rootsCase{
	{"claude", "herdr:claude", "projects", func(id string) string { return filepath.Join("p", id+".jsonl") },
		func(r *Reader, def string, extra []string) { r.ClaudeRoot, r.ClaudeRoots = def, extra }},
	{"codex", "herdr:codex", "sessions", func(id string) string { return filepath.Join("p", "rollout-x-"+id+".jsonl") },
		func(r *Reader, def string, extra []string) { r.CodexRoot, r.CodexRoots = def, extra }},
}

func (c rootsCase) put(t *testing.T, root, id, text string) string {
	t.Helper()
	path := filepath.Join(root, c.sub, c.file(id))
	var line any = map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": text}}
	if c.agent == "codex" {
		line = map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "message", "role": "user", "content": []map[string]any{{"type": "input_text", "text": text}},
		}}
	}
	writeLines(t, path, line)
	return path
}

func (c rootsCase) ref(id string) Ref {
	return Ref{Source: c.source, Agent: c.agent, Kind: "id", Value: id}
}

func (c rootsCase) searchTest(t *testing.T) {
	def, one, two := t.TempDir(), t.TempDir(), t.TempDir()
	reader := &Reader{}
	c.set(reader, def, []string{one, two})

	c.put(t, two, "only_second_1", "second")
	page, err := reader.Read(c.ref("only_second_1"), nil, 20)
	if err != nil || len(page.Messages) != 1 || page.Messages[0].Text != "second" {
		t.Fatalf("second root: %+v %v", page, err)
	}

	c.put(t, def, "in_both_1234", "default")
	c.put(t, one, "in_both_1234", "listed")
	page, err = reader.Read(c.ref("in_both_1234"), nil, 20)
	if err != nil || len(page.Messages) != 1 || page.Messages[0].Text != "default" {
		t.Fatalf("first wins: %+v %v", page, err)
	}

	if _, err := reader.Read(c.ref("nowhere_1234"), nil, 20); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing id: %v", err)
	}
}

func TestClaudeTranscriptSearchesListedRoots(t *testing.T) { rootsCases[0].searchTest(t) }
func TestCodexTranscriptSearchesListedRoots(t *testing.T)  { rootsCases[1].searchTest(t) }

func TestListedRootKeepsTrustChecks(t *testing.T) {
	c := rootsCases[0]
	def, listed, other := t.TempDir(), t.TempDir(), t.TempDir()
	reader := &Reader{}
	c.set(reader, def, []string{listed})

	// symlinked file
	target := c.put(t, other, "link_file_123", "x")
	if err := os.MkdirAll(filepath.Join(listed, "projects", "p"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(listed, "projects", "p", "link_file_123.jsonl")); err != nil {
		t.Fatal(err)
	}
	// symlinked directory
	c.put(t, other, "link_dir_1234", "x")
	if err := os.Symlink(filepath.Join(other, "projects", "p"), filepath.Join(listed, "projects", "linkdir")); err != nil {
		t.Fatal(err)
	}
	// projects itself resolves outside: a regular file whose resolved path leaves the root
	outside := t.TempDir()
	c.put(t, outside, "outside_1234", "x")
	escaped := t.TempDir()
	if err := os.Symlink(filepath.Join(outside, "projects"), filepath.Join(escaped, "projects")); err != nil {
		t.Fatal(err)
	}
	c.set(reader, def, []string{listed, escaped})
	for _, id := range []string{"link_file_123", "link_dir_1234", "outside_1234"} {
		if _, err := reader.Read(c.ref(id), nil, 20); !errors.Is(err, ErrUnavailable) {
			t.Errorf("%s: err=%v", id, err)
		}
	}

	// ambiguity stops the search before the next root
	c.set(reader, def, []string{listed, other})
	writeLines(t, filepath.Join(listed, "projects", "a", "dup_id_12345.jsonl"), map[string]any{"type": "user"})
	writeLines(t, filepath.Join(listed, "projects", "b", "dup_id_12345.jsonl"), map[string]any{"type": "user"})
	c.put(t, other, "dup_id_12345", "later")
	_, err := reader.Read(c.ref("dup_id_12345"), nil, 20)
	if err == nil || !strings.Contains(err.Error(), "ambiguous transcript id") {
		t.Fatalf("ambiguous: %v", err)
	}
}
