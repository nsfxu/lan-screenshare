package main

import (
	"strings"
	"testing"
)

func good() []string {
	return []string{"--address", "10.77.5.1", "--owner", "501", "--parent", "42", "--alive", "/tmp/a", "--status", "/tmp/s"}
}

func TestParseOptionsAcceptsTheAppsArguments(t *testing.T) {
	o, err := parseOptions(append(good(), "--forward", "--prefix", "24", "--mtu", "1380", "--name", "ssvpn0"))
	if err != nil {
		t.Fatal(err)
	}
	if o.Address.String() != "10.77.5.1" || o.Prefix != 24 || o.MTU != 1380 || !o.Forward || o.Parent != 42 {
		t.Fatalf("unexpected %+v", o)
	}
}

func TestParseOptionsAcceptsAWindowsSID(t *testing.T) {
	args := append(good(), "--owner", "S-1-5-21-1004336348-1177238915-682003330-512")
	if _, err := parseOptions(args); err != nil {
		t.Fatal(err)
	}
}

func TestParseOptionsRefusesAnythingElse(t *testing.T) {
	bad := map[string][]string{
		"address with a command": {"--address", "10.77.5.1; reboot"},
		"ipv6":                   {"--address", "fe80::1"},
		"no address":             {"--address", ""},
		"name with a space":      {"--name", "a b"},
		"long name":              {"--name", "abcdefghijklmnop"},
		"tiny prefix":            {"--prefix", "2"},
		"huge mtu":               {"--mtu", "9000"},
		"owner is a path":        {"--owner", "../etc"},
		"no parent":              {"--parent", "0"},
		"relative alive":         {"--alive", "alive"},
		"relative status":        {"--status", "status.json"},
		"unknown flag":           {"--exec", "x"},
	}
	for name, extra := range bad {
		if _, err := parseOptions(append(good(), extra...)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestControlSDDLNamesNoOwner(t *testing.T) {
	sddl := controlSDDL("S-1-5-21-1004336348-1177238915-682003330-1001")
	if strings.Contains(sddl, "O:") {
		t.Fatalf("an owner in the SDDL makes Windows refuse the pipe for an administrator: %s", sddl)
	}
	for _, want := range []string{"D:P", "(A;;GA;;;SY)", "(A;;GA;;;BA)", "(A;;GA;;;S-1-5-21-1004336348-1177238915-682003330-1001)"} {
		if !strings.Contains(sddl, want) {
			t.Errorf("missing %s in %s", want, sddl)
		}
	}
}
