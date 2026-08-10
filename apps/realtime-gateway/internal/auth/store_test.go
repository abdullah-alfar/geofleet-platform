package auth

import "testing"

func TestSplitSanctumToken(t *testing.T) {
	cases := []struct {
		token         string
		wantID        int64
		wantPlaintext string
		wantOK        bool
	}{
		{"1|abcdef", 1, "abcdef", true},
		{"42|some-plaintext-token", 42, "some-plaintext-token", true},
		{"no-pipe-here", 0, "", false},
		{"abc|plaintext", 0, "", false}, // non-numeric id
		{"1|", 0, "", false},            // empty plaintext
		{"|plaintext", 0, "", false},    // empty id
		{"", 0, "", false},
	}

	for _, c := range cases {
		id, plaintext, ok := splitSanctumToken(c.token)
		if id != c.wantID || plaintext != c.wantPlaintext || ok != c.wantOK {
			t.Errorf("splitSanctumToken(%q) = (%d, %q, %v), want (%d, %q, %v)",
				c.token, id, plaintext, ok, c.wantID, c.wantPlaintext, c.wantOK)
		}
	}
}
