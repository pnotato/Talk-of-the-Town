package nav

import (
	"cmp"
	"fmt"
	"math/rand/v2"
	"slices"
)

// Planner moves agents on a Graph with PIBT (Priority Inheritance with
// Backtracking; Okumura et al., IJCAI 2019 and AIJ 2022), extended with the
// graph's move-conflict table so moving agents also keep Params.MinSep
// apart. See docs/engine/PIBT.md.
//
// It holds scratch space sized for the graph and the agent count, so Step
// does not allocate. A Planner is not safe for concurrent use.
type Planner struct {
	g *Graph

	// The current Step's inputs, held so the recursion can read them.
	at, goal []int
	rng      *rand.Rand

	order    []int32 // agents by descending priority
	occupant []int32 // node -> agent standing on it now, or -1
	claimant []int32 // node -> agent going to it next tick, or -1
	mover    []int32 // move -> agent that has claimed it, or -1
	chosen   []int32 // agent -> its claimed move, or -1 while undecided
	// Agent i's candidate moves and their hop counts to its goal live at
	// [i*stride, i*stride+degree]. Each agent is planned at most once per
	// Step, so the slots never overlap in use.
	cand   []int32
	hops   []uint16
	stride int
}

// NewPlanner returns a planner for up to agents agents on g.
func NewPlanner(g *Graph, agents int) *Planner {
	maxDeg := 0
	for u := range g.Len() {
		maxDeg = max(maxDeg, int(g.off[u+1]-g.off[u]))
	}
	stride := maxDeg + 1 // the neighbours plus staying put
	minus := func(n int) []int32 { return slices.Repeat([]int32{-1}, n) }
	return &Planner{
		g:        g,
		order:    make([]int32, agents),
		occupant: minus(g.Len()),
		claimant: minus(g.Len()),
		mover:    minus(g.numMoves()),
		chosen:   minus(agents),
		cand:     make([]int32, agents*stride),
		hops:     make([]uint16, agents*stride),
		stride:   stride,
	}
}

// Step moves every agent at most one edge. at holds the agents' current
// nodes, all distinct. goal[i] is agent i's target (goal[i] == at[i] while it
// dwells). prio must be a strict total order: higher plans first and wins
// conflicts. next receives each agent's node for the next tick.
//
// If g passes CheckGraph, then afterwards no two agents share a node, no two
// swap, and every two agents stay at least Params.MinSep apart throughout
// the tick. rng only breaks ties between equally short candidates, drawn in
// planning order, so the same inputs and rng state give the same result.
func (p *Planner) Step(at, goal []int, prio []uint64, rng *rand.Rand, next []int) {
	p.begin(at, goal, prio, rng, next)
	p.plan()
	p.finish(next)
}

// begin checks Step's inputs, records who stands where and orders the
// agents by priority.
func (p *Planner) begin(at, goal []int, prio []uint64, rng *rand.Rand, next []int) {
	na := len(at)
	if na > len(p.chosen) || len(goal) != na || len(prio) != na || len(next) != na {
		panic(fmt.Sprintf("nav: Step with %d agents, %d goals, %d priorities, %d outputs; planner holds %d",
			na, len(goal), len(prio), len(next), len(p.chosen)))
	}
	n := p.g.Len()
	for i, u := range at {
		if u < 0 || u >= n || goal[i] < 0 || goal[i] >= n {
			p.clearOccupants(at[:i])
			panic(fmt.Sprintf("nav: agent %d at node %d with goal %d; graph has %d nodes", i, u, goal[i], n))
		}
		if o := p.occupant[u]; o >= 0 {
			p.clearOccupants(at[:i])
			panic(fmt.Sprintf("nav: agents %d and %d are both on node %d", o, i, u))
		}
		p.occupant[u] = int32(i)
	}
	p.at, p.goal, p.rng = at, goal, rng

	order := p.order[:na]
	for i := range order {
		order[i] = int32(i)
	}
	slices.SortFunc(order, func(a, b int32) int {
		return cmp.Or(cmp.Compare(prio[b], prio[a]), cmp.Compare(a, b))
	})
}

// plan runs PIBT from each undecided agent, highest priority first.
func (p *Planner) plan() {
	for _, i := range p.order[:len(p.at)] {
		if p.chosen[i] < 0 {
			p.pibt(i, -1)
		}
	}
}

// finish writes each agent's claimed node to next, then resets only the
// scratch entries this Step touched. After plan, every agent holds exactly
// one claimed move.
func (p *Planner) finish(next []int) {
	for i, u := range p.at {
		m := int(p.chosen[i])
		v := p.g.moveTo(m)
		next[i] = v
		p.occupant[u], p.claimant[v], p.mover[m], p.chosen[i] = -1, -1, -1, -1
	}
	p.at, p.goal, p.rng = nil, nil, nil
}

func (p *Planner) clearOccupants(at []int) {
	for _, u := range at {
		p.occupant[u] = -1
	}
}

// pibt plans agent i, which parent (or -1 at the root) wants to move onto.
// It returns true if i claimed a candidate, which for a pushed agent always
// means it moves off its node, and false if it found none and stays.
//
// Bookkeeping invariants, true between calls:
//
//   - claimant, mover and chosen agree: each registered move is the chosen
//     move of the agent named in both tables. Registered moves are final or
//     belong to agents on the current recursion path.
//   - Every registered move other than a fallback stay was checked, when
//     claimed, against every move registered at that moment: its target was
//     unclaimed, it was not onto the parent, and its conflict list held no
//     registered move. Of any two final moves, the later one was checked
//     against the earlier, because a final move is never unregistered.
//   - A fallback stay needs no check. Its node is unclaimed (anyone else who
//     claimed it would have had to push i, and only the parent does, which
//     gives the node up), and on a graph that passes CheckGraph a stay only
//     conflicts with moves that start or end on its node (rules 1 and 2).
//   - A move is unregistered only when the agent it pushed failed. Success
//     returns straight up the path, so every agent in a failed subtree
//     failed and stays, and stays do not depend on what else is registered.
//     Removing the move therefore invalidates nothing already final.
func (p *Planner) pibt(i, parent int32) bool {
	for _, m := range p.candidates(i) {
		c := p.g.moveTo(int(m))
		if p.claimant[c] >= 0 {
			continue // someone already goes there
		}
		if parent >= 0 && c == p.at[parent] {
			continue // no swapping with the agent pushing us
		}
		if p.blocked(int(m)) {
			continue // would pass too close to a move already claimed
		}
		p.claim(i, m, c)
		k := p.occupant[c]
		if k < 0 || k == i || p.chosen[k] >= 0 {
			return true // free, our own node, or vacated by a decided agent
		}
		// Priority inheritance: k must leave c for us, at our priority.
		if p.pibt(k, i) {
			return true
		}
		// k found nowhere to go, so it stays on c and has taken over the
		// claim on c. Drop our move and try the next candidate.
		p.release(i, m, c)
	}
	u := p.at[i]
	p.claim(i, int32(u), u) // stay
	return false
}

// claim registers move m to node c as agent i's choice.
func (p *Planner) claim(i, m int32, c int) {
	p.claimant[c] = i
	p.mover[m] = i
	p.chosen[i] = m
}

// release undoes agent i's claim of move m to node c. The claim on c is
// dropped only if i still holds it; a pushed agent that stays there has
// already taken it over.
func (p *Planner) release(i, m int32, c int) {
	if p.claimant[c] == i {
		p.claimant[c] = -1
	}
	p.mover[m] = -1
	p.chosen[i] = -1
}

// blocked reports whether move m conflicts with any move claimed so far.
func (p *Planner) blocked(m int) bool {
	for _, x := range p.g.moveConflicts(m) {
		if p.mover[x] >= 0 {
			return true
		}
	}
	return false
}

// candidates returns agent i's moves (each neighbour, plus staying put)
// sorted by hops to its goal, shortest first, with ties shuffled by rng.
func (p *Planner) candidates(i int32) []int32 {
	g := p.g
	n := g.Len()
	u := p.at[i]
	row := g.hops[p.goal[i]*n : (p.goal[i]+1)*n] // hops are symmetric
	lo, hi := g.off[u], g.off[u+1]
	base := int(i) * p.stride
	cs := p.cand[base : base+int(hi-lo)+1]
	hs := p.hops[base : base+len(cs)]
	cs[0], hs[0] = int32(u), row[u]
	for e := lo; e < hi; e++ {
		cs[e-lo+1], hs[e-lo+1] = int32(n)+e, row[g.adj[e]]
	}
	// Insertion sort: there are at most a handful of candidates.
	for a := 1; a < len(cs); a++ {
		for b := a; b > 0 && hs[b] < hs[b-1]; b-- {
			cs[b], cs[b-1] = cs[b-1], cs[b]
			hs[b], hs[b-1] = hs[b-1], hs[b]
		}
	}
	// Shuffle each run of equal hop counts (Fisher-Yates), so equally good
	// moves are tried in a fair, seeded order.
	for a := 0; a < len(cs); {
		b := a + 1
		for b < len(cs) && hs[b] == hs[a] {
			b++
		}
		for x := b - 1; x > a; x-- {
			y := a + p.rng.IntN(x-a+1)
			cs[x], cs[y] = cs[y], cs[x]
		}
		a = b
	}
	return cs
}
