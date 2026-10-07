//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

var systemPath = os.Getenv("SystemRoot") + `\System32;` + os.Getenv("SystemRoot") + `\System32\WindowsPowerShell\v1.0`

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
