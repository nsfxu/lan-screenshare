//go:build windows

package main

import (
	"fmt"
	"net"
	"strconv"
	"time"
)

func configureNetwork(o options, iface string) (func(), error) {
	var undo undoStack
	cleanup := func() { undo.run() }
	mask := net.IP(net.CIDRMask(o.Prefix, 32)).String()
	if err := command("netsh", "interface", "ipv4", "set", "address", "name="+iface, "source=static", "addr="+o.Address.String(), "mask="+mask); err != nil {
		return cleanup, err
	}
	if err := command("netsh", "interface", "ipv4", "set", "subinterface", "name="+iface, "mtu="+strconv.Itoa(o.MTU), "store=active"); err != nil {
		return cleanup, err
	}
	if o.Forward {
		if err := command("netsh", "interface", "ipv4", "set", "interface", "name="+iface, "forwarding=enabled"); err != nil {
			return cleanup, fmt.Errorf("could not turn on forwarding: %w", err)
		}
	}
	// A new adapter starts as an "unidentified" public network, where the firewall refuses
	// the room's connections. Mark it private once Windows has classified it.
	go func() {
		script := "Set-NetConnectionProfile -InterfaceAlias '" + iface + "' -NetworkCategory Private -ErrorAction Stop"
		for i := 0; i < 30; i++ {
			if command("powershell", "-NoProfile", "-NonInteractive", "-Command", script) == nil {
				return
			}
			time.Sleep(time.Second)
		}
	}()
	return cleanup, nil
}
