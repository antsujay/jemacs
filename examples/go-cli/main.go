// taskctl is a small JSON-backed task tracker for exercising editor workflows:
// multi-file navigation, compile errors, grep, and git.
package main

import (
	"fmt"
	"os"

	"github.com/example/taskctl/cmd"
	"github.com/example/taskctl/task"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "taskctl:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	store, err := task.Open(task.DefaultPath())
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	root := cmd.New(store)
	return root.Execute(args)
}
