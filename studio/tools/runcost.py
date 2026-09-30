"""What a workflow run cost: agents, tokens, API-price dollars and hours, per stage.

    python studio/tools/runcost.py <run id | run folder> [...]
    python studio/tools/runcost.py wf_2cdba7d7-d96 wf_a7bbee5a-5ba      # several runs of one film, added up

A run folder is where Claude Code keeps a workflow's agents:
~/.claude/projects/<project>/<session>/subagents/workflows/<run id>/ (the Workflow tool prints it as the
transcript dir). A run id is looked up there. Tokens are counted once per API message; cost uses the
first-party prices below (a subscription spends its usage limit instead, in the same proportions).
"""
import glob
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

# $ per million tokens: input, output, cache read, cache write (5 min)
PRICES = {'opus': (4.0, 20.0, 0.20, 5.0), 'sonnet': (2.0, 10.0, 0.20, 2.5), 'haiku': (1.0, 5.0, 0.10, 1.25),
          'fable': (10.0, 50.0, 0.25, 12.5)}


def tier(model):
    m = (model or '').lower()
    return next((k for k in PRICES if k in m), 'opus')


def find_run(arg):
    if os.path.isdir(arg):
        return arg
    hits = glob.glob(os.path.join(os.path.expanduser('~'), '.claude', 'projects', '*', '*', 'subagents', 'workflows', arg))
    if not hits:
        raise SystemExit(f'no run folder for {arg}')
    return hits[0]


def agent_usage(path):
    """Tokens of one agent transcript (one count per API message id), its model and its first/last time."""
    msgs, model, times = {}, None, []
    for line in open(path, encoding='utf-8', errors='replace'):
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get('timestamp'):
            times.append(e['timestamp'])
        m = e.get('message') or {}
        u = m.get('usage')
        if not u or m.get('role') != 'assistant':
            continue
        model = m.get('model') or model
        cur = msgs.setdefault(m.get('id') or e.get('uuid'), [0, 0, 0, 0])
        for i, k in enumerate(('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')):
            cur[i] = max(cur[i], u.get(k) or 0)
    tot = [sum(v[i] for v in msgs.values()) for i in range(4)]
    return tot, model, (min(times), max(times)) if times else None


def when(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


stages = defaultdict(lambda: {'agents': 0, 'tok': [0, 0, 0, 0], 'usd': 0.0, 'span': None})
for arg in sys.argv[1:] or [None]:
    if arg is None:
        raise SystemExit(__doc__)
    folder = find_run(arg)
    for meta_path in glob.glob(os.path.join(folder, 'agent-*.meta.json')):
        meta = json.load(open(meta_path, encoding='utf-8'))
        tot, model, span = agent_usage(meta_path.replace('.meta.json', '.jsonl'))
        p = PRICES[tier(model or meta.get('model'))]
        st = stages[meta.get('workflowPhase') or 'other']
        st['agents'] += 1
        st['tok'] = [a + b for a, b in zip(st['tok'], tot)]
        st['usd'] += (tot[0] * p[0] + tot[1] * p[1] + tot[2] * p[2] + tot[3] * p[3]) / 1e6
        if span:
            s0, s1 = st['span'] or span
            st['span'] = (min(s0, span[0]), max(s1, span[1]))

order = ['Brief', 'Concept', 'Sound', 'Plan', 'Look', 'Build', 'Review', 'Deliver']
rows = sorted(stages.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 99)
print(f'{"stage":10s} {"agents":>6s} {"hours":>6s} {"cache read":>11s} {"cache write":>12s} {"output":>8s} {"$ API":>8s}')
total = {'agents': 0, 'usd': 0.0, 'hours': 0.0, 'tok': [0, 0, 0, 0]}
for name, st in rows:
    hours = (when(st['span'][1]) - when(st['span'][0])).total_seconds() / 3600 if st['span'] else 0
    t = st['tok']
    print(f'{name:10s} {st["agents"]:6d} {hours:6.2f} {t[2] / 1e6:10.1f}M {t[3] / 1e6:11.2f}M {t[1] / 1e3:7.0f}k {st["usd"]:8.2f}')
    total['agents'] += st['agents']
    total['usd'] += st['usd']
    total['hours'] += hours
    total['tok'] = [a + b for a, b in zip(total['tok'], t)]
t = total['tok']
print(f'{"total":10s} {total["agents"]:6d} {total["hours"]:6.2f} {t[2] / 1e6:10.1f}M {t[3] / 1e6:11.2f}M {t[1] / 1e3:7.0f}k {total["usd"]:8.2f}')
print('hours are summed stage spans (stages run one after another); cache reads are what an agent re-reads each step')
