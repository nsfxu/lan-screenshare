package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net/netip"
	"path/filepath"
	"regexp"
)

type options struct {
	Name    string
	Address netip.Addr
	Prefix  int
	MTU     int
	// Owner is who gets the control socket: a user id on macOS and Linux, a SID on Windows.
	Owner   string
	Parent  int
	Alive   string
	Status  string
	Forward bool
}

var (
	namePattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,15}$`)
	ownerPattern = regexp.MustCompile(`^([0-9]{1,10}|S-1-[0-9]+(-[0-9]+){1,15})$`)
)

// parseOptions reads and validates the command line. Everything here is later
// handed to system commands that run with administrator rights, so it is strict.
func parseOptions(args []string) (options, error) {
	var o options
	var address string
	fs := flag.NewFlagSet("up", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&o.Name, "name", "ssvpn0", "interface name")
	fs.StringVar(&address, "address", "", "this computer's address in the VPN")
	fs.IntVar(&o.Prefix, "prefix", 24, "network prefix length")
	fs.IntVar(&o.MTU, "mtu", 1380, "interface MTU")
	fs.StringVar(&o.Owner, "owner", "", "who may use the control socket")
	fs.IntVar(&o.Parent, "parent", 0, "process id of the app")
	fs.StringVar(&o.Alive, "alive", "", "the tunnel goes away when this file is deleted")
	fs.StringVar(&o.Status, "status", "", "file to report the result in")
	fs.BoolVar(&o.Forward, "forward", false, "forward packets between peers")
	if err := fs.Parse(args); err != nil {
		return o, err
	}

	addr, err := netip.ParseAddr(address)
	if err != nil || !addr.Is4() {
		return o, fmt.Errorf("bad --address %q", address)
	}
	o.Address = addr
	switch {
	case !namePattern.MatchString(o.Name):
		return o, errors.New("bad --name")
	case o.Prefix < 8 || o.Prefix > 30:
		return o, errors.New("bad --prefix")
	case o.MTU < 576 || o.MTU > 1500:
		return o, errors.New("bad --mtu")
	case !ownerPattern.MatchString(o.Owner):
		return o, errors.New("bad --owner")
	case o.Parent <= 0:
		return o, errors.New("bad --parent")
	case !filepath.IsAbs(o.Alive) || !filepath.IsAbs(o.Status):
		return o, errors.New("--alive and --status must be absolute paths")
	}
	return o, nil
}
