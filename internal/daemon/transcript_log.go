package daemon

import (
	"log"

	"pairfob/internal/journal"
)

// logTranscriptUnavailable writes the one line that says why a request ended
// transcript_unavailable. The reason is from a closed list; the line holds no
// path, session id, pane id or transcript text.
func logTranscriptUnavailable(reason string, ref journal.Ref) {
	kind := "none"
	if ref.Kind == "id" || ref.Kind == "path" {
		kind = ref.Kind
	}
	log.Printf("pairfob: transcript unavailable reason=%s agent=%s kind=%s", reason, traceAgent(ref.Agent), kind)
}
