//go:build !windows

package main

import "os/exec"

const systemPath = "/usr/sbin:/usr/bin:/sbin:/bin"

func hideWindow(*exec.Cmd) {}
