package sim

import (
	"fmt"
	"math"
	"slices"
	"testing"

	"talkofthetown/internal/sim/nav"
)

// Synthetic walk graphs on the city's 1.8 hex spacing, so walker tests don't
// depend on the city map.
const (
	testSpacing = 1.8
	testLink    = testSpacing * 1.01 // join lattice neighbours despite rounding
	testStep    = 1.75               // corridor spacing, like nav's ChainStep
)

// mustTestGraph builds a graph and checks it the way the city graph is
// checked, so the planner's guarantees hold on it.
func mustTestGraph(t testing.TB, nodes []nav.Point, edges [][2]int) *nav.Graph {
	t.Helper()
	g, err := nav.FromEdges(nodes, make([]nav.Kind, len(nodes)), edges, nav.DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	if err := nav.CheckGraph(g, nav.DefaultParams()); err != nil {
		t.Fatal(err)
	}
	return g
}

// hexPlaza is a 14 x 12 hex plaza with two round holes: 154 nodes, two of
// them pocket corners that GoalOK rejects.
func hexPlaza(t testing.TB) *nav.Graph {
	t.Helper()
	rise := testSpacing * math.Sqrt(3) / 2
	holes := []nav.Point{{X: 7, Z: 6}, {X: 17, Z: 11}}
	const holeRadius = 2.5
	var nodes []nav.Point
	for r := range 12 {
		for c := range 14 {
			q := nav.Point{X: float64(c) * testSpacing, Z: float64(r) * rise}
			if r%2 == 1 {
				q.X += testSpacing / 2
			}
			if !slices.ContainsFunc(holes, func(h nav.Point) bool { return math.Hypot(q.X-h.X, q.Z-h.Z) < holeRadius }) {
				nodes = append(nodes, q)
			}
		}
	}
	var edges [][2]int
	for u := range nodes {
		for v := u + 1; v < len(nodes); v++ {
			if math.Hypot(nodes[u].X-nodes[v].X, nodes[u].Z-nodes[v].Z) <= testLink {
				edges = append(edges, [2]int{u, v})
			}
		}
	}
	return mustTestGraph(t, nodes, edges)
}

// ring is a 1-wide loop of n nodes; from any node, hops reach at most n/2.
func ring(t testing.TB, n int) *nav.Graph {
	t.Helper()
	r := testStep / (2 * math.Sin(math.Pi/float64(n)))
	nodes := make([]nav.Point, n)
	edges := make([][2]int, n)
	for i := range nodes {
		a := 2 * math.Pi * float64(i) / float64(n)
		nodes[i] = nav.Point{X: r * math.Cos(a), Z: r * math.Sin(a)}
		edges[i] = [2]int{i, (i + 1) % n}
	}
	return mustTestGraph(t, nodes, edges)
}

func mustWalker(t testing.TB, g *nav.Graph, n int, seed uint64) *walker {
	t.Helper()
	w, err := newWalker(g, n, NewMoveRNG(seed))
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func TestNewMoveRNG(t *testing.T) {
	a, b := NewMoveRNG(5), NewMoveRNG(5)
	for range 10 {
		if a.Uint64() != b.Uint64() {
			t.Fatal("same seed, different movement draws")
		}
	}
	// A separate stream: the movement source must not replay the social one.
	if NewMoveRNG(5).Uint64() == NewRNG(5).Uint64() {
		t.Fatal("NewMoveRNG gives the same first draw as NewRNG")
	}
}

func TestNewWalkerErrors(t *testing.T) {
	g := ring(t, 8)
	for _, n := range []int{-1, 9} {
		if _, err := newWalker(g, n, NewMoveRNG(1)); err == nil {
			t.Errorf("%d blobs on 8 goal nodes: no error", n)
		}
	}
	if _, err := newWalker(g, 0, NewMoveRNG(1)); err != nil {
		t.Errorf("0 blobs: %v", err)
	}
}

func TestSpawn(t *testing.T) {
	g := hexPlaza(t)
	for seed := range uint64(20) {
		w := mustWalker(t, g, 30, seed)
		seen := map[int]bool{}
		for i, v := range w.at {
			if !g.GoalOK(v) || seen[v] {
				t.Fatalf("seed %d: blob %d spawns on node %d (GoalOK %v, taken %v)", seed, i, v, g.GoalOK(v), seen[v])
			}
			seen[v] = true
			if w.goal[i] != v || w.dwell[i] != 0 {
				t.Fatalf("seed %d: blob %d spawns with goal %d dwell %d, want its own node and 0", seed, i, w.goal[i], w.dwell[i])
			}
		}
		ties := slices.Clone(w.tie)
		slices.Sort(ties)
		for k, x := range ties {
			if x != uint64(k) {
				t.Fatalf("seed %d: tiebreaks %v are not a permutation", seed, w.tie)
			}
		}
	}
}

// TestFirstTickDwells: every blob arrives at its spawn node on tick 0, so
// everyone starts dwelling and nobody moves.
func TestFirstTickDwells(t *testing.T) {
	w := mustWalker(t, hexPlaza(t), 30, 3)
	start := slices.Clone(w.at)
	w.tick()
	for i := range w.at {
		if w.at[i] != start[i] || w.dwell[i] < DwellMinTicks || w.dwell[i] > DwellMaxTicks {
			t.Fatalf("blob %d: at %d (spawn %d) dwell %d after tick 0", i, w.at[i], start[i], w.dwell[i])
		}
	}
}

// TestNewGoal checks the goal filter on an 8-node ring, where node 0 sees
// nodes 3, 5 at 3 hops and node 4 at 4 hops, and nothing else in the window.
func TestNewGoal(t *testing.T) {
	g := ring(t, 8)
	tests := []struct {
		name   string
		at     int   // blob 0's node
		others []int // the other blobs' nodes, which are also their goals
		want   []int // the goals it may pick
	}{
		{"all free", 0, []int{1, 2}, []int{3, 4, 5}},
		{"others' goals left out", 0, []int{3, 5}, []int{4}},
		{"none qualifies", 0, []int{3, 4, 5}, nil},
		{"measured from where it stands", 2, []int{0, 1}, []int{5, 6, 7}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for seed := range uint64(20) {
				w := mustWalker(t, g, 1+len(tt.others), seed)
				w.at[0], w.goal[0], w.dwell[0] = tt.at, tt.at, 0
				for k, v := range tt.others {
					w.at[k+1], w.goal[k+1] = v, v
				}
				w.since[0], w.still[0] = 7, 7
				ok := w.newGoal(0)
				if got := slices.Sorted(slices.Values(w.pick)); !slices.Equal(got, tt.want) {
					t.Fatalf("candidates %v, want %v", got, tt.want)
				}
				if ok != (tt.want != nil) || w.dwell[0] != 0 {
					t.Fatalf("newGoal = %v, dwell %d; want %v, 0", ok, w.dwell[0], tt.want != nil)
				}
				if tt.want == nil {
					if w.goal[0] != tt.at || w.since[0] != 7 || w.still[0] != 7 {
						t.Fatalf("goal %d since %d still %d changed with no candidate", w.goal[0], w.since[0], w.still[0])
					}
				} else if !slices.Contains(tt.want, w.goal[0]) || w.since[0] != 0 || w.still[0] != 0 {
					t.Fatalf("goal %d since %d still %d, want one of %v and 0, 0", w.goal[0], w.since[0], w.still[0], tt.want)
				}
			}
		})
	}
}

// TestStuckWalker checks MODEL.md#each-tick step 4 on an 8-node ring: a
// walker that has stood still StuckTicks ticks gets a new goal, and with it
// the lowest walker priority; one that hasn't, or has nowhere else to go,
// keeps its goal.
func TestStuckWalker(t *testing.T) {
	g := ring(t, 8)
	tests := []struct {
		name    string
		still   int
		others  []int // the other blobs' nodes and goals
		wantNew bool
	}{
		{"moving", 0, []int{1}, false},
		{"one tick short", StuckTicks - 1, []int{1}, false},
		{"stuck", StuckTicks, []int{1}, true},
		{"long stuck", StuckTicks + 5, []int{1}, true},
		{"stuck, nothing free", StuckTicks, []int{3, 4, 5}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Blob 0 stands on node 0 walking to node 2; goals 3-5 are in reach.
			w := mustWalker(t, g, 1+len(tt.others), 1)
			w.at[0], w.goal[0], w.since[0], w.still[0], w.dwell[0] = 0, 2, 30, tt.still, 0
			for k, v := range tt.others {
				w.at[k+1], w.goal[k+1], w.dwell[k+1] = v, v, 5
			}
			w.update()
			if w.dwell[0] != 0 {
				t.Fatalf("dwell %d, want still walking", w.dwell[0])
			}
			switch {
			case !tt.wantNew && (w.goal[0] != 2 || w.since[0] != 31 || w.still[0] != tt.still):
				t.Fatalf("goal %d since %d still %d, want 2, 31, %d", w.goal[0], w.since[0], w.still[0], tt.still)
			case tt.wantNew && (w.goal[0] < 3 || w.goal[0] > 5 || w.since[0] != 0 || w.still[0] != 0):
				t.Fatalf("goal %d since %d still %d, want 3-5, 0, 0", w.goal[0], w.since[0], w.still[0])
			}
			if want := uint64(w.since[0])<<tieBits | w.tie[0]; w.prio[0] != want {
				t.Fatalf("priority %#x, want %#x", w.prio[0], want)
			}
		})
	}
}

// TestNoGoalInReach: on a graph too small for WanderMinHops, every blob
// keeps dwelling and nobody moves.
func TestNoGoalInReach(t *testing.T) {
	w := mustWalker(t, ring(t, 5), 3, 1) // hops reach at most 2
	start := slices.Clone(w.at)
	for range 100 {
		w.tick()
		if !slices.Equal(w.at, start) || slices.Contains(w.dwell, 0) {
			t.Fatalf("at %v dwell %v, want everyone still dwelling at %v", w.at, w.dwell, start)
		}
	}
}

// walkStats watches a walker from outside, tick by tick.
type walkStats struct {
	arrivals []int // goals reached per blob, not counting the spawn
	minDwell int   // shortest and longest stay, arrival to new goal
	maxDwell int
	regoals  int // walkers that gave up a goal after standing still
}

// watch runs ticks ticks, checking every tick's rules, and returns the stats.
func watch(t *testing.T, w *walker, ticks int) walkStats {
	t.Helper()
	g, n := w.g, len(w.at)
	minSep := nav.DefaultParams().MinSep
	st := walkStats{arrivals: make([]int, n), minDwell: math.MaxInt}
	arrived := make([]int, n) // tick each blob last started dwelling
	for tick := range ticks {
		before, wasDwell, oldGoal := slices.Clone(w.at), slices.Clone(w.dwell), slices.Clone(w.goal)
		w.update()
		goals := map[int]int{}
		for i := range n {
			if o, ok := goals[w.goal[i]]; ok {
				t.Fatalf("tick %d: blobs %d and %d share goal %d", tick, o, i, w.goal[i])
			}
			goals[w.goal[i]] = i
			switch {
			case wasDwell[i] == 0 && w.dwell[i] > 0: // arrived
				if w.at[i] != w.goal[i] || w.dwell[i] < DwellMinTicks || w.dwell[i] > DwellMaxTicks {
					t.Fatalf("tick %d: blob %d starts dwelling %d ticks at %d, goal %d", tick, i, w.dwell[i], w.at[i], w.goal[i])
				}
				arrived[i] = tick
				if tick > 0 {
					st.arrivals[i]++
				}
			case w.goal[i] != oldGoal[i]: // a new goal
				h := g.Hops(w.at[i], w.goal[i])
				if !g.GoalOK(w.goal[i]) || h < WanderMinHops || h > WanderMaxHops {
					t.Fatalf("tick %d: blob %d picks goal %d, %d hops away (GoalOK %v)", tick, i, w.goal[i], h, g.GoalOK(w.goal[i]))
				}
				if wasDwell[i] == 0 {
					st.regoals++
					break
				}
				d := tick - arrived[i]
				st.minDwell, st.maxDwell = min(st.minDwell, d), max(st.maxDwell, d)
			}
			if want := w.tie[i]; w.dwell[i] == 0 {
				want |= uint64(w.since[i]) << tieBits
				if w.prio[i] != want {
					t.Fatalf("tick %d: walker %d has priority %#x, want %#x", tick, i, w.prio[i], want)
				}
			} else if w.prio[i] != want {
				t.Fatalf("tick %d: dweller %d has priority %#x, want its tiebreak %#x", tick, i, w.prio[i], want)
			}
		}
		w.move()
		checkTick(t, g, minSep, before, w.at, fmt.Sprintf("tick %d", tick))
	}
	return st
}

// checkTick recomputes the planner's guarantees from coordinates: every
// move is an edge or a stay, nobody shares a node, and every two blobs stay
// at least minSep apart all tick.
func checkTick(t *testing.T, g *nav.Graph, minSep float64, at, next []int, where string) {
	t.Helper()
	seen := make(map[int]int, len(next))
	for i, v := range next {
		if o, ok := seen[v]; ok {
			t.Fatalf("%s: blobs %d and %d both end on node %d", where, o, i, v)
		}
		seen[v] = i
		if h := g.Hops(at[i], v); h != 0 && h != 1 {
			t.Fatalf("%s: blob %d jumps %d -> %d (%d hops)", where, i, at[i], v, h)
		}
	}
	p := g.Nodes
	for i := range at {
		for j := i + 1; j < len(at); j++ {
			if d := nav.Swept(p[at[i]], p[next[i]], p[at[j]], p[next[j]]); d < minSep-1e-9 {
				t.Fatalf("%s: blobs %d (%d->%d) and %d (%d->%d) come %.4f apart", where, i, at[i], next[i], j, at[j], next[j], d)
			}
		}
	}
}

// Walker runs on the plaza: 30 blobs on 152 goal nodes is twice the city's
// density, over enough ticks for dozens of walks each.
const (
	plazaBlobs = 30
	plazaTicks = 2000
	plazaSeeds = 10
	// Unhindered, a walk is at most WanderMaxHops ticks plus a dwell of at
	// most DwellMaxTicks, so plazaTicks fits at least 62 goals. Over 40
	// seeds the fewest goals one blob reached was 110 on the plaza and 59
	// on the 1-wide ring. Below 30 means blobs are stuck, not just crowded.
	plazaMinGoals = 30
)

func TestWalkerRules(t *testing.T) {
	g := hexPlaza(t)
	for seed := range uint64(plazaSeeds) {
		st := watch(t, mustWalker(t, g, plazaBlobs, seed), plazaTicks)
		// The plaza always has a free goal in reach, so no dwell is extended.
		if st.minDwell < DwellMinTicks || st.maxDwell > DwellMaxTicks {
			t.Errorf("seed %d: dwells %d..%d ticks, want %d..%d", seed, st.minDwell, st.maxDwell, DwellMinTicks, DwellMaxTicks)
		}
		if m := slices.Min(st.arrivals); m < plazaMinGoals {
			t.Errorf("seed %d: a blob reached only %d goals in %d ticks, want >= %d", seed, m, plazaTicks, plazaMinGoals)
		}
	}
}

// TestWalkerRingLiveness: on a 1-wide loop nobody can overtake, so every
// walk depends on pushing dwellers round.
func TestWalkerRingLiveness(t *testing.T) {
	g := ring(t, 40)
	for seed := range uint64(plazaSeeds) {
		st := watch(t, mustWalker(t, g, 8, seed), plazaTicks)
		if m := slices.Min(st.arrivals); m < plazaMinGoals {
			t.Errorf("seed %d: a blob reached only %d goals in %d ticks, want >= %d", seed, m, plazaTicks, plazaMinGoals)
		}
	}
}

func TestWalkerDeterministic(t *testing.T) {
	g := hexPlaza(t)
	a, b := mustWalker(t, g, plazaBlobs, 9), mustWalker(t, g, plazaBlobs, 9)
	for r := range 20 {
		if pa, pb := a.round(TicksPerRound), b.round(TicksPerRound); !slices.EqualFunc(pa, pb, slices.Equal) {
			t.Fatalf("round %d: same seed, different paths", r)
		}
	}
	c := mustWalker(t, g, plazaBlobs, 10)
	if slices.Equal(c.at, mustWalker(t, g, plazaBlobs, 9).at) {
		t.Fatal("seeds 9 and 10 spawn identically")
	}
}

func TestWalkerRound(t *testing.T) {
	g := hexPlaza(t)
	w := mustWalker(t, g, plazaBlobs, 4)
	prev := slices.Clone(w.at)
	for r := range 5 {
		paths := w.round(TicksPerRound)
		if len(paths) != plazaBlobs {
			t.Fatalf("round %d: %d paths, want %d", r, len(paths), plazaBlobs)
		}
		for b, p := range paths {
			if len(p) != TicksPerRound+1 || p[0] != prev[b] || p[TicksPerRound] != w.at[b] {
				t.Fatalf("round %d blob %d: path %v, want %d entries from %d to %d", r, b, p, TicksPerRound+1, prev[b], w.at[b])
			}
		}
		for k := range TicksPerRound {
			at, next := make([]int, plazaBlobs), make([]int, plazaBlobs)
			for b, p := range paths {
				at[b], next[b] = p[k], p[k+1]
			}
			checkTick(t, g, nav.DefaultParams().MinSep, at, next, fmt.Sprintf("round %d tick %d", r, k))
		}
		prev = slices.Clone(w.at)
	}
}

func TestWalkerTickNoAllocs(t *testing.T) {
	w := mustWalker(t, hexPlaza(t), plazaBlobs, 2)
	for range 50 {
		w.tick()
	}
	if a := testing.AllocsPerRun(200, w.tick); a != 0 {
		t.Fatalf("tick allocates %v times, want 0", a)
	}
}

func TestNewWalkMap(t *testing.T) {
	g := mustTestGraph(t, []nav.Point{{X: 0.12345, Z: -0.0004}, {X: 1.8, Z: 0}, {X: 0.9, Z: 1.5588457}},
		[][2]int{{0, 1}, {1, 2}, {0, 2}})
	m := newWalkMap(g)
	want := [][2]float64{{0.123, 0}, {1.8, 0}, {0.9, 1.559}}
	if !slices.Equal(m.Nodes, want) || m.Stand != 3 || m.TicksPerRound != TicksPerRound {
		t.Fatalf("got %+v, want nodes %v stand 3 ticks %d", m, want, TicksPerRound)
	}
	if math.Signbit(m.Nodes[0][1]) {
		t.Fatal("-0.0004 rounds to -0, which JSON writes as -0")
	}
}
