package reliability

import "testing"

func TestBackoffFor(t *testing.T) {
	cases := []struct {
		attempt int
		want    int // index into BackoffSchedule
	}{
		{attempt: 0, want: 0}, // defensive clamp, shouldn't occur in practice
		{attempt: 1, want: 0},
		{attempt: 2, want: 1},
		{attempt: 3, want: 2},
		{attempt: 4, want: 2}, // clamps to the longest configured backoff
		{attempt: 100, want: 2},
	}

	for _, c := range cases {
		got := backoffFor(c.attempt)
		want := BackoffSchedule[c.want]
		if got != want {
			t.Errorf("backoffFor(%d) = %v, want %v", c.attempt, got, want)
		}
	}
}
