package journal

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const maxPiCacheBytes = 32 << 20

type piFileIndex struct {
	root    string
	matches map[string][]string
}

type piCacheEntry struct {
	path    string
	info    fs.FileInfo
	digest  [32]byte
	bytes   int
	tick    uint64
	session *piSession
}

type piSession struct {
	id        string
	path      string
	entries   map[string]piEntry
	order     []string
	branch    []piEntry
	branchSet map[string]bool
}

type piEntry struct {
	Type       string          `json:"type"`
	ID         string          `json:"id"`
	ParentID   *string         `json:"parentId"`
	Message    json.RawMessage `json:"message"`
	CustomType string          `json:"customType"`
	Content    json.RawMessage `json:"content"`
	Display    bool            `json:"display"`
}

type piHeader struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	ID      string `json:"id"`
}

type piMessage struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCallID string          `json:"toolCallId"`
	ToolName   string          `json:"toolName"`
	IsError    bool            `json:"isError"`
}

type piBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	Thinking  string          `json:"thinking"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func piPathSyntax(root, value string) bool {
	if !filepath.IsAbs(value) || filepath.Ext(value) != ".jsonl" {
		return false
	}
	absRoot, err := filepath.Abs(filepath.Join(root, "sessions"))
	if err != nil {
		return false
	}
	absValue, err := filepath.Abs(value)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absValue)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (r *Reader) findPiTranscript(ref Ref, refresh bool) (string, error) {
	rootPath, err := filepath.Abs(filepath.Join(r.PiRoot, "sessions"))
	if err != nil {
		return "", ErrUnavailable
	}
	root, err := filepath.EvalSymlinks(rootPath)
	if err != nil {
		return "", ErrUnavailable
	}
	if ref.Kind == "path" {
		if !piPathSyntax(r.PiRoot, ref.Value) {
			return "", ErrUnavailable
		}
		absolute, err := filepath.Abs(ref.Value)
		if err != nil {
			return "", ErrUnavailable
		}
		lexicalRel, err := filepath.Rel(rootPath, absolute)
		if err != nil || lexicalRel == "." || lexicalRel == ".." || strings.HasPrefix(lexicalRel, ".."+string(filepath.Separator)) {
			return "", ErrUnavailable
		}
		expected := filepath.Join(root, lexicalRel)
		path, err := filepath.EvalSymlinks(absolute)
		if err != nil || path != expected {
			return "", ErrUnavailable
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", ErrUnavailable
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return "", ErrUnavailable
		}
		return path, nil
	}
	if ref.Kind != "id" || !sessionID.MatchString(ref.Value) {
		return "", ErrUnavailable
	}
	r.indexMu.Lock()
	defer r.indexMu.Unlock()
	if refresh || r.piIndex.root != root || r.piIndex.matches == nil {
		matches := map[string][]string{}
		count := 0
		err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			count++
			if count > maxWalkEntries {
				return ErrUnavailable
			}
			if entry.Type()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.IsDir() || filepath.Ext(path) != ".jsonl" {
				return nil
			}
			header, e := readPiHeader(path)
			if e == nil {
				matches[header.ID] = append(matches[header.ID], path)
			}
			return nil
		})
		if err != nil {
			return "", ErrUnavailable
		}
		r.piIndex = piFileIndex{root: root, matches: matches}
	}
	paths := r.piIndex.matches[ref.Value]
	if len(paths) != 1 {
		return "", ErrUnavailable
	}
	return paths[0], nil
}

func readPiHeader(path string) (piHeader, error) {
	file, err := os.Open(path)
	if err != nil {
		return piHeader{}, err
	}
	defer file.Close()
	s := bufio.NewScanner(file)
	s.Buffer(make([]byte, 4096), maxTranscriptLine)
	if !s.Scan() {
		return piHeader{}, ErrUnavailable
	}
	var h piHeader
	if json.Unmarshal(s.Bytes(), &h) != nil || h.Type != "session" || (h.Version != 2 && h.Version != 3) || !sessionID.MatchString(h.ID) {
		return piHeader{}, ErrUnavailable
	}
	return h, nil
}

func (r *Reader) loadPiSession(ref Ref, refresh bool) (*piSession, error) {
	path, err := r.findPiTranscript(ref, refresh)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxScanBytes {
		return nil, ErrUnavailable
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) > maxScanBytes {
		return nil, ErrUnavailable
	}
	// A writer may be between bytes. Only newline-committed records participate.
	if cut := bytes.LastIndexByte(data, '\n'); cut >= 0 {
		data = data[:cut+1]
	} else {
		return nil, ErrUnavailable
	}
	digest := sha256.Sum256(data)
	r.piMu.Lock()
	for i := range r.piCache {
		entry := &r.piCache[i]
		if entry.path == path && os.SameFile(entry.info, info) && entry.info.Size() == info.Size() && entry.info.ModTime() == info.ModTime() && entry.digest == digest {
			r.piCacheTick++
			entry.tick = r.piCacheTick
			session := entry.session
			r.piMu.Unlock()
			return session, nil
		}
	}
	r.piMu.Unlock()
	session, err := parsePiSession(path, data, ref)
	if err != nil {
		return nil, err
	}
	r.piMu.Lock()
	defer r.piMu.Unlock()
	r.piCacheTick++
	kept := r.piCache[:0]
	total := len(data)
	for _, entry := range r.piCache {
		if entry.path != path {
			kept = append(kept, entry)
			total += entry.bytes
		}
	}
	r.piCache = kept
	for len(r.piCache) >= 32 || (total > maxPiCacheBytes && len(r.piCache) > 0) {
		oldest := 0
		for i := range r.piCache {
			if r.piCache[i].tick < r.piCache[oldest].tick {
				oldest = i
			}
		}
		total -= r.piCache[oldest].bytes
		r.piCache = append(r.piCache[:oldest], r.piCache[oldest+1:]...)
	}
	if len(data) <= maxPiCacheBytes {
		r.piCache = append(r.piCache, piCacheEntry{path: path, info: info, digest: digest, bytes: len(data), tick: r.piCacheTick, session: session})
	}
	return session, nil
}

func parsePiSession(path string, data []byte, ref Ref) (*piSession, error) {
	lines := bytes.Split(bytes.TrimSuffix(data, []byte{'\n'}), []byte{'\n'})
	if len(lines) == 0 || len(lines) > maxWalkEntries+1 {
		return nil, ErrUnavailable
	}
	var header piHeader
	if json.Unmarshal(lines[0], &header) != nil || header.Type != "session" || (header.Version != 2 && header.Version != 3) || !sessionID.MatchString(header.ID) {
		return nil, ErrUnavailable
	}
	if ref.Kind == "id" && header.ID != ref.Value {
		return nil, ErrUnavailable
	}
	s := &piSession{id: header.ID, path: path, entries: map[string]piEntry{}, branchSet: map[string]bool{}}
	for _, line := range lines[1:] {
		var entry piEntry
		if len(line) > maxTranscriptLine || json.Unmarshal(line, &entry) != nil || entry.ID == "" {
			return nil, ErrUnavailable
		}
		if !sessionID.MatchString(entry.ID) {
			return nil, ErrUnavailable
		}
		if _, exists := s.entries[entry.ID]; exists {
			return nil, ErrUnavailable
		}
		s.entries[entry.ID] = entry
		s.order = append(s.order, entry.ID)
	}
	if len(s.order) == 0 {
		return s, nil
	}
	for _, origin := range s.order {
		seen := map[string]bool{}
		id := origin
		for id != "" {
			if seen[id] {
				return nil, ErrUnavailable
			}
			seen[id] = true
			entry, ok := s.entries[id]
			if !ok {
				return nil, ErrUnavailable
			}
			if entry.ParentID == nil {
				break
			}
			id = *entry.ParentID
		}
	}
	seen := map[string]bool{}
	id := s.order[len(s.order)-1]
	for id != "" {
		if seen[id] {
			return nil, ErrUnavailable
		}
		seen[id] = true
		entry, ok := s.entries[id]
		if !ok {
			return nil, ErrUnavailable
		}
		s.branch = append(s.branch, entry)
		s.branchSet[id] = true
		if entry.ParentID == nil {
			break
		}
		id = *entry.ParentID
	}
	for i, j := 0, len(s.branch)-1; i < j; i, j = i+1, j-1 {
		s.branch[i], s.branch[j] = s.branch[j], s.branch[i]
	}
	return s, nil
}

func piText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var blocks []piBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, block := range blocks {
		if block.Type == "text" && block.Text != "" {
			parts = append(parts, block.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func piEvents(session *piSession) []parsedEvent {
	var out []parsedEvent
	tools := map[string]int{}
	for ordinal, entry := range session.branch {
		switch entry.Type {
		case "custom_message":
			if text := piText(entry.Content); entry.Display && text != "" {
				out = append(out, parsedEvent{Event: Event{Type: "assistant", Text: "[Extension] " + text}, lineStart: ordinal})
			}
		case "message":
			var msg piMessage
			if json.Unmarshal(entry.Message, &msg) != nil {
				continue
			}
			switch msg.Role {
			case "user":
				if text := piText(msg.Content); text != "" {
					out = append(out, parsedEvent{Event: Event{Type: "user", Text: text}, lineStart: ordinal})
				}
			case "assistant":
				var blocks []piBlock
				if json.Unmarshal(msg.Content, &blocks) != nil {
					continue
				}
				for _, block := range blocks {
					switch block.Type {
					case "text":
						if block.Text != "" {
							out = append(out, parsedEvent{Event: Event{Type: "assistant", Text: block.Text}, lineStart: ordinal})
						}
					case "thinking":
						if block.Thinking != "" {
							out = append(out, parsedEvent{Event: Event{Type: "thinking", Text: block.Thinking}, lineStart: ordinal})
						}
					case "toolCall":
						if toolName.MatchString(block.Name) && block.ID != "" {
							out = append(out, parsedEvent{Event: Event{Type: "tool", Name: block.Name, Input: compactJSON(block.Arguments)}, call: block.ID, lineStart: ordinal})
							tools[block.ID] = len(out) - 1
						}
					}
				}
			case "toolResult":
				if index, ok := tools[msg.ToolCallID]; ok {
					out[index].Output = piText(msg.Content)
					if msg.IsError {
						out[index].State = "error"
					} else {
						out[index].State = "done"
					}
				}
			}
		}
	}
	return out
}

func encodePiCursor(ref Ref, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte("p1:" + refFingerprint(ref) + ":" + id))
}
func decodePiCursor(ref Ref, raw *string) (string, error) {
	if raw == nil {
		return "", nil
	}
	data, err := base64.RawURLEncoding.DecodeString(*raw)
	if err != nil {
		return "", ErrCursorInvalid
	}
	parts := strings.Split(string(data), ":")
	if len(parts) != 3 || parts[0] != "p1" || parts[1] != refFingerprint(ref) || parts[2] == "" {
		return "", ErrCursorConflict
	}
	return parts[2], nil
}

func (r *Reader) readPiHistory(ref Ref, cursor *string, limit int) (Page, error) {
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 200 {
		return Page{}, errors.New("invalid history limit")
	}
	s, err := r.loadPiSession(ref, true)
	if err != nil {
		return Page{}, err
	}
	end, err := piBoundary(s, ref, cursor)
	if err != nil {
		return Page{}, err
	}
	type indexedMessage struct {
		message     Message
		branchIndex int
	}
	var all []indexedMessage
	for branchIndex, entry := range s.branch[:end] {
		if entry.Type == "custom_message" && entry.Display {
			if text := piText(entry.Content); text != "" {
				all = append(all, indexedMessage{Message{Role: "assistant", Text: "[Extension] " + text}, branchIndex})
			}
			continue
		}
		if entry.Type != "message" {
			continue
		}
		var msg piMessage
		if json.Unmarshal(entry.Message, &msg) != nil {
			continue
		}
		if msg.Role == "user" || msg.Role == "assistant" {
			if text := piText(msg.Content); text != "" {
				all = append(all, indexedMessage{Message{Role: msg.Role, Text: text}, branchIndex})
			}
		}
	}
	start := len(all)
	pageBytes := 0
	for start > 0 && len(all)-start < limit {
		candidate := all[start-1].message
		candidate.Text, _ = clip(candidate.Text, maxMessageBytes, false)
		encoded, _ := json.Marshal(candidate)
		if pageBytes+len(encoded) > maxPageItemsBytes {
			break
		}
		all[start-1].message = candidate
		pageBytes += len(encoded)
		start--
	}
	page := Page{Messages: make([]Message, 0, len(all)-start), Truncated: start > 0 && pageBytes == 0}
	for _, item := range all[start:] {
		page.Messages = append(page.Messages, item.message)
	}
	if start > 0 {
		previous := all[start].branchIndex - 1
		if previous >= 0 {
			next := encodePiCursor(ref, s.branch[previous].ID)
			page.NextCursor = &next
		}
	}
	return page, nil
}

func piBoundary(s *piSession, ref Ref, cursor *string) (int, error) {
	id, err := decodePiCursor(ref, cursor)
	if err != nil {
		return 0, err
	}
	if id == "" {
		return len(s.branch), nil
	}
	for i, e := range s.branch {
		if e.ID == id {
			return i + 1, nil
		}
	}
	return 0, ErrCursorConflict
}

func (r *Reader) readPiTrace(ref Ref, cursor *string, limit int) (TracePage, error) {
	s, err := r.loadPiSession(ref, true)
	if err != nil {
		return TracePage{}, err
	}
	end, err := piBoundary(s, ref, cursor)
	if err != nil {
		return TracePage{}, err
	}
	clone := *s
	clone.branch = s.branch[:end]
	events := piEvents(&clone)
	start := len(events)
	pageBytes := 0
	for start > 0 && len(events)-start < limit {
		candidate, _ := clipEvent(events[start-1].Event, false)
		size := eventSize(candidate)
		if pageBytes+size > maxTraceItemsBytes {
			break
		}
		events[start-1].Event = candidate
		pageBytes += size
		start--
	}
	for start > 0 && start < len(events) && events[start-1].lineStart == events[start].lineStart {
		start++
	}
	page := TracePage{Truncated: start > 0 && pageBytes == 0}
	for _, parsed := range events[start:] {
		ev, _ := clipEvent(parsed.Event, false)
		if ev.Type == "tool" {
			ev.DetailRef = encodePiDetail(ref, clone.branch[parsed.lineStart].ID, parsed.call, parsed.Name, traceDetailStatic(parsed)+"."+traceDetailRevision(parsed.Event))
		}
		page.Items = append(page.Items, ev)
	}
	if start > 0 {
		previous := events[start].lineStart - 1
		if previous >= 0 {
			next := encodePiCursor(ref, clone.branch[previous].ID)
			page.NextCursor = &next
		}
	}
	return page, nil
}

func encodePiDetail(ref Ref, entry, call, name, static string) string {
	return base64.RawURLEncoding.EncodeToString([]byte("pd1:" + refFingerprint(ref) + ":" + entry + ":" + call + ":" + name + ":" + static))
}
func (r *Reader) readPiTraceDetail(ref Ref, detail string) (TraceDetail, error) {
	raw, err := base64.RawURLEncoding.DecodeString(detail)
	if err != nil {
		return TraceDetail{}, ErrCursorInvalid
	}
	parts := strings.Split(string(raw), ":")
	if len(parts) != 6 || parts[0] != "pd1" || parts[1] != refFingerprint(ref) {
		return TraceDetail{}, ErrCursorConflict
	}
	s, err := r.loadPiSession(ref, true)
	if err != nil {
		return TraceDetail{}, err
	}
	if !s.branchSet[parts[2]] {
		return TraceDetail{}, ErrCursorConflict
	}
	for _, ev := range piEvents(s) {
		if ev.call == parts[3] && ev.Name == parts[4] && traceDetailStatic(ev)+"."+traceDetailRevision(ev.Event) == parts[5] && s.branch[ev.lineStart].ID == parts[2] {
			item, truncated := clipEvent(ev.Event, false)
			return TraceDetail{DetailRef: detail, Text: item.Text, Input: item.Input, Output: item.Output, Truncated: truncated}, nil
		}
	}
	return TraceDetail{}, ErrCursorConflict
}
