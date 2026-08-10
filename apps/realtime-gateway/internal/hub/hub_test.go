package hub

import "testing"

func TestParseChannel(t *testing.T) {
	cases := []struct {
		channel  string
		wantKind string
		wantID   string
		wantOK   bool
	}{
		{"rt:driver:abc-123", "driver", "abc-123", true},
		{"rt:customer:xyz-789", "customer", "xyz-789", true},
		{"rt:driver:", "", "", false},   // empty id
		{"rt:customer:", "", "", false}, // empty id
		{"rt:unknown:abc", "", "", false},
		{"not-a-channel", "", "", false},
		{"", "", "", false},
	}

	for _, c := range cases {
		kind, id, ok := parseChannel(c.channel)
		if kind != c.wantKind || id != c.wantID || ok != c.wantOK {
			t.Errorf("parseChannel(%q) = (%q, %q, %v), want (%q, %q, %v)",
				c.channel, kind, id, ok, c.wantKind, c.wantID, c.wantOK)
		}
	}
}
