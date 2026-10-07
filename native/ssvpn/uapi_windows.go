//go:build windows

package main

import (
	"crypto/rand"
	"encoding/hex"
	"net"

	"golang.org/x/sys/windows"
	"golang.zx2c4.com/wireguard/ipc/namedpipe"
)

// listenControl serves WireGuard's control protocol on a named pipe that only
// SYSTEM, the administrators and the user who started the app (owner is a SID) can open.
func listenControl(iface, owner string) (net.Listener, string, error) {
	sd, err := windows.SecurityDescriptorFromString("O:SYD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;" + owner + ")")
	if err != nil {
		return nil, "", err
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return nil, "", err
	}
	path := `\\.\pipe\ssvpn-` + iface + "-" + hex.EncodeToString(random)
	listener, err := (&namedpipe.ListenConfig{SecurityDescriptor: sd}).Listen(path)
	if err != nil {
		return nil, "", err
	}
	return listener, path, nil
}
