package nav

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"testing"
)

// The wander harness: lifelong agents that walk to a goal, dwell, and pick
// another, like blobs milling about the city between rounds.
const (
	// Goals are 3-20 hops away when such a goal is free, so walks are long
	// enough to meet other agents but short enough to finish many.
	wanderMinHops = 3
	wanderMaxHops = 20
	// Dwell 1-5 ticks at a goal: long enough that walkers must push
	// dwellers aside, short enough that dwellers keep moving too.
	dwellMin = 1
	dwellMax = 5
	// tieBits is how many low bits of a priority hold the fixed per-agent
	// tiebreak; the bits above count ticks since the goal was set.
	tieBits = 16
)

// wanderGoals returns the nodes the harness may pick as goals: those GoalOK
// accepts. Goals in a dead end or a pocket corner can stall agents for good
// (see TestStepWedgesOnDeadEndGoals and TestStepStallsOnPocketGoals).
func wanderGoals(g *Graph) []int {
	var goals []int
	for v := range g.NumStand {
		if g.GoalOK(v) {
			goals = append(goals, v)
		}
	}
	return goals
}

type wander struct {
	g                *Graph
	pl               *Planner
	goalRNG, planRNG *rand.Rand
	goals            []int
	at, goal, next   []int
	prio, tie        []uint64
	since            []int // ticks since the current goal was set
	dwell            []int // ticks of dwelling left, 0 while walking
	reached          []int // goals reached per agent
	waited           []int // consecutive ticks stood still while walking
	maxWait          int
	taken            []bool // scratch for unique goals
	pick             []int  // scratch for goal picking
	owner            []int  // scratch for checkMoves
}

func newWander(t testing.TB, g *Graph, agents int, seed uint64) *wander {
	t.Helper()
	w := &wander{
		g:       g,
		pl:      NewPlanner(g, agents),
		goalRNG: rand.New(rand.NewPCG(seed, 1)),
		planRNG: rand.New(rand.NewPCG(seed, 2)),
		goals:   wanderGoals(g),
		at:      make([]int, agents),
		goal:    make([]int, agents),
		next:    make([]int, agents),
		prio:    make([]uint64, agents),
		tie:     make([]uint64, agents),
		since:   make([]int, agents),
		dwell:   make([]int, agents),
		reached: make([]int, agents),
		waited:  make([]int, agents),
		taken:   make([]bool, g.Len()),
		owner:   make([]int, g.Len()),
	}
	if agents > len(w.goals) || agents >= 1<<tieBits {
		t.Fatalf("%d agents for %d goal nodes", agents, len(w.goals))
	}
	for i, k := range w.goalRNG.Perm(len(w.goals))[:agents] {
		w.at[i] = w.goals[k]
		w.goal[i] = w.at[i]
		w.dwell[i] = 1 // so newGoal sees it as holding its spot
	}
	for i, k := range w.goalRNG.Perm(agents) {
		w.tie[i] = uint64(k)
	}
	for i := range w.owner {
		w.owner[i] = -1
	}
	for i := range agents {
		w.newGoal(i)
	}
	return w
}

// newGoal gives agent i a free goal, preferring one 3-20 hops away.
func (w *wander) newGoal(i int) {
	clear(w.taken)
	for j := range w.at {
		switch {
		case j == i:
		case w.dwell[j] > 0:
			w.taken[w.at[j]] = true
		default:
			w.taken[w.goal[j]] = true
		}
	}
	w.pick = w.pick[:0]
	for _, v := range w.goals {
		if h := w.g.Hops(w.at[i], v); !w.taken[v] && h >= wanderMinHops && h <= wanderMaxHops {
			w.pick = append(w.pick, v)
		}
	}
	if len(w.pick) == 0 {
		for _, v := range w.goals {
			if !w.taken[v] && v != w.at[i] {
				w.pick = append(w.pick, v)
			}
		}
	}
	if len(w.pick) == 0 {
		w.goal[i], w.dwell[i] = w.at[i], 1 // nothing free: wait a tick
		return
	}
	w.goal[i] = w.pick[w.goalRNG.IntN(len(w.pick))]
	w.since[i], w.dwell[i], w.waited[i] = 0, 0, 0
}

// prepare sets this tick's goals and priorities.
func (w *wander) prepare() {
	for i := range w.at {
		if w.dwell[i] > 0 {
			w.goal[i] = w.at[i]
			w.prio[i] = w.tie[i]
		} else {
			w.prio[i] = uint64(w.since[i])<<tieBits | w.tie[i]
		}
	}
}

// step plans one tick into w.next.
func (w *wander) step() {
	w.prepare()
	w.pl.Step(w.at, w.goal, w.prio, w.planRNG, w.next)
}

// advance applies w.next and updates goals, dwells and stats.
func (w *wander) advance() {
	for i := range w.at {
		moved := w.next[i] != w.at[i]
		w.at[i] = w.next[i]
		switch {
		case w.dwell[i] > 0:
			w.dwell[i]--
			if w.dwell[i] == 0 {
				w.newGoal(i)
			}
		case w.at[i] == w.goal[i]:
			w.reached[i]++
			w.dwell[i] = dwellMin + w.goalRNG.IntN(dwellMax-dwellMin+1)
			w.waited[i] = 0
		default:
			w.since[i]++
			if moved {
				w.waited[i] = 0
			} else {
				w.waited[i]++
				w.maxWait = max(w.maxWait, w.waited[i])
			}
		}
	}
}

// checkMoves recomputes the planner's guarantees from coordinates: targets
// are distinct, every move is a stay or an edge, nobody swaps, and (if
// clearance is set) every two movers stay p.MinSep apart all tick.
func checkMoves(g *Graph, at, next []int, owner []int, clearance bool) error {
	defer func() {
		for _, v := range next {
			owner[v] = -1
		}
	}()
	for i, v := range next {
		if o := owner[v]; o >= 0 {
			return fmt.Errorf("agents %d and %d both end on node %d", o, i, v)
		}
		owner[v] = i
		if g.move(at[i], v) < 0 {
			return fmt.Errorf("agent %d jumps %d->%d, not an edge", i, at[i], v)
		}
	}
	minSep := DefaultParams().MinSep
	for i := range at {
		for j := i + 1; j < len(at); j++ {
			if next[i] == at[j] && next[j] == at[i] {
				return fmt.Errorf("agents %d and %d swap nodes %d and %d", i, j, at[i], at[j])
			}
			if !clearance {
				continue
			}
			n := g.Nodes
			if d := Swept(n[at[i]], n[next[i]], n[at[j]], n[next[j]]); d < minSep {
				return fmt.Errorf("agents %d (%d->%d) and %d (%d->%d) come %.3f apart", i, at[i], next[i], j, at[j], next[j], d)
			}
		}
	}
	return nil
}

// Wander runs: enough ticks for every agent to finish many walks, over
// enough seeds to hit rare meetings.
const (
	wanderTicks = 2000
	wanderSeeds = 20
)

func wanderSeedCount() uint64 {
	if testing.Short() {
		return 5
	}
	return wanderSeeds
}

func TestStepKeepsClearance(t *testing.T) {
	for _, fx := range plannerFixtures() {
		t.Run(fx.name, func(t *testing.T) {
			g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
			for seed := range wanderSeedCount() {
				w := newWander(t, g, fx.agents, seed)
				for tick := range wanderTicks {
					w.step()
					if err := checkMoves(g, w.at, w.next, w.owner, true); err != nil {
						t.Fatalf("seed %d tick %d: %v", seed, tick, err)
					}
					w.advance()
				}
			}
		})
	}
}

// Liveness bounds, per agent per run.
//
// Unhindered, a walk takes at most wanderMaxHops ticks plus a dwell of at
// most dwellMax, so wanderTicks fits at least 80 goals. minGoals allows each
// goal three times that on average. The tightest fixture (two rooms and a
// corridor) measured a minimum of 51 over 40 seeds, so falling below 25
// means agents are stuck or circling, not just crowded.
//
// A walker's priority grows every tick it has not reached its goal, so a
// queue clears in about as many ticks as there are agents in its way. The
// worst run of standing still measured was 21 ticks (corridor again);
// maxWaitTicks is about twice that.
const (
	minGoals     = 25
	maxWaitTicks = 40
)

func TestStepLiveness(t *testing.T) {
	for _, fx := range plannerFixtures() {
		t.Run(fx.name, func(t *testing.T) {
			g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
			for seed := range wanderSeedCount() {
				w := newWander(t, g, fx.agents, seed)
				for range wanderTicks {
					w.step()
					w.advance()
				}
				if least := slices.Min(w.reached); least < minGoals {
					t.Errorf("seed %d: an agent reached only %d goals in %d ticks, want >= %d (all: %v)",
						seed, least, wanderTicks, minGoals, w.reached)
				}
				if w.maxWait > maxWaitTicks {
					t.Errorf("seed %d: an agent stood still %d ticks in a row off its goal, want <= %d",
						seed, w.maxWait, maxWaitTicks)
				}
			}
		})
	}
}

// After planning, the tables must agree exactly: each agent holds one move,
// that move and its target node name the agent, and nothing else is claimed.
// A failed push must leave the pushed agent holding the claim on its own
// node, not its parent.
func TestStepTablesAgree(t *testing.T) {
	for _, fx := range plannerFixtures() {
		t.Run(fx.name, func(t *testing.T) {
			g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
			for seed := range tableSeeds {
				w := newWander(t, g, fx.agents, seed)
				for tick := range wanderTicks {
					w.prepare()
					pl := w.pl
					pl.begin(w.at, w.goal, w.prio, w.planRNG, w.next)
					pl.plan()
					if err := tablesAgree(pl); err != nil {
						t.Fatalf("seed %d tick %d: %v", seed, tick, err)
					}
					pl.finish(w.next)
					w.advance()
				}
			}
		})
	}
}

// tableSeeds is fewer than wanderSeeds: a bookkeeping slip shows up within
// a few ticks, not only in rare meetings.
const tableSeeds uint64 = 5

func tablesAgree(p *Planner) error {
	claims, moves := 0, 0
	for _, a := range p.claimant {
		if a >= 0 {
			claims++
		}
	}
	for _, a := range p.mover {
		if a >= 0 {
			moves++
		}
	}
	if claims != len(p.at) || moves != len(p.at) {
		return fmt.Errorf("%d agents but %d claimed nodes and %d claimed moves", len(p.at), claims, moves)
	}
	for i := range p.at {
		m := p.chosen[i]
		if m < 0 {
			return fmt.Errorf("agent %d is undecided", i)
		}
		if v := p.g.moveTo(int(m)); p.claimant[v] != int32(i) || p.mover[m] != int32(i) {
			return fmt.Errorf("agent %d chose %s but node %d is claimed by %d and the move by %d",
				i, p.g.moveName(int(m)), v, p.claimant[v], p.mover[m])
		}
	}
	return nil
}

// plainSeeds is fewer than wanderSeeds: plain PIBT tries swaps within the
// first few ticks.
const plainSeeds uint64 = 5

// Without the conflict table the planner is plain PIBT. Its own vertex and
// swap rules must still hold, so they do not lean on the table.
func TestStepWithoutConflictTable(t *testing.T) {
	for _, fx := range plannerFixtures() {
		t.Run(fx.name, func(t *testing.T) {
			g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
			g.conf = g.conf[:0]
			clear(g.confOff)
			for seed := range plainSeeds {
				w := newWander(t, g, fx.agents, seed)
				for tick := range wanderTicks {
					w.step()
					if err := checkMoves(g, w.at, w.next, w.owner, false); err != nil {
						t.Fatalf("seed %d tick %d: %v", seed, tick, err)
					}
					w.advance()
				}
			}
		})
	}
}

// lineGraph is n nodes a lattice step apart along X, joined in a row.
func lineGraph(t *testing.T, n int) *Graph {
	nodes := make([]Point, n)
	var edges [][2]int
	for i := range nodes {
		nodes[i] = pnt(float64(i)*lattice, 0)
		if i > 0 {
			edges = append(edges, [2]int{i - 1, i})
		}
	}
	return mustValidGraph(t, nodes, allStand(n), edges)
}

// stepCase is one hand-checked tick: agents' nodes, goals and priorities,
// and the nodes they must end on.
type stepCase struct {
	at, goal []int
	prio     []uint64
	want     []int
}

func runSteps(t *testing.T, g *Graph, seed uint64, cases []stepCase) {
	t.Helper()
	pl := NewPlanner(g, len(cases[0].at))
	rng := rand.New(rand.NewPCG(seed, 0))
	for k, c := range cases {
		next := make([]int, len(c.at))
		pl.Step(c.at, c.goal, c.prio, rng, next)
		if !slices.Equal(next, c.want) {
			t.Fatalf("tick %d: at %v goal %v -> %v, want %v", k+1, c.at, c.goal, next, c.want)
		}
	}
}

// The worked example in PIBT.md: A (high priority) walks east down a
// corridor through B and C, who dwell. A pushes B, B inherits A's priority
// and pushes C, and all three move as a train.
//
//	tick 0: A . B C . . .
//	tick 1: . A B C . . .
//	tick 2: . . A B C . .
func TestStepPushesAChain(t *testing.T) {
	g := lineGraph(t, 7)
	prio := []uint64{3, 2, 1}
	for seed := range uint64(20) {
		runSteps(t, g, seed, []stepCase{
			{at: []int{0, 2, 3}, goal: []int{4, 2, 3}, prio: prio, want: []int{1, 2, 3}},
			{at: []int{1, 2, 3}, goal: []int{4, 2, 3}, prio: prio, want: []int{2, 3, 4}},
			{at: []int{2, 3, 4}, goal: []int{4, 3, 4}, prio: prio, want: []int{3, 4, 5}},
			{at: []int{3, 4, 5}, goal: []int{4, 4, 5}, prio: prio, want: []int{4, 5, 6}},
			{at: []int{4, 5, 6}, goal: []int{4, 5, 6}, prio: prio, want: []int{4, 5, 6}},
		})
	}
}

func TestStepHeadOn(t *testing.T) {
	for seed := range uint64(20) {
		// No room to back into: neither may swap, so both wait.
		runSteps(t, lineGraph(t, 2), seed, []stepCase{
			{at: []int{0, 1}, goal: []int{1, 0}, prio: []uint64{2, 1}, want: []int{0, 1}},
		})
		// Room behind B: A pushes B back the way it came.
		runSteps(t, lineGraph(t, 3), seed, []stepCase{
			{at: []int{0, 1}, goal: []int{2, 0}, prio: []uint64{2, 1}, want: []int{1, 2}},
		})
	}
}

// Plain PIBT would rotate three agents round a hex triangle; their swept
// paths come 0.9 apart, so the planner must refuse.
func TestStepRefusesTriangleRotation(t *testing.T) {
	nodes, edges := flower()
	g := mustGraph(t, nodes, allStand(len(nodes)), edges)
	if err := ruleConflictTable(g, DefaultParams()); err != nil {
		t.Fatal(err)
	}
	at, goal := []int{0, 1, 2}, []int{1, 2, 0}
	rotation := goal
	owner := slices.Repeat([]int{-1}, g.Len())
	for seed := range uint64(50) {
		pl := NewPlanner(g, 3)
		for p, prio := range [][]uint64{{3, 2, 1}, {1, 3, 2}, {2, 1, 3}} {
			next := make([]int, 3)
			pl.Step(at, goal, prio, rand.New(rand.NewPCG(seed, uint64(p))), next)
			if slices.Equal(next, rotation) {
				t.Fatalf("seed %d prio %v: agents rotated round the triangle", seed, prio)
			}
			if err := checkMoves(g, at, next, owner, true); err != nil {
				t.Fatalf("seed %d prio %v: %v", seed, prio, err)
			}
		}
	}
	// The table is what stops it: without it, plain PIBT rotates.
	g.conf = g.conf[:0]
	clear(g.confOff)
	next := make([]int, 3)
	NewPlanner(g, 3).Step(at, goal, []uint64{3, 2, 1}, rand.New(rand.NewPCG(0, 0)), next)
	if !slices.Equal(next, rotation) {
		t.Errorf("plain PIBT gave %v, want the rotation %v", next, rotation)
	}
}

// Why goals must be in the 2-core: two agents in a dead-end spur, each
// wanting the other's spot, can never move. Neither can swap, and the spur
// has no room to step aside.
func TestStepWedgesOnDeadEndGoals(t *testing.T) {
	fx := spursFixture()
	g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
	mid, end := 31, 32 // the first spur runs 0 -> 30 -> 31 -> 32
	if g.Core(mid) || g.Core(end) || len(g.Neighbors(end)) != 1 {
		t.Fatal("fixture changed: nodes 31 and 32 should be a dead end")
	}
	for seed := range uint64(10) {
		var cases []stepCase
		for range 50 {
			cases = append(cases, stepCase{at: []int{mid, end}, goal: []int{end, mid},
				prio: []uint64{2, 1}, want: []int{mid, end}})
		}
		runSteps(t, g, seed, cases)
	}
}

// Why pocket corners are not goals either. X wants the pocket corner 0 and
// outranks Y, who stands on it. Every tick X claims 0 and pushes Y, but Y's
// only exits are X's node (a swap) and the other corner neighbour, a 120°
// turn that clashes with X stepping in. Y fails and stays, and is never
// planned on its own, so it never gets to step out while X waits.
func TestStepStallsOnPocketGoals(t *testing.T) {
	nodes := hexLattice(4, 3, 0, 0, false, nil)
	kinds := allStand(len(nodes))
	g := mustValidGraph(t, nodes, kinds, untrapped(nodes, kinds, linkWithin(nodes, fixtureLink)))
	corner, far := 0, 11
	if nb := g.Neighbors(corner); len(nb) != 2 || g.GoalOK(corner) {
		t.Fatal("fixture changed: node 0 should be a pocket corner")
	}
	for seed := range uint64(10) {
		pl := NewPlanner(g, 2)
		rng := rand.New(rand.NewPCG(seed, 0))
		at, next := []int{1, corner}, make([]int, 2)
		for tick := range 50 {
			pl.Step(at, []int{corner, far}, []uint64{2, 1}, rng, next)
			if next[1] != corner || next[0] == corner {
				t.Fatalf("seed %d tick %d: moved to %v, but the pocket should stay stuck", seed, tick, next)
			}
			copy(at, next)
		}
	}
}

func TestStepDeterministic(t *testing.T) {
	fx := hexHolesFixture()
	g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
	trace := func(seed uint64) []int {
		w := newWander(t, g, fx.agents, seed)
		var out []int
		for range 300 {
			w.step()
			out = append(out, w.next...)
			w.advance()
		}
		return out
	}
	a := trace(7)
	if !slices.Equal(a, trace(7)) {
		t.Fatal("same seed, different moves")
	}
	if slices.Equal(a, trace(8)) {
		t.Fatal("different seeds, same moves")
	}
}

func TestStepLeavesInputsAlone(t *testing.T) {
	fx := hexHolesFixture()
	g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
	w := newWander(t, g, fx.agents, 3)
	for range 50 {
		w.prepare()
		at, goal, prio := slices.Clone(w.at), slices.Clone(w.goal), slices.Clone(w.prio)
		w.pl.Step(w.at, w.goal, w.prio, w.planRNG, w.next)
		if !slices.Equal(at, w.at) || !slices.Equal(goal, w.goal) || !slices.Equal(prio, w.prio) {
			t.Fatal("Step changed its inputs")
		}
		w.advance()
	}
}

func TestStepNoAllocs(t *testing.T) {
	fx := hexHolesFixture()
	g := mustValidGraph(t, fx.nodes, fx.kinds, fx.edges)
	w := newWander(t, g, fx.agents, 1)
	for range 20 {
		w.step()
		w.advance()
	}
	if n := testing.AllocsPerRun(100, w.step); n != 0 {
		t.Errorf("Step allocates %v times per call", n)
	}
}

func TestStepPanicsOnSharedNode(t *testing.T) {
	g := lineGraph(t, 3)
	pl := NewPlanner(g, 2)
	next := make([]int, 2)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("two agents on one node did not panic")
			}
		}()
		pl.Step([]int{1, 1}, []int{0, 2}, []uint64{1, 2}, rand.New(rand.NewPCG(0, 0)), next)
	}()
	// The planner must still work after the panic.
	pl.Step([]int{0, 1}, []int{0, 2}, []uint64{1, 2}, rand.New(rand.NewPCG(0, 0)), next)
	if !slices.Equal(next, []int{0, 2}) {
		t.Errorf("after a panic: got %v, want [0 2]", next)
	}
}

// bigHex is a ~1000-node hex plaza, about the size of the city graph.
func bigHex() navFixture {
	nodes := hexLattice(32, 32, 0, 0, false, nil)
	return navFixture{"big hex", nodes, allStand(len(nodes)), linkWithin(nodes, fixtureLink), 100}
}

func BenchmarkFromEdges(b *testing.B) {
	fx := bigHex() // 1024 nodes, 2945 edges
	for b.Loop() {
		if _, err := FromEdges(fx.nodes, fx.kinds, fx.edges, DefaultParams()); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCheckGraph(b *testing.B) {
	fx := bigHex()
	g := mustGraph(b, fx.nodes, fx.kinds, fx.edges)
	for b.Loop() {
		if err := CheckGraph(g, DefaultParams()); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkStep replays recorded wander ticks, so it times Step alone.
func BenchmarkStep(b *testing.B) {
	fx := bigHex()
	g := mustGraph(b, fx.nodes, fx.kinds, fx.edges)
	w := newWander(b, g, fx.agents, 1)
	const recorded = 256
	type tick struct {
		at, goal []int
		prio     []uint64
	}
	ticks := make([]tick, recorded)
	for k := range ticks {
		w.step()
		ticks[k] = tick{slices.Clone(w.at), slices.Clone(w.goal), slices.Clone(w.prio)}
		w.advance()
	}
	pl := NewPlanner(g, fx.agents)
	rng := rand.New(rand.NewPCG(1, 1))
	next := make([]int, fx.agents)
	b.ReportAllocs()
	k := 0
	for b.Loop() {
		c := ticks[k%recorded]
		pl.Step(c.at, c.goal, c.prio, rng, next)
		k++
	}
}
