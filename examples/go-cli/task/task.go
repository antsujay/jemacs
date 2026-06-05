package task

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Priority orders tasks; lower sorts first.
type Priority int

const (
	High Priority = iota
	Medium
	Low
)

var priorityNames = map[Priority]string{High: "high", Medium: "med", Low: "low"}

func (p Priority) String() string {
	if s, ok := priorityNames[p]; ok {
		return s
	}
	return fmt.Sprintf("p%d", int(p))
}

// ParsePriority accepts high/med/low (case-insensitive).
func ParsePriority(s string) (Priority, error) {
	for p, name := range priorityNames {
		if name == s {
			return p, nil
		}
	}
	return Low, fmt.Errorf("unknown priority %q", s)
}

// Task is a single tracked item.
type Task struct {
	ID       int       `json:"id"`
	Title    string    `json:"title"`
	Done     bool      `json:"done"`
	Priority Priority  `json:"priority"`
	Tags     []string  `json:"tags,omitempty"`
	Created  time.Time `json:"created"`
}

// Store is an append-mostly task list backed by a JSON file.
type Store struct {
	path  string
	tasks []Task
	next  int
}

// DefaultPath returns ~/.taskctl/tasks.json, creating the directory.
func DefaultPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	dir := filepath.Join(home, ".taskctl")
	_ = os.MkdirAll(dir, 0o755)
	return filepath.Join(dir, "tasks.json")
}

// Open loads a store from disk, or returns an empty one if the file is absent.
func Open(path string) (*Store, error) {
	s := &Store{path: path, next: 1}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.tasks); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	for _, t := range s.tasks {
		if t.ID >= s.next {
			s.next = t.ID + 1
		}
	}
	return s, nil
}

// Add appends a task and returns its assigned ID.
func (s *Store) Add(title string, prio Priority, tags []string) int {
	t := Task{
		ID:       s.next,
		Title:    title,
		Priority: prio,
		Tags:     tags,
		Created:  time.Now().UTC(),
	}
	s.tasks = append(s.tasks, t)
	s.next++
	return t.ID
}

// Get returns the task with the given id, or nil.
func (s *Store) Get(id int) *Task {
	for i := range s.tasks {
		if s.tasks[i].ID == id {
			return &s.tasks[i]
		}
	}
	return nil
}

// Complete marks a task done. Returns false if not found.
func (s *Store) Complete(id int) bool {
	if t := s.Get(id); t != nil {
		t.Done = true
		return true
	}
	return false
}

// All returns tasks sorted by (done, priority, id).
func (s *Store) All() []Task {
	out := make([]Task, len(s.tasks))
	copy(out, s.tasks)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Done != out[j].Done {
			return !out[i].Done
		}
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Flush writes the store to disk atomically.
func (s *Store) Flush() error {
	b, err := json.MarshalIndent(s.tasks, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
