//go:build !windows

package main

import (
	"net"
	"os"
	"strconv"

	"golang.zx2c4.com/wireguard/ipc"
)

// listenControl serves WireGuard's control protocol on /var/run/wireguard/<iface>.sock
// and hands the socket to the user, so the app needs no rights of its own to use it.
func listenControl(iface, owner string) (net.Listener, string, error) {
	file, err := ipc.UAPIOpen(iface)
	if err != nil {
		return nil, "", err
	}
	listener, err := ipc.UAPIListen(iface, file)
	if err != nil {
		return nil, "", err
	}
	socket := "/var/run/wireguard/" + iface + ".sock"
	uid, err := strconv.Atoi(owner)
	if err != nil {
		listener.Close()
		return nil, "", err
	}
	if err := os.Chown(socket, uid, -1); err != nil {
		listener.Close()
		return nil, "", err
	}
	return listener, socket, nil
}
