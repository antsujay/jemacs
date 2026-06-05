// Package cmd wires subcommands. Kept stdlib-only so the example compiles
// without module fetches.
package cmd

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/example/taskctl/task"
)

// Root dispatches to a named subcommand.
type Root struct {
	store *task.Store
	out   io.Writer
	subs  map[string]func(args []string) error
}

// New builds the command tree over a store.
func New(store *task.Store) *Root {
	r := &Root{store: store, out: os.Stdout}
	r.subs = map[string]func(args []string) error{
		"add":  r.add,
		"ls":   r.ls,
		"done": r.done,
	}
	return r
}

// Execute runs the subcommand named by args[0].
func (r *Root) Execute(args []string) error {
	if len(args) == 0 {
		return r.usage()
	}
	fn, ok := r.subs[args[0]]
	if !ok {
		return fmt.Errorf("unknown command %q", args[0])
	}
	if err := fn(args[1:]); err != nil {
		return err
	}
	return r.store.Flush()
}

func (r *Root) usage() error {
	fmt.Fprintln(r.out, "usage: taskctl <add|ls|done> [flags]")
	return nil
}

func (r *Root) add(args []string) error {
	fs := flag.NewFlagSet("add", flag.ContinueOnError)
	prio := fs.String("p", "med", "priority: high|med|low")
	tags := fs.String("tags", "", "comma-separated tags")
	if err := fs.Parse(args); err != nil {
		return err
	}
	title := strings.Join(fs.Args(), " ")
	if title == "" {
		return fmt.Errorf("add: title required")
	}
	p, err := task.ParsePriority(*prio)
	if err != nil {
		return err
	}
	var tagList []string
	if *tags != "" {
		tagList = strings.Split(*tags, ",")
	}
	id := r.store.Add(title, p, tagList)
	fmt.Fprintf(r.out, "added #%d\n", id)
	return nil
}

func (r *Root) ls(args []string) error {
	fs := flag.NewFlagSet("ls", flag.ContinueOnError)
	all := fs.Bool("a", false, "include done")
	tag := fs.String("tag", "", "filter by tag")
	if err := fs.Parse(args); err != nil {
		return err
	}
	f := task.Filter{HideDone: !*all, Tag: *tag}
	tw := tabwriter.NewWriter(r.out, 0, 0, 2, ' ', 0)
	for _, t := range f.Apply(r.store.All()) {
		mark := " "
		if t.Done {
			mark = "x"
		}
		fmt.Fprintf(tw, "[%s]\t#%d\t%s\t%s\t%s\n",
			mark, t.ID, t.Priority, strings.Join(t.Tags, ","), t.Title)
	}
	return tw.Flush()
}

func (r *Root) done(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("done: need exactly one task id")
	}
	id, err := strconv.Atoi(args[0])
	if err != nil {
		return fmt.Errorf("done: %w", err)
	}
	if !r.store.Complete(id) {
		return fmt.Errorf("done: no task #%d", id)
	}
	fmt.Fprintf(r.out, "completed #%d\n", id)
	return nil
}
