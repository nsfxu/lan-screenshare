//go:build darwin

package main

import (
	"fmt"
	"net/netip"
	"os/exec"
	"strconv"
	"strings"
)

func configureNetwork(o options, iface string) (func(), error) {
	var undo undoStack
	cleanup := func() { undo.run() }
	addr := o.Address.String()
	network := netip.PrefixFrom(o.Address, o.Prefix).Masked()
	if err := command("ifconfig", iface, "inet", addr, addr, "alias"); err != nil {
		return cleanup, err
	}
	if err := command("ifconfig", iface, "mtu", strconv.Itoa(o.MTU), "up"); err != nil {
		return cleanup, err
	}
	if err := command("route", "-q", "-n", "add", "-inet", network.String(), "-interface", iface); err != nil {
		return cleanup, fmt.Errorf("could not route the VPN network: %w", err)
	}
	if !o.Forward {
		return cleanup, nil
	}
	// The interface (and with it the route) vanishes when we exit; forwarding is system-wide, so put it back.
	out, err := exec.Command("/usr/sbin/sysctl", "-n", "net.inet.ip.forwarding").Output()
	if err == nil {
		previous := strings.TrimSpace(string(out))
		if command("sysctl", "-w", "net.inet.ip.forwarding=1") == nil {
			undo = append(undo, func() { _ = command("sysctl", "-w", "net.inet.ip.forwarding="+previous) })
		}
	}
	return cleanup, nil
}
