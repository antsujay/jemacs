package task

import "strings"

// Filter narrows a task slice. Zero values mean "no constraint".
type Filter struct {
	Tag       string
	MaxPrio   *Priority
	HideDone  bool
	TitleLike string
}

// Apply returns the subset of tasks matching f, preserving order.
func (f Filter) Apply(tasks []Task) []Task {
	var out []Task
	for _, t := range tasks {
		if f.HideDone && t.Done {
			continue
		}
		if f.MaxPrio != nil && t.Priority > *f.MaxPrio {
			continue
		}
		if f.Tag != "" && !hasTag(t, f.Tag) {
			continue
		}
		if f.TitleLike != "" && !strings.Contains(strings.ToLower(t.Title), strings.ToLower(f.TitleLike)) {
			continue
		}
		out = append(out, t)
	}
	return out
}

// hasTag reports whether t carries the given tag.
func hasTag(t Task, tag string) bool {
	for _, x := range t.Tags {
		if x == tag {
			return true
		}
	}
	return false
}
