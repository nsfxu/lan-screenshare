//go:build linux

package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// configureNetwork gives the interface its address and, on the host, turns on
// forwarding between peers (but only between peers: the guests must not reach the host's other networks).
func configureNetwork(o options, iface string) (func(), error) {
	var undo undoStack
	cleanup := func() { undo.run() }
	if err := command("ip", "address", "add", fmt.Sprintf("%s/%d", o.Address, o.Prefix), "dev", iface); err != nil {
		return cleanup, err
	}
	if err := command("ip", "link", "set", "mtu", strconv.Itoa(o.MTU), "up", "dev", iface); err != nil {
		return cleanup, err
	}
	if !o.Forward {
		return cleanup, nil
	}
	const forwardFile = "/proc/sys/net/ipv4/ip_forward"
	if prev, err := os.ReadFile(forwardFile); err == nil {
		previous := strings.TrimSpace(string(prev))
		if os.WriteFile(forwardFile, []byte("1"), 0o644) == nil {
			undo = append(undo, func() { _ = os.WriteFile(forwardFile, []byte(previous), 0o644) })
		}
	}
	// -I puts the rule first: the accept lands above the drop.
	for _, rule := range [][]string{
		{"-i", iface, "!", "-o", iface, "-j", "DROP"},
		{"-i", iface, "-o", iface, "-j", "ACCEPT"},
	} {
		rule := rule
		if command("iptables", append([]string{"-I", "FORWARD"}, rule...)...) == nil {
			undo = append(undo, func() { _ = command("iptables", append([]string{"-D", "FORWARD"}, rule...)...) })
		}
	}
	return cleanup, nil
}
