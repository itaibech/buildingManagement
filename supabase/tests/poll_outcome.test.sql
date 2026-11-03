-- poll_outcome() (0031) against the shared majority cases. src/features/polls/majority.test.ts reads the same JSON
-- (the dollar-quoted cases array below) and checks majority.ts evaluate() returns the same outcomes, so the SQL stored at
-- closing and the TypeScript live view agree.
begin;
create extension if not exists pgtap with schema extensions;

create temp table cases on commit drop as
select c from jsonb_array_elements($cases$[
  {"name": "simple: more for than against, abstentions ignored", "kind": "yes_no", "majority": "simple", "percent": null, "base": "building",
   "tally": {"counts": [4, 3, 9], "building": 19, "eligible": 19},
   "expect": {"reached": true, "required": null, "base": 19, "top": 4, "next": 3, "leader": 0, "tie": false}},
  {"name": "simple: a tie fails", "kind": "yes_no", "majority": "simple", "percent": null, "base": "building",
   "tally": {"counts": [5, 5, 1], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": null, "base": 19, "top": 5, "next": 5, "leader": null, "tie": true}},
  {"name": "simple: no votes", "kind": "yes_no", "majority": "simple", "percent": null, "base": "building",
   "tally": {"counts": [0, 0, 0], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": null, "base": 19, "top": 0, "next": 0, "leader": null, "tie": true}},
  {"name": "2/3 of all: 11 of 19 is short of 13", "kind": "yes_no", "majority": "two_thirds", "percent": null, "base": "building",
   "tally": {"counts": [11, 0, 2], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": 13, "base": 19, "top": 11, "next": 0, "leader": null, "tie": false}},
  {"name": "2/3 of all: 13 passes", "kind": "yes_no", "majority": "two_thirds", "percent": null, "base": "building",
   "tally": {"counts": [13, 6, 0], "building": 19, "eligible": 19},
   "expect": {"reached": true, "required": 13, "base": 19, "top": 13, "next": 6, "leader": 0, "tie": false}},
  {"name": "2/3 of participants: 4 of the 6 in scope", "kind": "yes_no", "majority": "two_thirds", "percent": null, "base": "eligible",
   "tally": {"counts": [4, 2, 0], "building": 19, "eligible": 6},
   "expect": {"reached": true, "required": 4, "base": 6, "top": 4, "next": 2, "leader": 0, "tie": false}},
  {"name": "2/3 of all with a scope of 6: needs 13", "kind": "yes_no", "majority": "two_thirds", "percent": null, "base": "building",
   "tally": {"counts": [6, 0, 0], "building": 19, "eligible": 6},
   "expect": {"reached": false, "required": 13, "base": 19, "top": 6, "next": 0, "leader": null, "tie": false}},
  {"name": "60%: 11 of 19 is short of 12", "kind": "yes_no", "majority": "percent", "percent": 60, "base": "building",
   "tally": {"counts": [11, 0, 0], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": 12, "base": 19, "top": 11, "next": 0, "leader": null, "tie": false}},
  {"name": "60%: 12 passes", "kind": "yes_no", "majority": "percent", "percent": 60, "base": "building",
   "tally": {"counts": [12, 7, 0], "building": 19, "eligible": 19},
   "expect": {"reached": true, "required": 12, "base": 19, "top": 12, "next": 7, "leader": 0, "tie": false}},
  {"name": "1% of 5: at least one vote", "kind": "yes_no", "majority": "percent", "percent": 1, "base": "building",
   "tally": {"counts": [1, 0, 0], "building": 5, "eligible": 5},
   "expect": {"reached": true, "required": 1, "base": 5, "top": 1, "next": 0, "leader": 0, "tie": false}},
  {"name": "2/3 of no apartments: still one vote", "kind": "yes_no", "majority": "two_thirds", "percent": null, "base": "building",
   "tally": {"counts": [0, 0, 0], "building": 0, "eligible": 0},
   "expect": {"reached": false, "required": 1, "base": 0, "top": 0, "next": 0, "leader": null, "tie": true}},
  {"name": "single choice: strictly ahead", "kind": "single_choice", "majority": "simple", "percent": null, "base": "building",
   "tally": {"counts": [2, 5, 1], "building": 19, "eligible": 19},
   "expect": {"reached": true, "required": null, "base": 19, "top": 5, "next": 2, "leader": 1, "tie": false}},
  {"name": "single choice: a tie at the top", "kind": "single_choice", "majority": "simple", "percent": null, "base": "building",
   "tally": {"counts": [4, 4, 1], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": null, "base": 19, "top": 4, "next": 4, "leader": null, "tie": true}},
  {"name": "single choice: no votes", "kind": "single_choice", "majority": "simple", "percent": null, "base": "building",
   "tally": {"counts": [0, 0], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": null, "base": 19, "top": 0, "next": 0, "leader": null, "tie": false}},
  {"name": "single choice 2/3: leader short", "kind": "single_choice", "majority": "two_thirds", "percent": null, "base": "building",
   "tally": {"counts": [9, 3, 1], "building": 19, "eligible": 19},
   "expect": {"reached": false, "required": 13, "base": 19, "top": 9, "next": 3, "leader": null, "tie": false}},
  {"name": "single choice 2/3: leader reaches it", "kind": "single_choice", "majority": "two_thirds", "percent": null, "base": "building",
   "tally": {"counts": [13, 3, 1], "building": 19, "eligible": 19},
   "expect": {"reached": true, "required": 13, "base": 19, "top": 13, "next": 3, "leader": 0, "tie": false}}
]$cases$::jsonb) c;

select plan((select count(*)::int from cases));

select is(public.poll_outcome(c ->> 'kind', c ->> 'majority', (c ->> 'percent')::int, c ->> 'base', c -> 'tally'), c -> 'expect', c ->> 'name')
from cases;

select * from finish();
rollback;
