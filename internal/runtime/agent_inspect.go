package runtime

import (
	"context"
	"encoding/json"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// Display metadata never participates in task lifecycle or notification decisions.
type WorkspaceWorktree struct {
	RepoName         string `json:"repo_name"`
	CheckoutPath     string `json:"checkout_path"`
	IsLinkedWorktree bool   `json:"is_linked_worktree"`
}

type AgentInspectQuery struct{ PaneID string }

func (AgentInspectQuery) runtimeQuery() {}

type AgentInspection struct {
	Status                 string          `json:"status"`
	ManifestSource         string          `json:"manifest_source,omitempty"`
	ManifestVersion        string          `json:"manifest_version,omitempty"`
	MatchedRule            string          `json:"matched_rule,omitempty"`
	FallbackReason         string          `json:"fallback_reason,omitempty"`
	SkippedReason          string          `json:"skipped_reason,omitempty"`
	ScreenDetectionSkipped bool            `json:"screen_detection_skipped"`
	Warning                string          `json:"warning,omitempty"`
	Rules                  []DetectionRule `json:"rules"`
}

func (AgentInspection) runtimeView() {}

type DetectionRule struct {
	ID      string `json:"id"`
	State   string `json:"state"`
	Matched bool   `json:"matched"`
}

var displayTokenKey = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

func displayText(value string) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, value)
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 256 {
		runes = runes[:256]
	}
	return string(runes)
}
func displayTokens(values map[string]string, states bool) map[string]string {
	keys := make([]string, 0, len(values))
	for k := range values {
		if displayTokenKey.MatchString(k) && (!states || validAgentStatus(k)) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	out := map[string]string{}
	for _, k := range keys {
		if len(out) == 32 {
			break
		}
		if v := displayText(values[k]); v != "" {
			out[k] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
func displayWorktree(value *WorkspaceWorktree) *WorkspaceWorktree {
	if value == nil {
		return nil
	}
	return &WorkspaceWorktree{RepoName: displayText(value.RepoName), CheckoutPath: displayText(value.CheckoutPath), IsLinkedWorktree: value.IsLinkedWorktree}
}
func supportsAgentInspect(version string) bool {
	p := stableHerdrVersion.FindStringSubmatch(version)
	if p == nil {
		return false
	}
	major, majorErr := strconv.Atoi(p[1])
	minor, minorErr := strconv.Atoi(p[2])
	patch, patchErr := strconv.Atoi(p[3])
	return majorErr == nil && minorErr == nil && patchErr == nil && (major > 0 || minor > 8 || minor == 8 && patch >= 2)
}

func (h *Herdr) inspectAgent(ctx context.Context, session SessionRef, query AgentInspectQuery) (View, error) {
	if !validResourceID.MatchString(query.PaneID) {
		return nil, invalidFault("agent.explain", "invalid pane id")
	}
	snapshot, err := h.snapshot(ctx, session)
	if err != nil {
		return nil, err
	}
	if !supportsAgentInspect(snapshot.HerdrVersion) {
		return nil, unsupported("agent.explain", "agent inspection requires Herdr 0.8.2 or newer")
	}
	raw, err := h.call(ctx, session, "agent.explain", map[string]any{"target": query.PaneID}, false)
	if err != nil {
		return nil, err
	}
	// Explicitly omit terminal previews, regex evidence, native session references,
	// process arguments and arbitrary upstream JSON from the phone-facing result.
	var wire struct {
		Type    string `json:"type"`
		Explain struct {
			State   string `json:"state"`
			Source  string `json:"manifest_source"`
			Version string `json:"manifest_version"`
			Matched *struct {
				ID string `json:"id"`
			} `json:"matched_rule"`
			Fallback      string          `json:"fallback_reason"`
			Skipped       string          `json:"skipped_update_reason"`
			ScreenReason  string          `json:"screen_detection_skip_reason"`
			ScreenSkipped bool            `json:"screen_detection_skipped"`
			Warning       string          `json:"warning"`
			Rules         []DetectionRule `json:"evaluated_rules"`
		} `json:"explain"`
	}
	if err = json.Unmarshal(raw, &wire); err != nil || wire.Type != "agent_explain" || !validAgentStatus(wire.Explain.State) {
		return nil, responseFault("agent.explain", "invalid agent explanation", err, false)
	}
	w := wire.Explain
	source := w.Source
	if strings.ContainsAny(source, "/\\") {
		source = filepath.Base(source)
	}
	out := AgentInspection{Status: w.State, ManifestSource: displayText(source), ManifestVersion: displayText(w.Version), FallbackReason: displayText(w.Fallback), SkippedReason: displayText(w.Skipped), ScreenDetectionSkipped: w.ScreenSkipped, Warning: displayText(w.Warning), Rules: []DetectionRule{}}
	if out.SkippedReason == "" {
		out.SkippedReason = displayText(w.ScreenReason)
	}
	if w.Matched != nil {
		out.MatchedRule = displayText(w.Matched.ID)
	}
	for _, rule := range w.Rules {
		if len(out.Rules) == 32 {
			break
		}
		if validAgentStatus(rule.State) {
			rule.ID = displayText(rule.ID)
			out.Rules = append(out.Rules, rule)
		}
	}
	return out, nil
}
