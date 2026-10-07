package main

import (
	"fmt"
	"os/exec"
	"strings"
)

// command executes a system command with a fixed PATH (a privileged prompt gives a bare one).
func command(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Env = []string{"PATH=" + systemPath}
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// undoStack runs the steps that undo what configureNetwork did, last first.
type undoStack []func()

func (u undoStack) run() {
	for i := len(u) - 1; i >= 0; i-- {
		u[i]()
	}
}
