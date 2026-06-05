package task

import (
	"path/filepath"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tasks.json")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id := s.Add("write tests", High, []string{"dev"})
	if id != 1 {
		t.Fatalf("first id = %d, want 1", id)
	}
	s.Add("ship it", Low, nil)
	if !s.Complete(1) {
		t.Fatal("complete(1) = false")
	}
	if err := s.Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}

	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	all := s2.All()
	if len(all) != 2 {
		t.Fatalf("len(all) = %d, want 2", len(all))
	}
	// Undone tasks sort first regardless of priority.
	if all[0].ID != 2 || all[1].ID != 1 {
		t.Fatalf("sort order = %d,%d; want 2,1", all[0].ID, all[1].ID)
	}
}

func TestFilter(t *testing.T) {
	tasks := []Task{
		{ID: 1, Title: "Fix bug", Priority: High, Tags: []string{"dev"}},
		{ID: 2, Title: "Buy milk", Priority: Low, Done: true},
		{ID: 3, Title: "Review PR", Priority: Medium, Tags: []string{"dev"}},
	}
	med := Medium
	got := Filter{Tag: "dev", MaxPrio: &med, HideDone: true}.Apply(tasks)
	if len(got) != 2 {
		t.Fatalf("got %d tasks, want 2", len(got))
	}
	got = Filter{TitleLike: "milk"}.Apply(tasks)
	if len(got) != 1 || got[0].ID != 2 {
		t.Fatalf("title filter failed: %+v", got)
	}
}
