// ssvpn: the VPN helper of ScreenShare's VPN rooms.
//
// It runs with administrator rights, started by the app after the system's own
// permission prompt, and does only what needs them: create a WireGuard network
// interface (Wintun on Windows, utun on macOS, TUN on Linux), give it its address
// and route, and (on the host) turn on packet forwarding. It then serves
// WireGuard's control protocol on a socket (a named pipe on Windows) that only the
// user who started the app can open, so the app sets the keys and the peers
// itself, without ever asking for the password again and without a secret
// appearing on a command line or in a file.
//
// It stays until the app exits, or deletes the "alive" file; then it undoes
// everything. WireGuard itself is the same Go code as wireguard-go, linked in.
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"
)

// status is what the app reads from the status file to know the tunnel is up.
type status struct {
	Interface string `json:"interface,omitempty"`
	Socket    string `json:"socket,omitempty"`
	Error     string `json:"error,omitempty"`
}

func main() {
	if len(os.Args) < 2 || os.Args[1] != "up" {
		fmt.Fprintln(os.Stderr, "usage: ssvpn up --name N --address A --prefix P --owner O --parent PID --alive FILE --status FILE [--forward] [--mtu N]")
		os.Exit(2)
	}
	opts, err := parseOptions(os.Args[2:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if err := run(opts); err != nil {
		// A window opened by a permission prompt has nowhere to print: tell the app.
		_ = writeStatus(opts.Status, status{Error: err.Error()})
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(o options) error {
	name := o.Name
	if runtime.GOOS == "darwin" {
		name = "utun" // macOS picks a free utunN
	}
	tdev, err := tun.CreateTUN(name, o.MTU)
	if err != nil {
		return fmt.Errorf("could not create the network interface: %w", err)
	}
	iface, err := tdev.Name()
	if err != nil {
		_ = tdev.Close()
		return err
	}
	dev := device.NewDevice(tdev, conn.NewDefaultBind(), device.NewLogger(device.LogLevelError, "(ssvpn) "))
	defer dev.Close()

	undo, err := configureNetwork(o, iface)
	if undo != nil {
		defer undo()
	}
	if err != nil {
		return err
	}

	listener, socket, err := listenControl(iface, o.Owner)
	if err != nil {
		return fmt.Errorf("could not open the control socket: %w", err)
	}
	defer listener.Close()
	go serve(listener, dev)

	if err := dev.Up(); err != nil {
		return err
	}
	if err := writeStatus(o.Status, status{Interface: iface, Socket: socket}); err != nil {
		return err
	}
	waitUntilDone(o)
	return nil
}

func serve(listener net.Listener, dev *device.Device) {
	for {
		c, err := listener.Accept()
		if err != nil {
			return
		}
		go dev.IpcHandle(c)
	}
}

// waitUntilDone returns when the app is gone, the alive file was deleted, or we were told to stop.
func waitUntilDone(o options) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case <-tick.C:
			if !processAlive(o.Parent) {
				return
			}
			if _, err := os.Stat(o.Alive); err != nil {
				return
			}
		}
	}
}

// writeStatus publishes the status with a rename, never writing through a path the
// (unprivileged) user could have turned into a link to something of ours.
func writeStatus(path string, s status) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(path), fmt.Sprintf(".%s.%d", filepath.Base(path), os.Getpid()))
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
